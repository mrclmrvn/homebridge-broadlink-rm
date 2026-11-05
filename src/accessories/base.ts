import { PlatformAccessory, Service, Logging } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { RMDevice } from '../broadlink';
import { compileCommands, type CommandStep } from '../helpers/commands';

export abstract class BaseAccessory {
  protected readonly platform: BroadlinkRMPlatform;
  protected readonly accessory: PlatformAccessory;
  protected readonly config: Record<string, any>;
  protected readonly log: Logging;
  protected readonly name: string;
  private readonly commandShutdown = new AbortController();

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = accessory.context.config || {};
    this.log = platform.log;
    this.name = this.config.name || accessory.displayName || 'Broadlink Accessory';

    // Configure standard AccessoryInformation Service
    const infoService =
      this.accessory.getService(this.platform.Service.AccessoryInformation) ||
      this.accessory.addService(this.platform.Service.AccessoryInformation);

    infoService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Broadlink')
      .setCharacteristic(this.platform.Characteristic.Model, this.config.type || 'RM Accessory')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.UUID)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '5.0.0');
  }

  /** Release accessory-owned resources on platform shutdown or removal. */
  public dispose(): void { this.commandShutdown.abort(); }

  /**
   * Resolve the Broadlink RM device for this accessory
   */
  protected getDevice(): RMDevice | undefined {
    const dev = this.platform.deviceManager.getDevice(this.config.host);
    if (!dev) {
      this.log.warn(`[${this.name}] No Broadlink device found for host: ${this.config.host || '(default)'}.`);
    }
    return dev;
  }

  /**
   * Send an IR or RF hex code
   */
  protected async sendCode(code: unknown): Promise<void> {
    await this.sendCommands(compileCommands(code));
  }

  protected async sendCommands(steps: readonly CommandStep[]): Promise<void> {
    const signal = this.commandShutdown.signal;
    if (signal.aborted) throw new Error('Accessory has shut down');
    const device = this.getDevice();
    if (!device) throw new Error(`Device unreachable or not found for host: ${this.config.host}`);
    for (const step of steps) {
      if (signal.aborted) throw new Error('Accessory has shut down');
      if ('delay' in step) {
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { clearTimeout(timer); reject(new Error('Accessory has shut down')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, step.delay * 1000);
          signal.addEventListener('abort', aborted, { once: true });
        });
      } else {
        try { await device.sendData(step.code); }
        catch (error) { this.log.error(`[${this.name}] Code transmission failed`); throw error; }
        if (signal.aborted) throw new Error('Accessory has shut down');
      }
    }
    this.log.debug(`[${this.name}] Transmitted code to ${device.host}`);
  }
}
