import { execFile } from 'node:child_process';
import { isIPv4 } from 'node:net';
import { performance } from 'node:perf_hooks';
import { MQTTSensor } from './mqtt';

export type PowerState = boolean | undefined;
export interface ProbeResult { code?: number; stdout: string }
export type Runner = (file: string, args: string[], timeout: number, signal: AbortSignal) => Promise<ProbeResult>;

const run: Runner = (file, args, timeout, signal) => new Promise(resolve => {
  execFile(file, args, { timeout, signal, encoding: 'utf8', maxBuffer: 65536, windowsHide: true }, (error, stdout) => {
    resolve({ stdout, code: !error ? 0 : typeof error.code === 'number' && !error.killed ? error.code : undefined });
  });
});

/** Bounded system utilities, with arguments kept separate from the executable. */
export async function probePower(address: string, arp: boolean, timeoutMs: number, signal: AbortSignal,
  platform = process.platform, execute: Runner = run): Promise<PowerState> {
  if (!isIPv4(address)) throw new Error('pingIPAddress must be an IPv4 address');
  if (signal.aborted) return undefined;
  if (arp) {
    let result: ProbeResult;
    if (platform === 'linux') {
      result = await execute('ip', ['neigh', 'show', 'to', address], timeoutMs, signal);
      if (result.code === 0) {
        const line = result.stdout.split(/\r?\n/).find(line => line.split(/\s+/)[0] === address);
        if (!line || /\b(?:FAILED|INCOMPLETE)\b/.test(line)) return false;
        return /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i.test(line) ? true : undefined;
      }
    }
    if (!['linux', 'darwin', 'win32'].includes(platform)) return undefined;
    result = await execute('arp', [platform === 'win32' ? '-a' : '-n', address], timeoutMs, signal);
    if (result.code === undefined || ![0, 1].includes(result.code)) return undefined;
    const escaped = address.replace(/\./g, '\\.');
    const line = result.stdout.split(/\r?\n/).find(line => new RegExp(`(?:^|[^0-9.])${escaped}(?:$|[^0-9.])`).test(line));
    if (!line) return result.code === 0 || result.code === 1 ? false : undefined;
    if (/incomplete/i.test(line)) return false;
    return /\b(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}\b/i.test(line) ? true : undefined;
  }
  const args = platform === 'win32' ? ['-n', '1', '-w', String(timeoutMs), address]
    : ['-n', '-c', '1', '-W', String(platform === 'darwin' ? timeoutMs : Math.ceil(timeoutMs / 1000)), address];
  if (!['linux', 'darwin', 'win32'].includes(platform)) return undefined;
  const result = await execute('ping', args, timeoutMs + 1000, signal);
  if (result.code === 0) return platform === 'win32' ? (/\bttl[= ]\d+/i.test(result.stdout) ? true : undefined) : true;
  if (result.code === 1 || platform === 'darwin' && result.code === 2 && /\b0 (?:packets )?received\b/i.test(result.stdout)) return false;
  return undefined;
}

export class PowerMonitor {
  private readonly abort = new AbortController();
  private readonly interval: number;
  private readonly grace: number;
  private readonly timeout: number;
  private readonly minimumPingFailures: number;
  private readonly wattage?: { source: MQTTSensor; threshold: number };
  private consecutivePingFailures = 0;
  private timer?: NodeJS.Timeout;
  private pending?: Promise<PowerState>;
  private epoch = 0;
  private graceUntil = 0;
  private sentState?: boolean;

  constructor(private readonly config: Record<string, any>) {
    const powerSensor = config.powerSensor;
    if (powerSensor !== undefined) {
      if (!powerSensor || typeof powerSensor !== 'object' || Array.isArray(powerSensor)) {
        throw new Error('powerSensor must be an object');
      }
      if (config.pingIPAddress !== undefined) throw new Error('Configure either powerSensor or pingIPAddress');
      if (!Number.isFinite(powerSensor.onThresholdWatts) || powerSensor.onThresholdWatts <= 0) {
        throw new Error('powerSensor.onThresholdWatts must be a positive finite number');
      }
    } else if (!isIPv4(config.pingIPAddress)) throw new Error('pingIPAddress must be an IPv4 address');
    const seconds = (value: unknown, fallback: number, zero = false) => {
      const number = value ?? fallback;
      if (typeof number !== 'number' || !Number.isFinite(number) || number < (zero ? 0 : 0.001) || number > 2147483) throw new Error('Invalid power-detection duration');
      return number * 1000;
    };
    this.interval = seconds(config.pingFrequency, 1);
    this.grace = seconds(config.pingGrace, 10, true);
    this.timeout = seconds(config.pingTimeout, 2);
    if (this.timeout > 60000) throw new Error('pingTimeout must not exceed 60 seconds');
    const minimum = config.minimumPingFailures === undefined ? 1 : config.minimumPingFailures;
    if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error('minimumPingFailures must be a positive integer');
    this.minimumPingFailures = minimum;
    if (powerSensor !== undefined) {
      this.wattage = {
        source: new MQTTSensor({ ...powerSensor, type: 'power' }),
        threshold: powerSensor.onThresholdWatts,
      };
    }
  }

  public start(update: (on: boolean) => void): void {
    const poll = async () => {
      const epoch = this.epoch;
      const usingSentState = performance.now() < this.graceUntil;
      try {
        const state = await this.query(usingSentState);
        if (!this.abort.signal.aborted && epoch === this.epoch) {
          if (usingSentState || this.wattage || this.config.pingUseArp === true) {
            if (state !== undefined) update(state);
          } else if (state === false) {
            this.consecutivePingFailures = Math.min(this.minimumPingFailures, this.consecutivePingFailures + 1);
            if (this.consecutivePingFailures === this.minimumPingFailures) update(false);
          } else {
            this.consecutivePingFailures = 0;
            if (state === true) update(true);
          }
        }
      } catch {
        if (epoch === this.epoch) this.consecutivePingFailures = 0;
      }
      if (!this.abort.signal.aborted) this.timer = setTimeout(() => { void poll(); }, this.interval);
    };
    this.timer = setTimeout(() => { void poll(); }, 0);
  }

  private async query(useSentState = performance.now() < this.graceUntil): Promise<PowerState> {
    if (this.abort.signal.aborted) throw new Error('Power monitor is closed');
    if (useSentState) return this.sentState;
    if (this.wattage) {
      try { return this.wattage.source.read('power') >= this.wattage.threshold; }
      catch { return undefined; }
    }
    if (!this.pending) this.pending = probePower(this.config.pingIPAddress, this.config.pingUseArp === true, this.timeout, this.abort.signal);
    const pending = this.pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = undefined; }
  }

  public async requiresSend(target: boolean): Promise<boolean> {
    if (this.config.pingIPAddressStateOnly) return true;
    const state = await this.query();
    if (this.abort.signal.aborted) throw new Error('Power monitor is closed');
    if (state === undefined) throw new Error('Power state is indeterminate; no toggle was sent');
    return state !== target;
  }

  public recordSent(target: boolean): void {
    if (this.config.pingIPAddressStateOnly) return;
    this.consecutivePingFailures = 0;
    this.sentState = target;
    this.graceUntil = performance.now() + this.grace;
    this.epoch++;
  }

  public dispose(): void {
    this.abort.abort();
    clearTimeout(this.timer);
    this.wattage?.source.dispose();
  }
}
