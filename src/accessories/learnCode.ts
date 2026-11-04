import { Service, CharacteristicValue } from 'homebridge';
import { BaseAccessory } from './base';
import type { BroadlinkRMPlatform } from '../platform';
import { PlatformAccessory } from 'homebridge';

export class LearnCodeAccessory extends BaseAccessory {
  private service: Service;
  private learning: boolean = false;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.service =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch, this.name);

    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
  }

  private getOn(): CharacteristicValue {
    return this.learning;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const shouldLearn = value as boolean;
    if (!shouldLearn) {
      this.learning = false;
      return;
    }

    const device = this.getDevice();
    if (!device) {
      this.log.error(`[${this.name}] Cannot learn code: Device not found for host: ${this.config.host}`);
      setTimeout(() => this.service.updateCharacteristic(this.platform.Characteristic.On, false), 500);
      return;
    }

    this.learning = true;
    this.log.info(`[${this.name}] 🔴 ENTERED LEARN MODE (${device.host}) - Press a button on your remote now...`);

    try {
      const hexCode = await device.learnData(20000, 1000);
      this.log.info(`\n****************************************************************`);
      this.log.info(`[${this.name}] 🎉 LEARNED HEX CODE:`);
      this.log.info(`"${hexCode}"`);
      this.log.info(`****************************************************************\n`);
    } catch (err: any) {
      this.log.warn(`[${this.name}] Learning stopped: ${err.message}`);
    } finally {
      this.learning = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }
  }
}

