import { Service, CharacteristicValue } from 'homebridge';
import { TimedAccessory } from './timed';
import { SensorSource } from './sensorSource';
import { BatteryStatus } from './battery';
import type { BroadlinkRMPlatform } from '../platform';
import { PlatformAccessory } from 'homebridge';

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
  private coolOnly: boolean;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.minTemperature = this.config.minTemperature ?? 16;
    this.maxTemperature = this.config.maxTemperature ?? 30;
    this.targetTemperature = this.config.defaultCoolTemperature ?? 24;
    const step = this.config.tempStepSize ?? 1;
    if (![this.minTemperature, this.maxTemperature, this.targetTemperature, step].every(value => typeof value === 'number' && Number.isFinite(value))
      || this.minTemperature < -270 || this.maxTemperature > 100 || this.minTemperature >= this.maxTemperature
      || step <= 0 || step > this.maxTemperature - this.minTemperature
      || this.targetTemperature < this.minTemperature || this.targetTemperature > this.maxTemperature) throw new Error('Invalid Thermostat temperature configuration');
    this.source = new SensorSource(this.config, () => this.getDevice());
    this.pollInterval = this.seconds(this.config.sensorPollInterval ?? this.config.temperatureUpdateFrequency, 60);
    this.coolOnly = this.config.coolOnly ?? false;

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
      .onSet(value => this.serialize(() => this.setTargetHeatingCoolingState(value)));

    const modes = platform.Characteristic.TargetHeatingCoolingState;
    targetStateChar.setProps({ validValues: this.coolOnly ? [modes.OFF, modes.COOL] : [modes.OFF, modes.HEAT, modes.COOL] });

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
      .onSet(value => this.serialize(() => this.setTargetTemperature(value)));

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

  private getCurrentHeatingCoolingState(): CharacteristicValue {
    return this.currentHeatingCoolingState;
  }

  private getTargetHeatingCoolingState(): CharacteristicValue {
    return this.targetHeatingCoolingState;
  }

  private async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    const state = Number(value);
    const C = this.platform.Characteristic;
    const modes = C.TargetHeatingCoolingState;
    const allowed = this.coolOnly ? [modes.OFF, modes.COOL] : [modes.OFF, modes.HEAT, modes.COOL];
    if (!allowed.includes(state)) throw new Error('Unsupported Thermostat mode');
    if (state === this.targetHeatingCoolingState && !this.config.allowResend) return;
    const data = this.config.data || {};
    const code = state === modes.OFF ? data.off : data[`temperature${this.targetTemperature}`] ?? data.on;
    if (!code) throw new Error('No IR/RF code configured for the requested Thermostat mode/temperature');
    await this.sendCode(code);
    this.targetHeatingCoolingState = state;
    this.currentHeatingCoolingState = state === modes.OFF ? C.CurrentHeatingCoolingState.OFF
      : state === modes.HEAT ? C.CurrentHeatingCoolingState.HEAT : C.CurrentHeatingCoolingState.COOL;
    this.service.updateCharacteristic(C.TargetHeatingCoolingState, state);
    this.service.updateCharacteristic(C.CurrentHeatingCoolingState, this.currentHeatingCoolingState);
  }

  private getTargetTemperature(): CharacteristicValue {
    return this.targetTemperature;
  }

  private async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested < this.minTemperature || requested > this.maxTemperature) throw new Error('Thermostat temperature is outside the configured range');
    const step = this.config.tempStepSize ?? 1;
    const temp = Number(Math.min(this.maxTemperature, this.minTemperature + Math.round((requested - this.minTemperature) / step) * step).toFixed(6));
    if (temp === this.targetTemperature && !this.config.allowResend) return;
    if (this.targetHeatingCoolingState !== this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      const code = this.config.data?.[`temperature${temp}`];
      if (!code) throw new Error(`No IR/RF code configured for temperature${temp}`);
      await this.sendCode(code);
    }
    this.targetTemperature = temp;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temp);
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
