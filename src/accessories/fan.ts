import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';

/** Shared fan controls for Fan/Fanv2, purifier, and humidity appliances. */
export class FanAccessory extends TimedAccessory {
  protected readonly service: Service;
  private readonly stepSize: number;
  protected active = 0;
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
    const kind = String(this.config.type).toLowerCase();
    const legacy = kind === 'fanv1';
    const serviceType = legacy ? platform.Service.Fan : kind === 'air-purifier'
      ? platform.Service.AirPurifier : kind === 'humidifier-dehumidifier'
        ? platform.Service.HumidifierDehumidifier : platform.Service.Fanv2;
    this.service = accessory.getService(serviceType) || accessory.addService(serviceType, this.name);
    const C = platform.Characteristic;
    if (legacy) {
      this.service.getCharacteristic(C.On).onGet(() => Boolean(this.active))
        .onSet(value => this.serialize(() => this.setActive(value)));
    } else {
      this.service.getCharacteristic(C.Active).onGet(() => this.active)
        .onSet(value => this.serialize(() => this.setActive(value)));
    }
    const hasSpeed = kind === 'fan' || legacy || Object.keys(this.config.data || {}).some(key => /^fanSpeed\d+$/.test(key));
    if (hasSpeed) this.service.getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: this.stepSize })
      .onGet(() => this.speed).onSet(value => this.serialize(() => this.setSpeed(value)));
    else if (this.service.testCharacteristic(C.RotationSpeed)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(C.RotationSpeed));
    }
    if ((kind === 'fan' || legacy) && this.config.hideRotationDirection !== true && this.config.showRotationDirection !== false) {
      this.service.getCharacteristic(C.RotationDirection)
        .onGet(() => this.direction).onSet(value => this.serialize(async () => {
          const target = Number(value);
          if (![0, 1].includes(target)) throw new Error('Invalid rotation direction');
          if (target === this.direction) return;
          await this.sendConfigured(target === C.RotationDirection.CLOCKWISE ? 'clockwise' : 'counterClockwise');
          this.direction = target;
        }));
    } else {
      const characteristic = this.service.testCharacteristic(C.RotationDirection)
        && this.service.getCharacteristic(C.RotationDirection);
      if (characteristic) this.service.removeCharacteristic(characteristic);
    }
    const hasSwing = kind === 'fan' || this.config.data?.swingToggle || this.config.data?.swingOn || this.config.data?.swingOff;
    if (!legacy && hasSwing && this.config.hideSwingMode !== true && this.config.showSwingMode !== false) {
      this.service.getCharacteristic(C.SwingMode)
        .onGet(() => this.swing).onSet(value => this.serialize(async () => {
          const target = Number(value);
          if (![0, 1].includes(target)) throw new Error('Invalid swing mode');
          if (target === this.swing) return;
          const key = target === C.SwingMode.SWING_ENABLED ? 'swingOn' : 'swingOff';
          await this.sendConfigured(this.config.data?.[key] ? key : 'swingToggle');
          this.swing = target;
        }));
    } else {
      const characteristic = this.service.testCharacteristic(C.SwingMode)
        && this.service.getCharacteristic(C.SwingMode);
      if (characteristic) this.service.removeCharacteristic(characteristic);
    }
  }

  protected setupPhysicalLock(): void {
    const C = this.platform.Characteristic;
    if (this.config.showLockPhysicalControls !== false && this.config.data?.lockControls && this.config.data?.unlockControls) {
      let locked = 0;
      this.service.getCharacteristic(C.LockPhysicalControls).onGet(() => locked)
        .onSet(value => this.serialize(async () => {
          const target = Number(value);
          if (![0, 1].includes(target)) throw new Error('Invalid physical control lock state');
          if (target === locked) return;
          await this.sendConfigured(target ? 'lockControls' : 'unlockControls');
          locked = target;
        }));
    } else if (this.service.testCharacteristic(C.LockPhysicalControls)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(C.LockPhysicalControls));
    }
  }

  protected async sendConfigured(key: string): Promise<void> {
    const code = this.config.data?.[key];
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.transmit(key);
  }

  protected async setActive(value: CharacteristicValue): Promise<void> {
    const target = Number(value) ? 1 : 0;
    if (target === this.active) return;
    await this.sendConfigured(target ? 'on' : 'off');
    this.active = target;
    this.publishPower();
    if (!target) {
      this.speed = 0;
      if (this.service.testCharacteristic(this.platform.Characteristic.RotationSpeed)) {
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      }
    }
    await this.activeChanged();
  }

  protected async activeChanged(): Promise<void> {}

  private publishPower(): void {
    if (String(this.config.type).toLowerCase() === 'fanv1') {
      this.service.updateCharacteristic(this.platform.Characteristic.On, Boolean(this.active));
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.active);
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
    this.publishPower();
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, closest);
  }
}
