import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { SensorSource } from './sensorSource';
import { BatteryStatus } from './battery';
import { compileCommands } from '../helpers/commands';
import { stateEnum, stateNumber } from '../helpers/state';

type Settings = { heat: number; cool: number; speed: number; swing: number };

/** Native HeaterCooler service for the legacy data.heat/data.cool configuration. */
export class HeaterCoolerAccessory extends TimedAccessory {
  private readonly service: Service;
  private readonly source: SensorSource;
  private readonly battery: BatteryStatus;
  private readonly modes: number[];
  private readonly min: number;
  private readonly max: number;
  private readonly interval: number;
  private active = 0;
  private mode: number;
  private settings: Settings;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    const data = this.config.data || {};
    this.modes = ['heat', 'cool'].flatMap(key => data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])
      ? [key === 'heat' ? C.TargetHeaterCoolerState.HEAT : C.TargetHeaterCoolerState.COOL] : []);
    if (!this.modes.length) throw new Error('HeaterCooler requires data.heat or data.cool');
    const auto = C.TargetHeaterCoolerState.AUTO;
    this.mode = this.config.defaultMode === 'heat' ? C.TargetHeaterCoolerState.HEAT
      : this.config.defaultMode === 'cool' ? C.TargetHeaterCoolerState.COOL : this.modes[this.modes.length - 1];
    if (data.auto !== undefined) {
      if (!data.auto || typeof data.auto !== 'object' || Array.isArray(data.auto)) {
        throw new Error('HeaterCooler data.auto must be an object with an on code');
      }
      compileCommands(data.auto.on);
      compileCommands(data.auto.off ?? data.off);
      this.modes.unshift(auto);
      if (this.config.defaultMode === 'auto') this.mode = auto;
    }
    if (!this.modes.includes(this.mode)) throw new Error('defaultMode is not configured');
    this.min = this.config.minTemperature === undefined ? 16 : this.toCelsius(this.config.minTemperature);
    this.max = this.config.maxTemperature === undefined ? 30 : this.toCelsius(this.config.maxTemperature);
    if (!Number.isFinite(this.min) || !Number.isFinite(this.max) || this.min < 0 || this.max > 100 || this.min >= this.max) {
      throw new Error('Invalid HeaterCooler temperature range');
    }
    this.settings = {
      heat: this.temperature(this.config.heatingThresholdTemperature === undefined
        ? Math.max(this.min, Math.min(this.max, 18)) : this.toCelsius(this.config.heatingThresholdTemperature)),
      cool: this.temperature(this.config.coolingThresholdTemperature === undefined
        ? Math.max(this.min, Math.min(this.max, 24)) : this.toCelsius(this.config.coolingThresholdTemperature)),
      speed: this.percent(this.config.defaultRotationSpeed ?? 100), swing: 0,
    };
    this.restoreState({ active: (value, saved) => stateEnum(0, 1)(value, saved)
      && (value === 0 || stateEnum(...this.modes)(saved.mode, saved)), mode: stateEnum(...this.modes), settings: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const saved = value as Record<string, unknown>;
      return Object.keys(saved).length === 4 && ['heat', 'cool'].every(key => stateNumber(this.min, this.max)(saved[key], saved))
        && stateNumber(0, 100)(saved.speed, saved) && stateEnum(0, 1)(saved.swing, saved);
    } });
    this.source = new SensorSource(this.config, () => this.getDevice());
    this.interval = this.seconds(this.config.temperatureUpdateFrequency ?? this.config.sensorPollInterval, 10);
    this.service = accessory.getService(platform.Service.HeaterCooler)
      || accessory.addService(platform.Service.HeaterCooler, this.name);
    // Remove the erroneous Thermostat service created by the earlier v5 alias.
    const thermostat = accessory.getService(platform.Service.Thermostat);
    if (thermostat) accessory.removeService(thermostat);
    this.service.getCharacteristic(C.Active).onGet(() => this.active)
      .onSet(value => this.serialize(() => this.setActive(Number(value))));
    this.service.getCharacteristic(C.CurrentHeaterCoolerState).onGet(() => this.currentState());
    this.service.getCharacteristic(C.TargetHeaterCoolerState).updateValue(this.mode).setProps({ validValues: this.modes })
      .onGet(() => this.mode).onSet(value => this.serialize(async () => {
        const mode = Number(value);
        if (!this.modes.includes(mode)) throw new Error('Unsupported HeaterCooler mode');
        if (this.active && mode !== this.mode) await this.activate(mode);
        else this.mode = mode;
      }));
    this.service.getCharacteristic(C.CurrentTemperature).setProps({ minValue: -270, maxValue: 100, minStep: 0.1 })
      .onGet(() => this.readSensor(this.source, 'temperature'));
    this.service.getCharacteristic(C.CoolingThresholdTemperature).updateValue(this.settings.cool).setProps({ minValue: this.min, maxValue: this.max, minStep: this.config.tempStepSize ?? 1 })
      .onGet(() => this.settings.cool).onSet(value => this.serialize(() => this.change({ cool: this.temperature(Number(value)) })));
    this.service.getCharacteristic(C.HeatingThresholdTemperature).updateValue(this.settings.heat).setProps({ minValue: this.min, maxValue: this.max, minStep: this.config.tempStepSize ?? 1 })
      .onGet(() => this.settings.heat).onSet(value => this.serialize(() => this.change({ heat: this.temperature(Number(value)) })));
    const hasSpeed = JSON.stringify(data).includes('rotationSpeed');
    if (hasSpeed) {
      this.service.getCharacteristic(C.RotationSpeed).setProps({ minValue: 0, maxValue: 100, minStep: this.config.fanStepSize ?? 1 })
        .onGet(() => this.settings.speed).onSet(value => this.serialize(() => this.change({ speed: this.percent(Number(value)) })));
    } else if (this.service.testCharacteristic(C.RotationSpeed)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(C.RotationSpeed));
    }
    if (JSON.stringify(data).includes('swing')) {
      this.service.getCharacteristic(C.SwingMode).onGet(() => this.settings.swing)
        .onSet(value => this.serialize(async () => {
          const swing = Number(value);
          if (![0, 1].includes(swing)) throw new Error('Invalid swing mode');
          if (swing !== this.settings.swing) await this.change({ swing });
        }));
    } else if (this.service.testCharacteristic(C.SwingMode)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(C.SwingMode));
    }
    this.publish();
    this.battery = new BatteryStatus(platform, accessory, this.source);
    this.source.onUpdate(quantity => {
      if (quantity !== 'battery') this.schedule('mqtt-update', 0, () => this.poll());
    });
    if (this.interval > 0) this.schedule('temperature', 0, () => this.poll());
  }

  private toCelsius(value: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid configured temperature');
    return String(this.config.temperatureUnits || 'c').toLowerCase() === 'f' ? (value - 32) * 5 / 9 : value;
  }

  private temperature(value: number): number {
    if (!Number.isFinite(value) || value < this.min || value > this.max) throw new Error('Temperature is outside configured bounds');
    return value;
  }

  private percent(value: number): number {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Speed must be between 0 and 100');
    return value;
  }

  private modeData(mode = this.mode): Record<string, any> {
    const target = this.platform.Characteristic.TargetHeaterCoolerState;
    const key = mode === target.AUTO ? 'auto' : mode === target.HEAT ? 'heat' : 'cool';
    return this.config.data[key];
  }

  private async send(value: unknown): Promise<void> {
    compileCommands(value);
    await this.sendCode(value);
    if (this.disposed) throw new Error('Accessory has shut down');
  }

  private decode(node: any, settings: Settings, mode: number, swingChanged: boolean, depth = 0): any {
    if (typeof node === 'string' || Buffer.isBuffer(node) || Array.isArray(node)) return node;
    if (node?.data !== undefined) return node;
    if (!node || depth > 10) throw new Error('No matching HeaterCooler code');
    if (node.temperatureCodes) {
      const temp = mode === this.platform.Characteristic.TargetHeaterCoolerState.HEAT ? settings.heat : settings.cool;
      const configured = String(this.config.temperatureUnits || 'c').toLowerCase() === 'f' ? temp * 9 / 5 + 32 : temp;
      const key = Object.keys(node.temperatureCodes).find(key => Math.abs(Number(key) - configured) < 0.01);
      if (!key) throw new Error(`No HeaterCooler temperature code for ${configured}`);
      return this.decode(node.temperatureCodes[key], settings, mode, swingChanged, depth + 1);
    }
    const speeds = Object.keys(node).filter(key => /^rotationSpeed\d+$/.test(key));
    if (speeds.length) {
      const key = speeds.reduce((best, key) => Math.abs(Number(key.slice(13)) - settings.speed)
        < Math.abs(Number(best.slice(13)) - settings.speed) ? key : best);
      settings.speed = Number(key.slice(13));
      return this.decode(node[key], settings, mode, swingChanged, depth + 1);
    }
    const key = settings.swing ? 'swingOn' : 'swingOff';
    const code = node[key] ?? (swingChanged ? node.swingToggle : node.swingDnd) ?? node.on ?? node.data;
    return this.decode(code, settings, mode, swingChanged, depth + 1);
  }

  private async activate(mode: number): Promise<void> {
    // Decode first so an invalid configuration cannot partially power on a unit.
    const settings = { ...this.settings };
    const data = this.modeData(mode);
    const code = mode === this.platform.Characteristic.TargetHeaterCoolerState.AUTO
      ? data.on : this.decode(data, settings, mode, false);
    compileCommands(code);
    await this.send(data.on);
    this.active = 1;
    this.mode = mode;
    this.publish();
    if (code !== data.on) await this.send(code);
    this.settings = settings;
    this.publish();
  }

  private async setActive(target: number): Promise<void> {
    if (![0, 1].includes(target)) throw new Error('Invalid active state');
    if (target) {
      if (this.active) return;
      await this.activate(this.mode);
    } else {
      if (!this.active) return;
      await this.send(this.modeData().off ?? this.config.data.off);
      this.active = 0;
      this.publish();
    }
  }

  private async change(patch: Partial<Settings>): Promise<void> {
    if (this.mode === this.platform.Characteristic.TargetHeaterCoolerState.AUTO
      && (patch.speed !== undefined || patch.swing !== undefined)) {
      throw new Error('HeaterCooler Auto uses the fan speed and swing encoded in its Auto command');
    }
    const settings = { ...this.settings, ...patch };
    const irrelevantThreshold = patch.heat !== undefined && this.mode !== this.platform.Characteristic.TargetHeaterCoolerState.HEAT
      || patch.cool !== undefined && this.mode !== this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    if (irrelevantThreshold || !this.active && this.config.turnOnWhenOff === false) {
      this.settings = settings;
      this.publish();
      return;
    }
    const code = this.decode(this.modeData(), settings, this.mode, patch.swing !== undefined);
    if (!this.active) {
      await this.send(this.modeData().on);
      this.active = 1;
      this.publish();
    }
    await this.send(code);
    this.settings = settings;
    this.publish();
  }

  private currentState(): number {
    const C = this.platform.Characteristic;
    if (!this.active) return C.CurrentHeaterCoolerState.INACTIVE;
    if (this.mode === C.TargetHeaterCoolerState.AUTO) return C.CurrentHeaterCoolerState.IDLE;
    return this.mode === C.TargetHeaterCoolerState.HEAT ? C.CurrentHeaterCoolerState.HEATING : C.CurrentHeaterCoolerState.COOLING;
  }

  private publish(): void {
    const C = this.platform.Characteristic;
    this.service.updateCharacteristic(C.Active, this.active);
    this.service.updateCharacteristic(C.TargetHeaterCoolerState, this.mode);
    this.service.updateCharacteristic(C.CurrentHeaterCoolerState, this.currentState());
    this.service.updateCharacteristic(C.HeatingThresholdTemperature, this.settings.heat);
    this.service.updateCharacteristic(C.CoolingThresholdTemperature, this.settings.cool);
    if (this.service.testCharacteristic(C.RotationSpeed)) this.service.updateCharacteristic(C.RotationSpeed, this.settings.speed);
    if (this.service.testCharacteristic(C.SwingMode)) this.service.updateCharacteristic(C.SwingMode, this.settings.swing);
  }

  private async poll(): Promise<void> {
    try {
      const value = await this.source.read('temperature');
      if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, value);
    } catch (error) {
      if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, error as Error);
      throw error;
    } finally {
      await this.battery.update();
      if (this.interval > 0) this.schedule('temperature', this.interval * 1000, () => this.poll());
    }
  }

  public override dispose(): void {
    super.dispose();
    this.battery.dispose();
    this.source.dispose();
  }

}
