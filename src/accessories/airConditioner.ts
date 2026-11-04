import { Service, CharacteristicValue } from 'homebridge';
import { BaseAccessory } from './base';
import type { BroadlinkRMPlatform } from '../platform';
import { PlatformAccessory } from 'homebridge';

export class AirConditionerAccessory extends BaseAccessory {
  private service: Service;
  private currentHeatingCoolingState: number = 0;
  private targetHeatingCoolingState: number = 0;
  private targetTemperature: number;
  private currentTemperature: number;
  private minTemperature: number;
  private maxTemperature: number;
  private coolOnly: boolean;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.minTemperature = this.config.minTemperature ?? 16;
    this.maxTemperature = this.config.maxTemperature ?? 30;
    this.targetTemperature = this.config.defaultCoolTemperature ?? 24;
    this.currentTemperature = this.targetTemperature;
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
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    if (this.coolOnly) {
      targetStateChar.setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.OFF,
          this.platform.Characteristic.TargetHeatingCoolingState.COOL,
        ],
      });
    }

    // Target Temperature
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.minTemperature,
        maxValue: this.maxTemperature,
        minStep: this.config.tempStepSize ?? 1,
      })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    // Current Temperature
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -50,
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
      this.currentTemperature,
    );

    // Start background sensor polling if supported
    this.startSensorPolling();
  }

  private getCurrentHeatingCoolingState(): CharacteristicValue {
    return this.currentHeatingCoolingState;
  }

  private getTargetHeatingCoolingState(): CharacteristicValue {
    return this.targetHeatingCoolingState;
  }

  private async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    const newState = value as number;
    const previousState = this.targetHeatingCoolingState;
    this.targetHeatingCoolingState = newState;

    const data = this.config.data || {};

    if (newState === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      this.log.info(`[${this.name}] Turning OFF`);
      if (data.off) {
        await this.sendCode(data.off);
      }
      this.currentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState,
        this.currentHeatingCoolingState,
      );
    } else {
      // Turning ON (COOL or HEAT)
      this.log.info(`[${this.name}] Turning ON (Mode: ${newState})`);
      const tempKey = `temperature${Math.round(this.targetTemperature)}`;
      const tempEntry = data[tempKey];

      let codeToSend: string | undefined;
      if (tempEntry) {
        codeToSend = typeof tempEntry === 'string' ? tempEntry : tempEntry.data;
      } else if (data.on) {
        codeToSend = data.on;
      }

      if (codeToSend) {
        await this.sendCode(codeToSend);
      }

      this.currentHeatingCoolingState =
        newState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT
          ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.platform.Characteristic.CurrentHeatingCoolingState.COOL;

      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState,
        this.currentHeatingCoolingState,
      );
    }
  }

  private getTargetTemperature(): CharacteristicValue {
    return this.targetTemperature;
  }

  private async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    const temp = Math.round(value as number);
    this.targetTemperature = temp;
    this.log.info(`[${this.name}] Setting Target Temperature to ${temp}°C`);

    // Only send IR code if AC is currently active
    if (this.targetHeatingCoolingState !== this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      const data = this.config.data || {};
      const tempKey = `temperature${temp}`;
      const tempEntry = data[tempKey];

      if (tempEntry) {
        const code = typeof tempEntry === 'string' ? tempEntry : tempEntry.data;
        if (code) {
          await this.sendCode(code);
        }
      } else {
        this.log.warn(`[${this.name}] No IR code configured for temperature ${temp}°C ("${tempKey}")`);
      }
    }
  }

  private getCurrentTemperature(): CharacteristicValue {
    return this.currentTemperature;
  }

  private startSensorPolling(): void {
    const pollInterval = (this.config.sensorPollInterval ?? 60) * 1000;
    if (pollInterval <= 0) return;

    setInterval(async () => {
      const dev = this.getDevice();
      if (!dev || !dev.typeInfo.hasSensors) return;

      try {
        const reading = await dev.checkSensors();
        if (reading.temperature !== undefined && reading.temperature > -50 && reading.temperature < 100) {
          this.currentTemperature = reading.temperature;
          this.service.updateCharacteristic(
            this.platform.Characteristic.CurrentTemperature,
            this.currentTemperature,
          );
        }
        if (reading.humidity !== undefined) {
          const humidityService =
            this.accessory.getService(this.platform.Service.HumiditySensor) ||
            this.accessory.addService(this.platform.Service.HumiditySensor, `${this.name} Humidity`);
          humidityService.updateCharacteristic(
            this.platform.Characteristic.CurrentRelativeHumidity,
            reading.humidity,
          );
        }
      } catch (err: any) {
        this.log.debug(`[${this.name}] Sensor read failed: ${err.message}`);
      }
    }, pollInterval);
  }
}

