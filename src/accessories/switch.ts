import { Service, CharacteristicValue } from 'homebridge';
import { BaseAccessory } from './base';
import type { BroadlinkRMPlatform } from '../platform';
import { PlatformAccessory } from 'homebridge';

export class SwitchAccessory extends BaseAccessory {
  private service: Service;
  private state: boolean = false;
  private autoOffTimer?: NodeJS.Timeout;

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
    return this.state;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const targetState = value as boolean;
    this.state = targetState;

    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
      this.autoOffTimer = undefined;
    }

    const data = this.config.data || {};
    const code = targetState ? data.on : data.off;

    if (code) {
      this.log.info(`[${this.name}] Turning ${targetState ? 'ON' : 'OFF'}`);
      await this.sendCode(code);
    } else {
      this.log.warn(`[${this.name}] No IR/RF code configured for "${targetState ? 'on' : 'off'}"`);
    }

    // Handle stateless switch / auto-off duration
    const onDuration = this.config.onDuration;
    const isStateless = this.config.stateless || false;

    if (targetState && (isStateless || (onDuration && onDuration > 0))) {
      const delayMs = (onDuration || 0.5) * 1000;
      this.autoOffTimer = setTimeout(() => {
        this.state = false;
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
        this.log.debug(`[${this.name}] Auto-off timer fired, reset to OFF`);
      }, delayMs);
    }
  }
}

