import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { compileCommands, type CommandStep } from '../helpers/commands';
import { stateEnum, stateNumber } from '../helpers/state';

type DirectionalSpeed = { speed: number; steps: CommandStep[] };
const directionKeys = ['clockwise', 'counterClockwise'] as const;

function readDirectionalSpeeds(value: unknown): DirectionalSpeed[][] {
  function asMap(input: unknown, name: string): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error(name + ' must be an object');
    }
    return input as Record<string, unknown>;
  }

  const map = asMap(value, 'fanSpeedByDirection');
  return directionKeys.map(direction => {
    const name = 'fanSpeedByDirection.' + direction;
    const entries = Object.entries(asMap(map[direction], name));
    if (!entries.length) throw new Error(name + ' requires at least one speed code');
    return entries.map(([key, code]) => {
      if (!/^fanSpeed(?:[1-9][0-9]?|100)$/.test(key)) {
        throw new Error(name + ' requires fanSpeed1 through fanSpeed100 keys');
      }
      try {
        return { speed: Number(key.slice(8)), steps: compileCommands(code) };
      } catch (error) {
        throw new Error(name + '.' + key + ': ' + (error as Error).message);
      }
    }).sort((a, b) => a.speed - b.speed);
  });
}

/** Shared fan controls for Fan/Fanv2, purifier, and humidity appliances. */
export class FanAccessory extends TimedAccessory {
  protected readonly service: Service;
  private readonly stepSize: number;
  private readonly directionalSpeeds?: DirectionalSpeed[][];
  protected active = 0;
  private speed = 0;
  private direction = 0;
  private swing = 0;
  private cycleStep?: number;
  private controlsLocked = 0;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    this.validatePowerTimers();
    const steps = Number(this.config.speedSteps);
    if (this.config.speedCycle && (!Number.isInteger(steps) || steps < 1 || steps > 100 || !this.config.data?.fanSpeed)) {
      throw new Error('speedCycle requires speedSteps (1..100) and data.fanSpeed');
    }
    this.seconds(this.config.speedCycleInterval, 0.1);
    if (this.config.defaultFanSpeed !== undefined && (typeof this.config.defaultFanSpeed !== 'number'
      || !Number.isFinite(this.config.defaultFanSpeed) || this.config.defaultFanSpeed <= 0 || this.config.defaultFanSpeed > 100)) throw new Error('Invalid defaultFanSpeed');
    if (this.config.defaultSpeedStep !== undefined && (!Number.isInteger(this.config.defaultSpeedStep) || this.config.defaultSpeedStep < 1
      || this.config.defaultSpeedStep > (Number.isInteger(steps) ? steps : 100))) throw new Error('Invalid defaultSpeedStep');
    const configuredStep = Number(this.config.stepSize ?? 1);
    this.stepSize = Number.isInteger(steps) && steps >= 1 && steps <= 100
      ? Math.floor(100 / steps)
      : Number.isFinite(configuredStep) && configuredStep >= 1 && configuredStep <= 100
        ? configuredStep : 1;
    if (this.config.defaultSpeedStep !== undefined && this.config.defaultSpeedStep * this.stepSize > 100) throw new Error('Default fan speed exceeds 100 percent');
    const kind = String(this.config.type).toLowerCase();
    const legacy = kind === 'fanv1';
    if (this.config.fanSpeedByDirection !== undefined) {
      if ((kind !== 'fan' && !legacy) || this.config.speedCycle) {
        throw new Error('fanSpeedByDirection requires a fan or fanv1 without speedCycle');
      }
      this.directionalSpeeds = readDirectionalSpeeds(this.config.fanSpeedByDirection);
    }
    const serviceType = legacy ? platform.Service.Fan : kind === 'air-purifier'
      ? platform.Service.AirPurifier : kind === 'humidifier-dehumidifier'
        ? platform.Service.HumidifierDehumidifier : platform.Service.Fanv2;
    this.service = accessory.getService(serviceType) || accessory.addService(serviceType, this.name);
    const C = platform.Characteristic;
    const speedValues = Object.keys(this.config.data || {}).filter(key => /^fanSpeed\d+$/.test(key)).map(key => Number(key.slice(8)));
    this.restoreState({ active: stateEnum(0, 1), speed: (value, state) => stateNumber(0, 100)(value, {})
      && (value === 0 || this.config.speedCycle && Number.isInteger(Number(value) / this.stepSize) || (this.directionalSpeeds
        ? this.directionalSpeeds[state.direction === 1 ? 1 : 0].some(entry => entry.speed === value)
        : speedValues.includes(Number(value)))) });
    if (!this.active) this.speed = 0;
    if (legacy) {
      this.service.getCharacteristic(C.On).onGet(() => Boolean(this.active))
        .onSet(value => this.serialize(() => this.setActive(value)));
    } else {
      this.service.getCharacteristic(C.Active).onGet(() => this.active)
        .onSet(value => this.serialize(() => this.setActive(value)));
    }
    const hasSpeed = kind === 'fan' || legacy || this.config.speedCycle || Object.keys(this.config.data || {}).some(key => /^fanSpeed\d+$/.test(key));
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
          if (this.directionalSpeeds) {
            if (this.active) {
              await this.sendDirectionalSpeed(this.speed || this.defaultSpeed(), target);
              return;
            }
          } else {
            await this.sendConfigured(directionKeys[target]);
          }
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
    const hasDirection = this.service.testCharacteristic(C.RotationDirection);
    if (hasDirection || this.directionalSpeeds) this.restoreState({ direction: stateEnum(0, 1) });
    if (hasDirection) {
      this.service.updateCharacteristic(C.RotationDirection, this.direction);
    }
    if (this.service.testCharacteristic(C.SwingMode)) {
      this.restoreState({ swing: stateEnum(0, 1) });
      this.service.updateCharacteristic(C.SwingMode, this.swing);
    }
    this.publishPower();
    if (hasSpeed) this.service.updateCharacteristic(C.RotationSpeed, this.speed);
    if (kind === 'fan' || legacy) this.watchFanPower();
  }

  protected watchFanPower(): void {
    this.watchPower(on => {
      if (this.active !== Number(on)) this.cancelTimer('power-auto');
      this.active = Number(on);
      if (!on) { this.speed = 0; this.cycleStep = undefined; }
      this.publishPower();
      if (this.service.testCharacteristic(this.platform.Characteristic.RotationSpeed)) this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.speed);
      this.observedActiveChanged();
    });
  }

  protected observedActiveChanged(): void {}

  protected setupPhysicalLock(): void {
    const C = this.platform.Characteristic;
    if (this.config.showLockPhysicalControls !== false && this.config.data?.lockControls && this.config.data?.unlockControls) {
      this.restoreState({ controlsLocked: stateEnum(0, 1) });
      this.service.getCharacteristic(C.LockPhysicalControls).updateValue(this.controlsLocked).onGet(() => this.controlsLocked)
        .onSet(value => this.serialize(async () => {
          const target = Number(value);
          if (![0, 1].includes(target)) throw new Error('Invalid physical control lock state');
          if (target === this.controlsLocked) return;
          await this.sendConfigured(target ? 'lockControls' : 'unlockControls');
          this.controlsLocked = target;
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

  protected async setActive(value: CharacteristicValue, applyDefaults = true): Promise<void> {
    const target = Number(value) ? 1 : 0;
    const required = this.power ? await this.power.requiresSend(Boolean(target)) : target !== this.active;
    if (!required) {
      this.active = target;
      if (!target) {
        this.speed = 0; this.cycleStep = undefined;
        if (this.service.testCharacteristic(this.platform.Characteristic.RotationSpeed)) this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      }
      this.publishPower();
      this.observedActiveChanged();
      return;
    }
    if (target && this.directionalSpeeds) {
      await this.sendDirectionalSpeed(this.defaultSpeed(), this.direction, true);
      return;
    }
    await this.sendConfigured(target ? 'on' : 'off');
    this.power?.recordSent(Boolean(target));
    this.cycleStep = target && this.config.speedCycle ? this.config.defaultSpeedStep ?? 1 : undefined;
    this.active = target;
    if (this.cycleStep !== undefined) {
      this.speed = this.cycleStep * this.stepSize;
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.speed);
    }
    this.publishPower();
    if (!target) {
      this.speed = 0;
      if (this.service.testCharacteristic(this.platform.Characteristic.RotationSpeed)) {
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      }
    }
    await this.activeChanged();
    this.automaticPower(Boolean(target), on => this.setActive(on));
    if (target && applyDefaults && this.config.alwaysResetToDefaults) {
      await this.setSpeed(this.defaultSpeed());
    }
  }

  protected async activeChanged(): Promise<void> {}

  private publishPower(): void {
    if (String(this.config.type).toLowerCase() === 'fanv1') {
      this.service.updateCharacteristic(this.platform.Characteristic.On, Boolean(this.active));
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.active);
    }
  }

  private defaultSpeed(): number {
    return this.config.defaultSpeedStep
      ? this.config.defaultSpeedStep * this.stepSize
      : this.config.defaultFanSpeed ?? 100;
  }

  private async sendDirectionalSpeed(requested: number, direction: number, force = false): Promise<void> {
    const speeds = this.directionalSpeeds![direction];
    const closest = speeds.reduce((best, entry) =>
      Math.abs(entry.speed - requested) < Math.abs(best.speed - requested) ? entry : best);
    if (!force && this.active && this.direction === direction && this.speed === closest.speed) return;
    await this.sendCommands(closest.steps);
    this.power?.recordSent(true);
    this.active = 1;
    this.speed = closest.speed;
    this.direction = direction;
    this.publishPower();
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.speed);
    this.automaticPower(true, on => this.setActive(on));
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
    if (this.directionalSpeeds) {
      await this.sendDirectionalSpeed(requested, this.direction);
      return;
    }
    if (this.config.speedCycle) {
      await this.setActive(1, false);
      if (this.cycleStep === undefined) throw new Error('Fan cycle position is unknown; turn off and on before selecting speed');
      const steps = Array.from({ length: this.config.speedSteps }, (_, index) => index + 1);
      const target = steps.reduce((best, step) => Math.abs(step * this.stepSize - requested) < Math.abs(best * this.stepSize - requested) ? step : best);
      const count = (target - this.cycleStep + steps.length) % steps.length;
      for (let i = 0; i < count; i++) {
        try { await this.sendConfigured('fanSpeed'); }
        catch (error) { this.cycleStep = undefined; throw error; }
        this.cycleStep = this.cycleStep % steps.length + 1;
        this.speed = this.cycleStep * this.stepSize;
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.speed);
        if (i < count - 1) await this.delay(this.seconds(this.config.speedCycleInterval, 0.1));
      }
      this.speed = target * this.stepSize;
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.speed);
      this.automaticPower(true, on => this.setActive(on));
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
    await this.setActive(1, false);
    await this.sendConfigured(`fanSpeed${closest}`);
    this.speed = closest;
    this.publishPower();
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, closest);
    this.automaticPower(true, on => this.setActive(on));
  }
}
