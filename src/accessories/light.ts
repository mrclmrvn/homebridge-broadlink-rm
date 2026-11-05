import type { Characteristic, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';

type CodeStep = { value: number; key: string };

/** Discrete IR light controls, using legacy brightnessXX and hueXX code names. */
export class LightAccessory extends TimedAccessory {
  private readonly service: Service;
  private on = false;
  private brightness = 0;
  private lastBrightness = 0;
  private hue = 0;
  private saturation = 100;
  private colorTemperature = 140;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    this.validatePowerTimers();
    this.seconds(this.config.onDelay, 0.1);
    if (this.config.exclusives !== undefined && (!Array.isArray(this.config.exclusives)
      || this.config.exclusives.some((name: unknown) => typeof name !== 'string' || !name))) throw new Error('exclusives must be an array of accessory names');
    const C = platform.Characteristic;
    this.service = accessory.getService(platform.Service.Lightbulb)
      || accessory.addService(platform.Service.Lightbulb, this.name);
    this.service.getCharacteristic(C.On).onGet(() => this.on)
      .onSet(value => this.enqueue(() => this.setOn(Boolean(value))));
    this.optional(C.Brightness, this.steps('brightness', 1, 100).length > 0,
      () => this.brightness, value => this.setBrightness(this.number(value, 0, 100)));
    const hasHue = this.steps('hue', 0, 360).length > 0;
    this.optional(C.Hue, hasHue, () => this.hue,
      value => this.setColor(this.number(value, 0, 360), this.saturation));
    // Saturation is meaningful with discrete saturation codes or a white preset.
    this.optional(C.Saturation, hasHue, () => this.saturation,
      value => this.setColor(this.hue, this.number(value, 0, 100)));
    this.optional(C.ColorTemperature, this.steps('colorTemperature', 140, 500).length > 0,
      () => this.colorTemperature, async value => {
        const step = this.closest('colorTemperature', this.number(value, 140, 500), 140, 500);
        await this.ensureOn();
        await this.sendConfigured(step.key);
        this.markOn();
        this.colorTemperature = step.value;
        this.service.updateCharacteristic(C.ColorTemperature, this.colorTemperature);
      });
  }

  private optional(
    type: typeof Characteristic.Brightness, enabled: boolean,
    get: () => number, set: (value: CharacteristicValue) => Promise<void>,
  ): void {
    if (enabled) {
      this.service.getCharacteristic(type)!.onGet(get).onSet(value => this.enqueue(() => set(value)));
    } else if (this.service.testCharacteristic(type)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(type)!);
    }
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    return this.serialize(action);
  }

  private number(value: CharacteristicValue, min: number, max: number): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new Error(`Light value must be between ${min} and ${max}`);
    }
    return number;
  }

  private steps(prefix: string, min: number, max: number): CodeStep[] {
    return Object.keys(this.config.data || {}).flatMap(key => {
      const suffix = key.startsWith(prefix) ? key.slice(prefix.length) : '';
      if (!/^\d+(?:\.\d+)?$/.test(suffix) || !this.config.data[key]) return [];
      const value = Number(suffix);
      return value >= min && value <= max ? [{ value, key }] : [];
    }).sort((a, b) => a.value - b.value);
  }

  private closest(prefix: string, value: number, min: number, max: number, circular = false): CodeStep {
    const steps = this.steps(prefix, min, max);
    if (!steps.length) throw new Error(`[${this.name}] No ${prefix} codes configured`);
    const distance = (step: CodeStep) => {
      const delta = Math.abs(step.value - value);
      return circular ? Math.min(delta, 360 - delta) : delta;
    };
    return steps.reduce((best, step) => distance(step) < distance(best) ? step : best);
  }

  private async sendConfigured(key: string): Promise<void> {
    const code = this.config.data?.[key];
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.sendCode(code);
  }

  private async ensureOn(): Promise<void> {
    if (this.on) return;
    if (this.config.data?.on) {
      await this.sendConfigured('on');
      this.markOn();
      const delay = Number(this.config.onDelay ?? 0.1);
      if (Number.isFinite(delay) && delay > 0) {
        await this.delay(delay);
      }
    }
  }

  private markOn(): void {
    this.on = true;
    this.service.updateCharacteristic(this.platform.Characteristic.On, true);
    this.automaticPower(true, on => this.setOn(on));
    for (const instance of this.platform.instances?.values() || []) {
      if (instance !== this && instance instanceof LightAccessory
        && ((this.config.exclusives || []).includes(instance.name) || (instance.config.exclusives || []).includes(this.name))) {
        instance.on = false;
        instance.brightness = 0;
        instance.cancelTimer('power-auto');
        instance.service.updateCharacteristic(this.platform.Characteristic.On, false);
        if (instance.service.testCharacteristic(this.platform.Characteristic.Brightness)) instance.service.updateCharacteristic(this.platform.Characteristic.Brightness, 0);
      }
    }
  }

  private async setOn(target: boolean): Promise<void> {
    if (target === this.on) return;
    if (target && this.steps('brightness', 1, 100).length) {
      const requested = this.config.useLastKnownBrightness && this.lastBrightness > 0
        ? this.lastBrightness : this.number(this.config.defaultBrightness ?? 100, 1, 100);
      await this.setBrightness(requested);
      return;
    }
    await this.sendConfigured(target ? 'on' : 'off');
    this.on = target;
    if (target) this.markOn();
    else this.automaticPower(false, on => this.setOn(on));
    if (!target) {
      this.brightness = 0;
      if (this.service.testCharacteristic(this.platform.Characteristic.Brightness)) {
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, 0);
      }
    }
  }

  private async setBrightness(value: number): Promise<void> {
    if (value === 0) {
      await this.setOn(false);
      return;
    }
    const step = this.closest('brightness', value, 1, 100);
    if (this.on && step.value === this.brightness) return;
    await this.ensureOn();
    await this.sendConfigured(step.key);
    this.brightness = this.lastBrightness = step.value;
    this.markOn();
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.brightness);
  }

  private async setColor(hue: number, saturation: number): Promise<void> {
    const color = this.closest('hue', hue, 0, 360, true);
    const saturationSteps = this.steps('saturation', 0, 100);
    const white = saturation < 10 && this.config.data?.white;
    if (!white && !saturationSteps.length && saturation !== 100) {
      throw new Error('This light supports 100% saturation and, with a white code, saturation below 10%');
    }
    await this.ensureOn();
    if (white) {
      await this.sendConfigured('white');
      this.saturation = 0;
    } else {
      await this.sendConfigured(color.key);
      this.markOn();
      // Commit hue once its command succeeds, even if a later saturation send fails.
      this.hue = color.value;
      this.saturation = 100;
      this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.hue);
      this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.saturation);
      if (saturationSteps.length) {
        const step = this.closest('saturation', saturation, 0, 100);
        await this.sendConfigured(step.key);
        this.saturation = step.value;
      }
    }
    this.markOn();
    this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.hue);
    this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.saturation);
  }
}
