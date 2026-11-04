import { PlatformAccessory, Service, Logging } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { RMDevice } from '../broadlink';

export abstract class BaseAccessory {
  protected readonly platform: BroadlinkRMPlatform;
  protected readonly accessory: PlatformAccessory;
  protected readonly config: Record<string, any>;
  protected readonly log: Logging;
  protected readonly name: string;

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
  protected async sendCode(code: string | Buffer): Promise<void> {
    const device = this.getDevice();
    if (!device) {
      throw new Error(`Device unreachable or not found for host: ${this.config.host}`);
    }

    try {
      await device.sendData(code);
      this.log.debug(`[${this.name}] Successfully transmitted code to ${device.host} (${device.macAddress})`);
    } catch (err: any) {
      this.log.error(`[${this.name}] Error transmitting code: ${err.message}`);
      throw err;
    }
  }
}
