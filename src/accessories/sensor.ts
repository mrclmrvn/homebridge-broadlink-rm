import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { SensorSource } from './sensorSource';
import { BatteryStatus } from './battery';

export class SensorAccessory extends TimedAccessory {
  private readonly source: SensorSource;
  private readonly battery: BatteryStatus;
  private readonly service: Service;
  private readonly humidityService?: Service;
  private readonly humidityOnly: boolean;
  private readonly pollInterval: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    this.humidityOnly = ['humiditysensor', 'humidity-sensor'].includes(String(this.config.type).toLowerCase());
    this.source = new SensorSource(this.config, () => this.getDevice());
    this.pollInterval = this.seconds(this.config.sensorPollInterval
      ?? this.config[this.humidityOnly ? 'humidityUpdateFrequency' : 'temperatureUpdateFrequency'], 10);
    const type = this.humidityOnly ? platform.Service.HumiditySensor : platform.Service.TemperatureSensor;
    this.service = accessory.getService(type) || accessory.addService(type, this.name);
    if (this.humidityOnly) {
      this.service.getCharacteristic(C.CurrentRelativeHumidity).onGet(() => this.readSensor(this.source, 'humidity'));
    } else {
      this.service.getCharacteristic(C.CurrentTemperature).setProps({ minValue: -270, maxValue: 100, minStep: 0.1 })
        .onGet(() => this.readSensor(this.source, 'temperature'));
      if (!this.config.noHumidity && !this.source.temperatureOnly) {
        this.humidityService = accessory.getService(platform.Service.HumiditySensor)
          || accessory.addService(platform.Service.HumiditySensor, `${this.name} Humidity`);
        this.humidityService.getCharacteristic(C.CurrentRelativeHumidity).onGet(() => this.readSensor(this.source, 'humidity'));
      } else {
        const stale = accessory.getService(platform.Service.HumiditySensor);
        if (stale) accessory.removeService(stale);
      }
    }
    this.battery = new BatteryStatus(platform, accessory, this.source);
    this.source.onUpdate(quantity => {
      if (quantity !== 'battery') this.schedule('mqtt-update', 0, () => this.poll());
    });
    if (this.pollInterval > 0) this.schedule('sensors', 0, () => this.poll());
  }

  private async poll(): Promise<void> {
    try {
      const C = this.platform.Characteristic;
      const quantity = this.humidityOnly ? 'humidity' : 'temperature';
      const characteristic = this.humidityOnly ? C.CurrentRelativeHumidity : C.CurrentTemperature;
      try {
        const value = await this.source.read(quantity);
        if (!this.disposed) this.service.updateCharacteristic(characteristic, value);
      } catch (error) {
        if (!this.disposed) this.service.updateCharacteristic(characteristic, error as Error);
      }
      if (this.humidityService) {
        try {
          const value = await this.source.read('humidity');
          if (!this.disposed) this.humidityService.updateCharacteristic(C.CurrentRelativeHumidity, value);
        } catch (error) {
          if (!this.disposed) this.humidityService.updateCharacteristic(C.CurrentRelativeHumidity, error as Error);
        }
      }
    } finally {
      await this.battery.update();
      if (this.pollInterval > 0) this.schedule('sensors', this.pollInterval * 1000, () => this.poll());
    }
  }

  public override dispose(): void {
    super.dispose();
    this.battery.dispose();
    this.source.dispose();
  }

}
