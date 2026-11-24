import type { Characteristic, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { stateBoolean } from '../helpers/state';

type CodeStep = { value: number; key: string };

/** Discrete IR light controls, using legacy brightnessXX and hueXX code names. */
export class LightAccessory extends TimedAccessory {
  private readonly service: Service;
  private readonly relativeLevels: number[] = [];
  private relativeBrightnessUncertain = false;
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
    if (this.config.stateless) this.seconds(this.config.onDuration, 0.5, true);
    if (this.config.exclusives !== undefined && (!Array.isArray(this.config.exclusives)
      || this.config.exclusives.some((name: unknown) => typeof name !== 'string' || !name))) throw new Error('exclusives must be an array of accessory names');
    const count = this.config.availableBrightnessSteps;
    if (count !== undefined) {
      if (!Number.isInteger(count) || count < 2 || count > 100) {
        throw new Error('availableBrightnessSteps must be an integer from 2 to 100');
      }
      if (!['on', 'off', 'brightness+', 'brightness-'].every(key => this.config.data?.[key])) {
        throw new Error('availableBrightnessSteps requires data.on, data.off, data.brightness+ and data.brightness-');
      }
      this.number(this.config.defaultBrightness ?? 100, 1, 100);
      this.relativeLevels = Array.from({ length: count }, (_, index) => Math.round(100 * (index + 1) / count));
    }
    const levels = this.relativeLevels.length ? this.relativeLevels : this.steps('brightness', 1, 100).map(step => step.value);
    const validBrightness = (value: unknown) => value === 0 || typeof value === 'number' && levels.includes(value);
    this.restoreState({
      ...(!this.config.stateless ? { on: stateBoolean } : {}),
      brightness: validBrightness,
      lastBrightness: validBrightness,
      ...(this.relativeLevels.length ? { relativeBrightnessUncertain: stateBoolean } : {}),
      hue: value => this.steps('hue', 0, 360).some(step => step.value === value),
      saturation: value => value === 100 || value === 0 && Boolean(this.config.data?.white)
        || this.steps('saturation', 0, 100).some(step => step.value === value),
      colorTemperature: value => this.steps('colorTemperature', 140, 500).some(step => step.value === value),
    });
    if (!this.on) this.brightness = 0;
    const C = platform.Characteristic;
    this.service = accessory.getService(platform.Service.Lightbulb)
      || accessory.addService(platform.Service.Lightbulb, this.name);
    this.service.getCharacteristic(C.On).onGet(() => this.on)
      .onSet(value => this.enqueue(() => this.setOn(Boolean(value))));
    this.optional(C.Brightness, levels.length > 0,
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
    for (const [type, value] of [[C.On, this.on], [C.Brightness, this.brightness], [C.Hue, this.hue],
      [C.Saturation, this.saturation], [C.ColorTemperature, this.colorTemperature]] as const) {
      if (this.service.testCharacteristic(type)) this.service.updateCharacteristic(type, value);
    }
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
      if (this.relativeLevels.length) {
        if (!this.config.useLastKnownBrightness) this.relativeBrightnessUncertain = false;
        this.updateBrightness(this.nearestRelativeLevel(this.preferredBrightness()));
      }
      this.markOn();
      const delay = Number(this.config.onDelay ?? 0.1);
      if (Number.isFinite(delay) && delay > 0) {
        await this.delay(delay);
      }
    }
  }

  private markOn(): void {
    this.on = true;
    this.cancelTimer('light-reset');
    if (this.config.stateless && !this.powerTimerEnabled(true)) {
      this.schedule('light-reset', this.seconds(this.config.onDuration, 0.5, true) * 1000, async () => {
        this.on = false; this.brightness = 0;
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
        if (this.service.testCharacteristic(this.platform.Characteristic.Brightness)) this.service.updateCharacteristic(this.platform.Characteristic.Brightness, 0);
      });
    }
    this.service.updateCharacteristic(this.platform.Characteristic.On, true);
    this.automaticPower(true, on => this.setOn(on));
    for (const instance of this.platform.instances?.values() || []) {
      if (instance !== this && instance instanceof LightAccessory
        && ((this.config.exclusives || []).includes(instance.name) || (instance.config.exclusives || []).includes(this.name))) {
        instance.on = false;
        instance.brightness = 0;
        instance.cancelTimer('power-auto');
        instance.cancelTimer('light-reset');
        instance.service.updateCharacteristic(this.platform.Characteristic.On, false);
        if (instance.service.testCharacteristic(this.platform.Characteristic.Brightness)) instance.service.updateCharacteristic(this.platform.Characteristic.Brightness, 0);
        instance.persistState();
      }
    }
  }

  private get resend(): boolean { return this.config.allowResend ?? this.config.preventResendHex === false; }

  private preferredBrightness(): number {
    return this.config.useLastKnownBrightness && this.lastBrightness > 0
      ? this.lastBrightness : this.number(this.config.defaultBrightness ?? 100, 1, 100);
  }

  private updateBrightness(value: number): void {
    this.brightness = this.lastBrightness = value;
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, value);
  }

  private nearestRelativeLevel(value: number): number {
    return this.relativeLevels.reduce((best, level) =>
      Math.abs(level - value) < Math.abs(best - value) ? level : best);
  }

  private async setRelativeBrightness(value: number): Promise<void> {
    const target = this.relativeLevels.indexOf(this.nearestRelativeLevel(value));
    await this.ensureOn();
    let current = this.relativeLevels.indexOf(this.brightness);
    const interval = this.seconds(this.config.onDelay, 0.1);
    let sent = false;
    const pulse = async (key: string) => {
      if (sent) await this.delay(interval);
      await this.sendConfigured(key);
      sent = true;
    };
    try {
      if (this.relativeBrightnessUncertain || current < 0) {
        // Saturating at full brightness restores a known level after an ambiguous send.
        for (let index = 1; index < this.relativeLevels.length; index++) await pulse('brightness+');
        current = this.relativeLevels.length - 1;
        this.relativeBrightnessUncertain = false;
        this.updateBrightness(this.relativeLevels[current]);
      }
      const direction = Math.sign(target - current);
      while (current !== target) {
        await pulse(direction > 0 ? 'brightness+' : 'brightness-');
        current += direction;
        this.updateBrightness(this.relativeLevels[current]);
      }
    } catch (error) {
      this.relativeBrightnessUncertain = true;
      if (!this.disposed) this.persistState();
      throw error;
    }
    if (sent) this.markOn();
  }

  private async setOn(target: boolean): Promise<void> {
    if (target === this.on && !this.resend) return;
    if (target && (this.relativeLevels.length || this.steps('brightness', 1, 100).length)) {
      await this.setBrightness(this.preferredBrightness());
      return;
    }
    await this.sendConfigured(target ? 'on' : 'off');
    this.on = target;
    if (target) this.markOn();
    else { this.cancelTimer('light-reset'); this.automaticPower(false, on => this.setOn(on)); }
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
    if (this.relativeLevels.length) {
      await this.setRelativeBrightness(value);
      return;
    }
    const step = this.closest('brightness', value, 1, 100);
    if (this.on && step.value === this.brightness && !this.resend) return;
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
