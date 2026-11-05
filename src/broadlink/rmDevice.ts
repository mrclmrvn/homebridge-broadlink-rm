import { performance } from 'node:perf_hooks';
import { BroadlinkDevice, BroadlinkError } from './device';
import { PacketCommand, RMSubCommand } from './constants';
import { convertProntoCode } from '../helpers/convertProntoCode';

export interface RFLearningOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (stage: 'frequency' | 'packet') => void;
}

export class RMDevice extends BroadlinkDevice {
  private learning = false;

  private async command(command: number, data: Buffer = Buffer.alloc(0), signal?: AbortSignal): Promise<Buffer> {
    return this.synchronized(async () => {
      await this.ensureAuthenticated(signal);
      const offset = this.typeInfo.isRM4 ? 6 : 4;
      const payload = Buffer.alloc(offset + data.length);
      if (offset === 6) payload.writeUInt16LE(data.length + 4, 0);
      payload.writeUInt32LE(command, offset - 4);
      data.copy(payload, offset);
      const response = await this.sendPacket(PacketCommand.COMMAND, payload, 5000, signal);
      if (response.length < offset) throw new Error('Truncated RM response');
      if (offset === 6) {
        const length = response.readUInt16LE(0);
        if (length < 4 || length + 2 > response.length) throw new Error('Invalid RM4 response length');
        return response.subarray(6, length + 2);
      }
      return response.subarray(4);
    });
  }

  public async sendData(data: Buffer | string): Promise<void> {
    if (this.learning) throw new Error('Cannot send a code while learning is in progress');
    if (typeof data === 'string') {
      if (/^(?:0000|0100)\s/i.test(data.trim())) data = convertProntoCode(data);
      const clean = data.replace(/\s+/g, '');
      if (!clean.length || clean.length % 2 || !/^[0-9a-f]+$/i.test(clean)) throw new Error('Code must contain complete hexadecimal bytes');
      data = Buffer.from(clean, 'hex');
    }
    if (!data.length) throw new Error('Cannot send an empty code');
    await this.command(RMSubCommand.SEND_DATA, data);
  }

  public async enterLearning(signal?: AbortSignal): Promise<void> {
    await this.command(RMSubCommand.ENTER_LEARN, undefined, signal);
  }

  public async checkData(signal?: AbortSignal): Promise<Buffer | null> {
    try {
      const code = await this.command(RMSubCommand.CHECK_DATA, undefined, signal);
      if (!code.some(byte => byte !== 0)) return null;
      if (code.length < 4) throw new Error('Truncated learned code');
      const length = code.readUInt16LE(2) + 4;
      if (length <= 4 || length > code.length) throw new Error('Invalid learned code length');
      return Buffer.from(code.subarray(0, length));
    } catch (error) {
      if (error instanceof BroadlinkError && error.code === 0xfff6) return null;
      throw error;
    }
  }

  private validateLearning(timeoutMs: number, intervalMs: number): void {
    for (const value of [timeoutMs, intervalMs]) {
      if (!Number.isFinite(value) || value <= 0 || value > 2147483647) throw new Error('Learning times must be positive finite milliseconds');
    }
    if (this.learning) throw new Error('A learning operation is already in progress');
    this.assertOpen();
  }

  private async pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.shutdown.signal.aborted) throw new Error('Learning aborted');
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.shutdown.signal.removeEventListener('abort', aborted);
      };
      const aborted = () => { cleanup(); reject(new Error('Learning aborted')); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
      signal?.addEventListener('abort', aborted, { once: true });
      this.shutdown.signal.addEventListener('abort', aborted, { once: true });
    });
  }

  public async learnData(timeoutMs = 30000, intervalMs = 1000, signal?: AbortSignal): Promise<string> {
    this.validateLearning(timeoutMs, intervalMs);
    this.learning = true;
    try {
      await this.enterLearning(signal);
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        await this.pause(Math.min(intervalMs, deadline - performance.now()), signal);
        const code = await this.checkData(signal);
        if (code) return code.toString('hex');
      }
      throw new Error('IR learning timed out');
    } finally { this.learning = false; }
  }

  public async learnRFData(options: RFLearningOptions = {}): Promise<string> {
    if (!this.typeInfo.hasRF) throw new Error('RF learning is not supported by this device model');
    const { timeoutMs = 60000, intervalMs = 500, signal, onProgress } = options;
    this.validateLearning(timeoutMs, intervalMs);
    this.learning = true;
    let swept = false;
    try {
      const deadline = performance.now() + timeoutMs;
      await this.command(RMSubCommand.ENTER_RF_LEARN, undefined, signal);
      swept = true;
      onProgress?.('frequency');
      let frequency: Buffer | undefined;
      while (performance.now() < deadline) {
        await this.pause(Math.min(intervalMs, deadline - performance.now()), signal);
        let response: Buffer;
        try { response = await this.command(RMSubCommand.CHECK_RF_FREQUENCY, undefined, signal); }
        catch (error) {
          if (error instanceof BroadlinkError && error.code === 0xfff6) continue;
          throw error;
        }
        if (!response.length) throw new Error('Truncated RF frequency response');
        if (response[0]) {
          frequency = response.length >= 5 && response.readUInt32LE(1) > 0 ? response.subarray(1, 5) : Buffer.alloc(0);
          break;
        }
      }
      if (!frequency) throw new Error('RF frequency sweep timed out');
      await this.command(RMSubCommand.FIND_RF_PACKET, frequency, signal);
      onProgress?.('packet');
      while (performance.now() < deadline) {
        await this.pause(Math.min(intervalMs, deadline - performance.now()), signal);
        const code = await this.checkData(signal);
        if (code) return code.toString('hex');
      }
      throw new Error('RF packet learning timed out');
    } finally {
      if (swept && !this.shutdown.signal.aborted) {
        try { await this.command(RMSubCommand.CANCEL_RF_LEARN); } catch { /* Do not hide the original result. */ }
      }
      this.learning = false;
    }
  }

  public async checkSensors(): Promise<{ temperature?: number; humidity?: number }> {
    if (this.learning) throw new Error('Sensor polling is paused while learning');
    const body = await this.command(this.typeInfo.isRM4 ? RMSubCommand.CHECK_SENSORS_RM4 : RMSubCommand.CHECK_SENSORS);
    if (this.typeInfo.isRM4) {
      if (body.length < 4) throw new Error('Truncated RM4 sensor response');
      return { temperature: body.readInt8(0) + body.readInt8(1) / 100, humidity: body[2] + body[3] / 100 };
    }
    if (body.length < 2) throw new Error('Truncated RM sensor response');
    return { temperature: body.readInt8(0) + body.readInt8(1) / 10 };
  }
}
