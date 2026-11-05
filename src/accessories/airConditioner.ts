import { Service, CharacteristicValue } from 'homebridge';
import { TimedAccessory } from './timed';
import { SensorSource } from './sensorSource';
import { BatteryStatus } from './battery';
import type { BroadlinkRMPlatform } from '../platform';
import { PlatformAccessory } from 'homebridge';
import { compileCommandPlan } from '../helpers/commands';
import { performance } from 'node:perf_hooks';
import { SwitchAccessory } from './switch';
import { selectTemperatureCode } from '../helpers/thermostatCodes';

export class AirConditionerAccessory extends TimedAccessory {
  private service: Service;
  private currentHeatingCoolingState: number | undefined = 0;
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
  private readonly autoHeat?: number;
  private readonly autoCool?: number;
  private readonly ambientMinimum: number;
  private readonly autoSwitchName?: string;
  private ambientOwned = false;
  private ambientAllowedAt = 0;
  private gateIssue?: string;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.minTemperature = this.config.minTemperature ?? 16;
    this.maxTemperature = this.config.maxTemperature ?? 30;
    this.targetTemperature = this.config.heatOnly || this.config.defaultMode === 'heat'
      ? this.config.defaultHeatTemperature ?? 24 : this.config.defaultMode === 'auto'
        ? this.config.defaultAutoTemperature ?? this.config.defaultCoolTemperature ?? 24 : this.config.defaultCoolTemperature ?? 24;
    const step = this.config.tempStepSize ?? 1;
    const aligned = (value: number) => Math.abs((value - this.minTemperature) / step - Math.round((value - this.minTemperature) / step)) < 0.000001;
    if (![this.minTemperature, this.maxTemperature, this.targetTemperature, step].every(value => typeof value === 'number' && Number.isFinite(value))
      || this.minTemperature < -270 || this.maxTemperature > 100 || this.minTemperature >= this.maxTemperature
      || step <= 0 || step > this.maxTemperature - this.minTemperature
      || this.targetTemperature < this.minTemperature || this.targetTemperature > this.maxTemperature || !aligned(this.targetTemperature)) throw new Error('Invalid Thermostat temperature configuration');
    if (this.config.persistState !== undefined && typeof this.config.persistState !== 'boolean') throw new Error('persistState must be a boolean');
    const saved = this.config.persistState === false ? undefined : accessory.context.broadlinkRMState?.targetTemperature;
    if (typeof saved === 'number' && Number.isFinite(saved) && saved >= this.minTemperature && saved <= this.maxTemperature
      && Math.abs((saved - this.minTemperature) / step - Math.round((saved - this.minTemperature) / step)) < 0.000001) {
      this.targetTemperature = saved;
    }
    this.validatePowerTimers();
    this.seconds(this.config.onDelay, 0.3);
    this.seconds(this.config.modeChangeDelay, 0.25);
    if (this.config.heatOnly && this.config.coolOnly) throw new Error('Choose heatOnly or coolOnly');
    this.allowedModes = this.config.heatOnly ? [0, 1] : this.config.coolOnly ? [0, 2] : [0, 1, 2];
    const data = this.config.data || {};
    const hasDeviceAuto = data.auto !== undefined || Object.keys(data).some(key => /^auto-?\d/.test(key)
      || /^temperature/.test(key) && data[key]?.['pseudo-mode'] === 'auto');
    if (!this.config.heatOnly && !this.config.coolOnly && hasDeviceAuto) this.allowedModes.push(3);
    const names: Record<string, number> = { heat: 1, cool: 2, auto: 3 };
    this.lastMode = this.config.defaultMode !== undefined ? names[this.config.defaultMode] : this.config.heatOnly ? 1 : 2;
    if (this.config.defaultMode !== undefined && !['heat', 'cool', 'auto'].includes(this.config.defaultMode)) throw new Error('Unsupported defaultMode');
    if (!this.allowedModes.includes(this.lastMode) && !(this.lastMode === 3 && this.config.replaceAutoMode)) throw new Error('defaultMode conflicts with allowed AC modes');
    if (this.config.replaceAutoMode !== undefined && (!['heat', 'cool'].includes(this.config.replaceAutoMode)
      || !this.allowedModes.includes(this.config.replaceAutoMode === 'heat' ? 1 : 2))) throw new Error('Invalid replaceAutoMode');
    if (this.lastMode === 3 && this.config.replaceAutoMode) this.lastMode = this.config.replaceAutoMode === 'heat' ? 1 : 2;
    for (const key of ['defaultHeatTemperature', 'defaultCoolTemperature', 'defaultAutoTemperature']) {
      const value = this.config[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < this.minTemperature || value > this.maxTemperature || !aligned(value))) throw new Error(`Invalid ${key}`);
    }
    this.autoHeat = this.config.autoHeatTemperature;
    this.autoCool = this.config.autoCoolTemperature;
    for (const [mode, value] of [[1, this.autoHeat], [2, this.autoCool]] as const) {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < -270 || value > 100
        || !this.allowedModes.includes(mode))) throw new Error('Invalid ambient threshold or unsupported ambient mode');
    }
    if (this.autoHeat !== undefined && this.autoCool !== undefined && this.autoHeat >= this.autoCool) throw new Error('autoHeatTemperature must be below autoCoolTemperature');
    if (this.hasAmbientAutomation && this.config.pseudoDeviceTemperature !== undefined) throw new Error('Ambient automation requires measured temperature, not pseudoDeviceTemperature');
    this.ambientMinimum = this.seconds(this.config.minimumAutoOnOffDuration ?? this.config.autoMinimumDuration, 120) * 1000;
    this.autoSwitchName = this.config.autoSwitchName ?? this.config.autoSwitch;
    if (this.autoSwitchName !== undefined && (typeof this.autoSwitchName !== 'string' || !this.autoSwitchName.trim())) throw new Error('Invalid autoSwitchName');
    if (this.config.fallbackToDefaultTemperature !== undefined && ![false, true, 'legacy'].includes(this.config.fallbackToDefaultTemperature)) throw new Error('Invalid fallbackToDefaultTemperature policy');
    if (this.config.heatTemperature !== undefined && (typeof this.config.heatTemperature !== 'number' || !Number.isFinite(this.config.heatTemperature)
      || this.config.heatTemperature < -270 || this.config.heatTemperature > 100)) throw new Error('Invalid heatTemperature');
    const displayUnits = String(this.config.units ?? 'c').toLowerCase();
    if (!['c', 'f'].includes(displayUnits)) throw new Error('units must be c or f');
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
      .onSet(value => this.serialize(async () => { await this.setTargetHeatingCoolingState(value); this.manualOverride(); this.deferDisplay(); }));

    targetStateChar.setProps({ validValues: [...new Set([...this.allowedModes, ...(this.config.replaceAutoMode ? [3] : [])])] });

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
      .onSet(value => this.serialize(async () => { await this.setTargetTemperature(value); this.manualOverride(); this.deferDisplay(); }));

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
      .setValue(displayUnits === 'f' ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onGet(() => displayUnits === 'f' ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS);

    // Initial values
    this.publishActivity();
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
    if (this.currentHeatingCoolingState === undefined) throw new Error('Device Auto activity is unavailable');
    return this.currentHeatingCoolingState;
  }

  private getTargetHeatingCoolingState(): CharacteristicValue {
    return this.targetHeatingCoolingState;
  }

  private async setTargetHeatingCoolingState(value: CharacteristicValue, ambient = false): Promise<void> {
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
      await this.applyTemperature(state, temp, entering, ambient);
    }
    this.armPowerTimer();
  }

  private get resend(): boolean { return this.config.allowResend ?? this.config.preventResendHex === false; }

  private modeDefault(state: number): number {
    return state === 1 ? this.config.defaultHeatTemperature ?? this.targetTemperature
      : state === 3 ? this.config.defaultAutoTemperature ?? this.targetTemperature
        : this.config.defaultCoolTemperature ?? this.targetTemperature;
  }

  private commitMode(state: number): void {
    this.targetHeatingCoolingState = state;
    this.currentHeatingCoolingState = state === 3 ? undefined : state;
    if (state === 0 || state === 3) this.ambientOwned = false;
    if (state) this.lastMode = state;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, state);
    this.publishActivity();
  }

  private publishActivity(): void {
    const type = this.platform.Characteristic.CurrentHeatingCoolingState;
    if (this.currentHeatingCoolingState === undefined) this.service.updateCharacteristic(type, new Error('Device Auto activity is unavailable'));
    else this.service.updateCharacteristic(type, this.currentHeatingCoolingState);
  }

  private armPowerTimer(): void {
    this.automaticPower(this.targetHeatingCoolingState !== 0, on => this.setTargetHeatingCoolingState(on ? this.lastMode : 0));
  }

  private async applyTemperature(state: number, temperature: number, entering: boolean, ambient = false): Promise<void> {
    const data = this.config.data || {};
    const name = state === 1 ? 'heat' : state === 3 ? 'auto' : 'cool';
    const selected = selectTemperatureCode(this.config, name, temperature, this.targetTemperature);
    const temp = selected?.temperature ?? temperature;
    const entry = selected?.code;
    const mode = entry && typeof entry === 'object' ? (entry as Record<string, unknown>)['pseudo-mode'] : undefined;
    if (mode !== undefined) {
      if (typeof mode !== 'string' || !['heat', 'cool', 'auto'].includes(mode) || !this.allowedModes.includes(mode === 'heat' ? 1 : mode === 'auto' ? 3 : 2)) throw new Error('Unsupported temperature pseudo-mode');
      if (ambient && (mode === 'heat' ? 1 : mode === 'auto' ? 3 : 2) !== state) throw new Error('Ambient command metadata conflicts with the requested mode');
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
    await this.sendCommands(compileCommandPlan(commands));
    this.commitMode(mode === 'heat' ? 1 : mode === 'cool' ? 2 : mode === 'auto' ? 3 : state);
    const changed = this.targetTemperature !== temp;
    this.targetTemperature = temp;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temp);
    if (changed) this.saveTargetTemperature();
  }

  private getTargetTemperature(): CharacteristicValue {
    return this.targetTemperature;
  }

  private saveTargetTemperature(): void {
    if (this.config.persistState === false) return;
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
      const resumed = this.lastMode === 3 && this.config.replaceAutoMode ? this.config.replaceAutoMode === 'heat' ? 1 : 2 : this.lastMode;
      await this.applyTemperature(this.targetHeatingCoolingState || resumed, temp, this.targetHeatingCoolingState === 0);
      this.armPowerTimer();
    } else {
      this.targetTemperature = temp;
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temp);
      this.saveTargetTemperature();
    }
  }

  private get hasAmbientAutomation(): boolean { return this.autoHeat !== undefined || this.autoCool !== undefined; }

  private manualOverride(): void {
    this.ambientOwned = false;
    this.ambientAllowedAt = performance.now() + this.ambientMinimum;
  }

  private ambientSwitchEnabled(): boolean {
    if (!this.autoSwitchName) return true;
    const states = [...(this.platform.instances?.values() || [])]
      .filter((instance): instance is SwitchAccessory => instance instanceof SwitchAccessory)
      .map(instance => instance.automationState(this.autoSwitchName!))
      .filter((state): state is boolean => state !== undefined);
    const issue = states.length !== 1 ? 'Expected exactly one enabled switch/outlet for autoSwitchName' : undefined;
    if (issue && issue !== this.gateIssue) this.log.warn(`[${this.name}] ${issue}; ambient automation is blocked`);
    this.gateIssue = issue;
    return states.length === 1 && states[0];
  }

  private async evaluateAmbient(temperature: number): Promise<void> {
    if (!this.hasAmbientAutomation || this.disposed || this.targetHeatingCoolingState === 3
      || performance.now() < this.ambientAllowedAt || !this.ambientSwitchEnabled()) return;
    const desired = this.autoHeat !== undefined && temperature < this.autoHeat ? 1
      : this.autoCool !== undefined && temperature > this.autoCool ? 2 : this.ambientOwned ? 0 : undefined;
    if (desired === undefined || desired === this.targetHeatingCoolingState) return;
    try {
      await this.setTargetHeatingCoolingState(desired, true);
      this.ambientOwned = desired !== 0 && this.targetHeatingCoolingState !== 3;
    } finally {
      // Failed sends also wait before another fresh decision, avoiding tight retry loops.
      this.ambientAllowedAt = performance.now() + this.ambientMinimum;
    }
  }

  private async getCurrentTemperature(): Promise<number> {
    return this.source.read('temperature');
  }

  private async pollSensors(): Promise<void> {
    const C = this.platform.Characteristic;
    try {
      let temperature: number | undefined;
      try {
        temperature = await this.source.read('temperature');
        if (!this.disposed) this.service.updateCharacteristic(C.CurrentTemperature, temperature);
      } catch (error) {
        if (!this.disposed) this.service.updateCharacteristic(C.CurrentTemperature, error as Error);
      }
      if (temperature !== undefined) {
        try { await this.evaluateAmbient(temperature); }
        catch (error) { if (!this.disposed) this.log.error(`[${this.name}] Ambient command failed: ${(error as Error).message}`); }
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
