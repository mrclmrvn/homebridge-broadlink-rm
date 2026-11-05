import { Service, CharacteristicValue } from 'homebridge';
import { TimedAccessory } from './timed';
import { SensorSource } from './sensorSource';
import { BatteryStatus } from './battery';
import type { BroadlinkRMPlatform } from '../platform';
import { PlatformAccessory } from 'homebridge';
import { compileCommands } from '../helpers/commands';

export class AirConditionerAccessory extends TimedAccessory {
  private service: Service;
  private currentHeatingCoolingState: number = 0;
  private targetHeatingCoolingState: number = 0;
  private targetTemperature: number;
  private readonly source: SensorSource;
  private readonly battery: BatteryStatus;
  private readonly pollInterval: number;
  private humidityService?: Service;
  private minTemperature: number;
  private maxTemperature: number;
  private readonly allowedModes: number[];
  private lastMode: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.minTemperature = this.config.minTemperature ?? 16;
    this.maxTemperature = this.config.maxTemperature ?? 30;
    this.targetTemperature = this.config.heatOnly || this.config.defaultMode === 'heat'
      ? this.config.defaultHeatTemperature ?? 24 : this.config.defaultCoolTemperature ?? 24;
    const step = this.config.tempStepSize ?? 1;
    if (![this.minTemperature, this.maxTemperature, this.targetTemperature, step].every(value => typeof value === 'number' && Number.isFinite(value))
      || this.minTemperature < -270 || this.maxTemperature > 100 || this.minTemperature >= this.maxTemperature
      || step <= 0 || step > this.maxTemperature - this.minTemperature
      || this.targetTemperature < this.minTemperature || this.targetTemperature > this.maxTemperature) throw new Error('Invalid Thermostat temperature configuration');
    const saved = accessory.context.broadlinkRMState?.targetTemperature;
    if (typeof saved === 'number' && Number.isFinite(saved) && saved >= this.minTemperature && saved <= this.maxTemperature
      && Math.abs((saved - this.minTemperature) / step - Math.round((saved - this.minTemperature) / step)) < 0.000001) {
      this.targetTemperature = saved;
    }
    this.validatePowerTimers();
    this.seconds(this.config.onDelay, 0.3);
    this.seconds(this.config.modeChangeDelay, 0.25);
    if (this.config.heatOnly && this.config.coolOnly) throw new Error('Choose heatOnly or coolOnly');
    this.allowedModes = this.config.heatOnly ? [0, 1] : this.config.coolOnly ? [0, 2] : [0, 1, 2];
    this.lastMode = this.config.defaultMode !== undefined ? this.config.defaultMode === 'heat' ? 1 : 2 : this.config.heatOnly ? 1 : 2;
    if (this.config.defaultMode !== undefined && !['heat', 'cool'].includes(this.config.defaultMode)) throw new Error('Unsupported defaultMode');
    if (!this.allowedModes.includes(this.lastMode)) throw new Error('defaultMode conflicts with allowed AC modes');
    if (this.config.replaceAutoMode !== undefined && (!['heat', 'cool'].includes(this.config.replaceAutoMode)
      || !this.allowedModes.includes(this.config.replaceAutoMode === 'heat' ? 1 : 2))) throw new Error('Invalid replaceAutoMode');
    for (const key of ['defaultHeatTemperature', 'defaultCoolTemperature']) {
      const value = this.config[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < this.minTemperature || value > this.maxTemperature)) throw new Error(`Invalid ${key}`);
    }
    this.source = new SensorSource(this.config, () => this.getDevice());
    this.pollInterval = this.seconds(this.config.sensorPollInterval ?? this.config.temperatureUpdateFrequency, 60);

    // Use Thermostat service
    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat, this.name);

    // Current Heating Cooling State
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    // Target Heating Cooling State
    const targetStateChar = this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(value => this.serialize(async () => { await this.setTargetHeatingCoolingState(value); this.deferDisplay(); }));

    targetStateChar.setProps({ validValues: [...this.allowedModes, ...(this.config.replaceAutoMode ? [3] : [])] });

    // Target Temperature
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .updateValue(this.targetTemperature)
      .setProps({
        minValue: this.minTemperature,
        maxValue: this.maxTemperature,
        minStep: this.config.tempStepSize ?? 1,
      })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(value => this.serialize(async () => { await this.setTargetTemperature(value); this.deferDisplay(); }));

    // Current Temperature
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -270,
        maxValue: 100,
        minStep: 0.1,
      })
      .onGet(this.getCurrentTemperature.bind(this));

    // Temperature Display Units
    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .setValue(this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS);

    // Initial values
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      this.currentHeatingCoolingState,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.targetHeatingCoolingState,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetTemperature,
      this.targetTemperature,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      new Error('Waiting for a sensor reading'),
    );

    this.humidityService = accessory.getService(platform.Service.HumiditySensor);
    if ((this.config.noHumidity || this.source.temperatureOnly) && this.humidityService) { accessory.removeService(this.humidityService); this.humidityService = undefined; }
    this.battery = new BatteryStatus(platform, accessory, this.source);
    this.source.onUpdate(quantity => {
      if (quantity !== 'battery') this.schedule('mqtt-update', 0, () => this.pollSensors());
    });
    if (this.pollInterval > 0) this.schedule('sensors', 0, () => this.pollSensors());
  }

  private deferDisplay(): void {
    // HAP caches the incoming write after onSet resolves; publish normalized values afterward.
    this.schedule('state-ui', 0, async () => {
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.targetHeatingCoolingState);
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.targetTemperature);
    });
  }

  private getCurrentHeatingCoolingState(): CharacteristicValue {
    return this.currentHeatingCoolingState;
  }

  private getTargetHeatingCoolingState(): CharacteristicValue {
    return this.targetHeatingCoolingState;
  }

  private async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    let state = Number(value);
    if (state === 3 && this.config.replaceAutoMode) state = this.config.replaceAutoMode === 'heat' ? 1 : 2;
    if (!this.allowedModes.includes(state)) throw new Error('Unsupported Thermostat mode');
    if (state === this.targetHeatingCoolingState && !this.resend) return;
    if (state === 0) {
      const data = this.config.data || {};
      const off = this.currentHeatingCoolingState === 2 && data.offDryMode !== undefined ? data.offDryMode : data.off;
      if (!off) throw new Error('No IR/RF off code configured');
      await this.sendCode(off);
      this.commitMode(0);
    } else {
      const entering = state !== this.targetHeatingCoolingState;
      const temp = entering && this.config.resetTemperatureOnModeChange ? this.modeDefault(state) : this.targetTemperature;
      await this.applyTemperature(state, temp, entering);
    }
    this.armPowerTimer();
  }

  private get resend(): boolean { return this.config.allowResend ?? this.config.preventResendHex === false; }

  private modeDefault(state: number): number {
    return state === 1 ? this.config.defaultHeatTemperature ?? this.targetTemperature
      : this.config.defaultCoolTemperature ?? this.targetTemperature;
  }

  private commitMode(state: number): void {
    this.targetHeatingCoolingState = this.currentHeatingCoolingState = state;
    if (state) this.lastMode = state;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, state);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, state);
  }

  private armPowerTimer(): void {
    this.automaticPower(this.targetHeatingCoolingState !== 0, on => this.setTargetHeatingCoolingState(on ? this.lastMode : 0));
  }

  private async applyTemperature(state: number, temperature: number, entering: boolean): Promise<void> {
    const data = this.config.data || {};
    const name = state === 1 ? 'heat' : 'cool';
    let temp = temperature;
    let entry = data[`${name}${temp}`] ?? data[`temperature${temp}`];
    if (entry === undefined && this.config.fallbackToDefaultTemperature) {
      temp = this.modeDefault(state);
      entry = data[`${name}${temp}`] ?? data[`temperature${temp}`];
    }
    const mode = entry?.['pseudo-mode'];
    if (mode !== undefined) {
      if (!['heat', 'cool'].includes(mode) || !this.allowedModes.includes(mode === 'heat' ? 1 : 2)) throw new Error('Unsupported temperature pseudo-mode');
    }
    const commands: unknown[] = [];
    if (this.targetHeatingCoolingState === 0 && (this.config.turnOnWhenOff ?? this.config.sendOnWhenOff)) {
      if (!data.on) throw new Error('turnOnWhenOff requires data.on');
      commands.push({ data: data.on, pause: this.seconds(this.config.onDelay, 0.3) });
    }
    if (entering && data[name]) commands.push({ data: data[name], pause: entry !== undefined ? this.seconds(this.config.modeChangeDelay, 0.25) : 0 });
    if (entry !== undefined) commands.push(entry);
    else if (!entering || !data[name]) {
      if (!entering || !data.on) throw new Error(`No IR/RF code configured for ${name}${temp} or temperature${temp}`);
      // A plain On command is the existing fallback when no temperature entry exists.
      if (!commands.length) commands.push(data.on);
    }
    compileCommands(commands, 0);
    await this.sendCode(commands, 0);
    this.commitMode(mode === 'heat' ? 1 : mode === 'cool' ? 2 : state);
    const changed = this.targetTemperature !== temp;
    this.targetTemperature = temp;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temp);
    if (changed) this.saveTargetTemperature();
  }

  private getTargetTemperature(): CharacteristicValue {
    return this.targetTemperature;
  }

  private saveTargetTemperature(): void {
    this.accessory.context.broadlinkRMState = { targetTemperature: this.targetTemperature };
    this.platform.updateAccessoryContext(this.accessory);
  }

  private async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested < this.minTemperature || requested > this.maxTemperature) throw new Error('Thermostat temperature is outside the configured range');
    const step = this.config.tempStepSize ?? 1;
    const temp = Number(Math.min(this.maxTemperature, this.minTemperature + Math.round((requested - this.minTemperature) / step) * step).toFixed(6));
    if (temp === this.targetTemperature && !this.resend) return;
    if (this.targetHeatingCoolingState !== 0 || this.config.ignoreTemperatureWhenOff === false) {
      await this.applyTemperature(this.targetHeatingCoolingState || this.lastMode, temp, this.targetHeatingCoolingState === 0);
      this.armPowerTimer();
    } else {
      this.targetTemperature = temp;
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temp);
      this.saveTargetTemperature();
    }
  }

  private async getCurrentTemperature(): Promise<number> {
    return this.source.read('temperature');
  }

  private async pollSensors(): Promise<void> {
    const C = this.platform.Characteristic;
    try {
      try {
        const temperature = await this.source.read('temperature');
        if (!this.disposed) this.service.updateCharacteristic(C.CurrentTemperature, temperature);
      } catch (error) {
        if (!this.disposed) this.service.updateCharacteristic(C.CurrentTemperature, error as Error);
      }
      if (!this.config.noHumidity && !this.source.temperatureOnly) {
        try {
          const humidity = await this.source.read('humidity');
          if (this.disposed) return;
          this.humidityService ||= this.accessory.getService(this.platform.Service.HumiditySensor)
            || this.accessory.addService(this.platform.Service.HumiditySensor, `${this.name} Humidity`);
          this.humidityService.getCharacteristic(C.CurrentRelativeHumidity).onGet(() => this.source.read('humidity'));
          this.humidityService.updateCharacteristic(C.CurrentRelativeHumidity, humidity);
        } catch (error) {
          if (!this.disposed) this.humidityService?.updateCharacteristic(C.CurrentRelativeHumidity, error as Error);
        }
      }
    } finally {
      await this.battery.update();
      if (this.pollInterval > 0) this.schedule('sensors', this.pollInterval * 1000, () => this.pollSensors());
    }
  }

  public override dispose(): void {
    super.dispose();
    this.battery.dispose();
    this.source.dispose();
  }
}
