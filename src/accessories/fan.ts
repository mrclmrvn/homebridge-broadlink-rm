import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { BaseAccessory } from './base';

/** Fanv2 controls using the legacy fan configuration and code names. */
export class FanAccessory extends BaseAccessory {
  private readonly service: Service;
  private readonly stepSize: number;
  private active = 0;
  private speed = 0;
  private direction = 0;
  private swing = 0;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const steps = Number(this.config.speedSteps);
    const configuredStep = Number(this.config.stepSize ?? 1);
    this.stepSize = Number.isInteger(steps) && steps >= 1 && steps <= 100
      ? Math.floor(100 / steps)
      : Number.isFinite(configuredStep) && configuredStep >= 1 && configuredStep <= 100
        ? configuredStep : 1;
    this.service = accessory.getService(platform.Service.Fanv2)
      || accessory.addService(platform.Service.Fanv2, this.name);
    const C = platform.Characteristic;
    this.service.getCharacteristic(C.Active)
      .onGet(() => this.active).onSet(value => this.setActive(value));
    this.service.getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: this.stepSize })
      .onGet(() => this.speed).onSet(value => this.setSpeed(value));
    if (this.config.hideRotationDirection !== true && this.config.showRotationDirection !== false) {
      this.service.getCharacteristic(C.RotationDirection)
        .onGet(() => this.direction).onSet(async value => {
          const target = Number(value);
          if (target === this.direction) return;
          await this.sendConfigured(target === C.RotationDirection.CLOCKWISE ? 'clockwise' : 'counterClockwise');
          this.direction = target;
        });
    } else {
      const characteristic = this.service.testCharacteristic(C.RotationDirection)
        && this.service.getCharacteristic(C.RotationDirection);
      if (characteristic) this.service.removeCharacteristic(characteristic);
    }
    if (this.config.hideSwingMode !== true && this.config.showSwingMode !== false) {
      this.service.getCharacteristic(C.SwingMode)
        .onGet(() => this.swing).onSet(async value => {
          const target = Number(value);
          if (target === this.swing) return;
          const key = target === C.SwingMode.SWING_ENABLED ? 'swingOn' : 'swingOff';
          await this.sendConfigured(this.config.data?.[key] ? key : 'swingToggle');
          this.swing = target;
        });
    } else {
      const characteristic = this.service.testCharacteristic(C.SwingMode)
        && this.service.getCharacteristic(C.SwingMode);
      if (characteristic) this.service.removeCharacteristic(characteristic);
    }
  }

  private async sendConfigured(key: string): Promise<void> {
    const code = this.config.data?.[key];
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.sendCode(code);
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    const target = Number(value) ? 1 : 0;
    if (target === this.active) return;
    await this.sendConfigured(target ? 'on' : 'off');
    this.active = target;
    if (!target) {
      this.speed = 0;
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
    }
  }

  private async setSpeed(value: CharacteristicValue): Promise<void> {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested < 0 || requested > 100) {
      throw new Error('Fan speed must be between 0 and 100');
    }
    if (requested === 0) {
      await this.setActive(0);
      return;
    }
    const speeds = Object.keys(this.config.data || {})
      .filter(key => /^fanSpeed\d+$/.test(key))
      .map(key => Number(key.slice(8)))
      .filter(speed => speed > 0 && speed <= 100)
      .sort((a, b) => a - b);
    if (!speeds.length) throw new Error(`[${this.name}] No fanSpeedXX codes configured`);
    const closest = speeds.reduce((best, speed) =>
      Math.abs(speed - requested) < Math.abs(best - requested) ? speed : best);
    if (this.active && closest === this.speed) return;
    await this.setActive(1);
    await this.sendConfigured(`fanSpeed${closest}`);
    this.speed = closest;
    this.service.updateCharacteristic(this.platform.Characteristic.Active, this.active);
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, closest);
  }
}
