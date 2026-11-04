import { BroadlinkDevice } from './device';
import { PacketCommand, RMSubCommand } from './constants';

export class RMDevice extends BroadlinkDevice {
  /**
   * Helper to format inner RM payload depending on whether the device is RM4 or RM2/3
   */
  private formatRMPayload(subCommand: number, data?: Buffer): Buffer {
    const isRM4 = this.typeInfo.isRM4;
    const dataLen = data ? data.length : 0;

    if (isRM4) {
      // RM4 protocol: <H (len + 4), <I (command), payload
      const packet = Buffer.alloc(6 + dataLen);
      packet.writeUInt16LE(dataLen + 4, 0);
      packet.writeUInt32LE(subCommand, 2);
      if (data) {
        data.copy(packet, 6);
      }
      return packet;
    } else {
      // Legacy RM2/3 protocol: 4-byte command prefix, payload
      const header = Buffer.alloc(4);
      header.writeUInt32LE(subCommand, 0);
      return data ? Buffer.concat([header, data]) : header;
    }
  }

  /**
   * Send raw IR or RF data bytes
   * @param data Buffer or hex string representing the code
   */
  public async sendData(data: Buffer | string): Promise<void> {
    const buffer = typeof data === 'string' ? Buffer.from(data.replace(/\s+/g, ''), 'hex') : data;

    return this.synchronized(async () => {
      if (!this.isAuthenticated) {
        await this.auth();
      }

      const payload = this.formatRMPayload(RMSubCommand.SEND_DATA, buffer);
      await this.sendPacket(PacketCommand.COMMAND, payload);
    });
  }

  /**
   * Put the device into IR learning mode
   */
  public async enterLearning(): Promise<void> {
    return this.synchronized(async () => {
      if (!this.isAuthenticated) {
        await this.auth();
      }

      const payload = this.formatRMPayload(RMSubCommand.ENTER_LEARN);
      await this.sendPacket(PacketCommand.COMMAND, payload);
    });
  }

  /**
   * Check if a learned code is available
   */
  public async checkData(): Promise<Buffer | null> {
    return this.synchronized(async () => {
      if (!this.isAuthenticated) {
        await this.auth();
      }

      const payload = this.formatRMPayload(RMSubCommand.CHECK_DATA);
      try {
        const response = await this.sendPacket(PacketCommand.COMMAND, payload);
        if (!response || response.length <= 4) {
          return null;
        }

        const dataOffset = this.typeInfo.isRM4 ? 6 : 4;
        if (response.length <= dataOffset) {
          return null;
        }

        const learnedCode = response.slice(dataOffset);
        // Verify non-empty
        if (learnedCode.length > 0 && learnedCode.some((b) => b !== 0)) {
          return Buffer.from(learnedCode);
        }
        return null;
      } catch {
        return null;
      }
    });
  }

  /**
   * Poll for a learned code until timeout
   * @param timeoutMs Maximum milliseconds to wait (default 30 seconds)
   * @param intervalMs Polling interval (default 1 second)
   * @returns Hex string of the captured code
   */
  public async learnData(timeoutMs: number = 30000, intervalMs: number = 1000): Promise<string> {
    await this.enterLearning();

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const code = await this.checkData();
      if (code && code.length > 0) {
        return code.toString('hex');
      }
    }

    throw new Error(`Learning timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
  }

  /**
   * Query built-in or external cable sensors (temperature / humidity)
   */
  public async checkSensors(): Promise<{ temperature?: number; humidity?: number }> {
    return this.synchronized(async () => {
      if (!this.isAuthenticated) {
        await this.auth();
      }

      const payload = this.formatRMPayload(RMSubCommand.CHECK_SENSORS);
      const response = await this.sendPacket(PacketCommand.COMMAND, payload);

      if (this.typeInfo.isRM4) {
        // RM4 HTS2 sensor layout:
        // offset 6: integer temp, offset 7: decimal temp
        // offset 8: integer humidity, offset 9: decimal humidity
        if (response.length >= 10) {
          const temp = response[6] + response[7] / 100.0;
          const humidity = response[8] + response[9] / 100.0;
          return { temperature: temp, humidity };
        }
      } else {
        // Legacy RM2/RM Pro sensors
        if (response.length >= 8) {
          const temp = (response[4] * 10 + response[5]) / 10.0;
          return { temperature: temp };
        }
      }

      return {};
    });
  }
}

