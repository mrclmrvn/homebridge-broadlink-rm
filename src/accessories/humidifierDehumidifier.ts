import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { FanAccessory } from './fan';
import { SensorSource } from './sensorSource';

export class HumidifierDehumidifierAccessory extends FanAccessory {
  private readonly source: SensorSource;
  private readonly modes: number[];
  private readonly interval: number;
  private target: number;
  private current: number;
  private low: number;
  private high: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    if (this.config.humidifierOnly && this.config.deHumidifierOnly) throw new Error('Choose either humidifierOnly or deHumidifierOnly');
    this.source = new SensorSource(this.config, () => this.getDevice());
    this.interval = this.seconds(this.config.humidityUpdateFrequency ?? this.config.sensorPollInterval, 10);
    this.modes = this.config.humidifierOnly ? [C.TargetHumidifierDehumidifierState.HUMIDIFIER]
      : this.config.deHumidifierOnly ? [C.TargetHumidifierDehumidifierState.DEHUMIDIFIER]
        : this.config.noHumidity ? [1, 2] : [0, 1, 2];
    this.target = this.modes[0];
    this.current = C.CurrentHumidifierDehumidifierState.INACTIVE;
    this.low = this.percentage(this.config.humidifierThreshold ?? 40);
    this.high = this.percentage(this.config.dehumidifierThreshold ?? 60);
    if (this.low > this.high) throw new Error('Humidifier threshold must not exceed dehumidifier threshold');
    this.service.getCharacteristic(C.CurrentHumidifierDehumidifierState).onGet(() => this.current);
    this.service.getCharacteristic(C.CurrentRelativeHumidity).onGet(() => this.source.read('humidity'));
    this.service.getCharacteristic(C.TargetHumidifierDehumidifierState).updateValue(this.target).setProps({ validValues: this.modes })
      .onGet(() => this.target).onSet(value => this.serialize(async () => {
        const target = Number(value);
        if (!this.modes.includes(target)) throw new Error('Unsupported humidity mode');
        await this.apply(target, this.low, this.high);
        this.target = target;
      }));
    this.service.getCharacteristic(C.RelativeHumidityHumidifierThreshold).onGet(() => this.low)
      .onSet(value => this.serialize(async () => {
        const low = this.percentage(Number(value));
        if (low > this.high) throw new Error('Humidifier threshold must not exceed dehumidifier threshold');
        await this.apply(this.target, low, this.high);
        this.low = low;
      }));
    this.service.getCharacteristic(C.RelativeHumidityDehumidifierThreshold).onGet(() => this.high)
      .onSet(value => this.serialize(async () => {
        const high = this.percentage(Number(value));
        if (high < this.low) throw new Error('Dehumidifier threshold must not be below humidifier threshold');
        await this.apply(this.target, this.low, high);
        this.high = high;
      }));
    this.setupPhysicalLock();
    this.service.updateCharacteristic(C.CurrentHumidifierDehumidifierState, this.current);
    this.service.updateCharacteristic(C.TargetHumidifierDehumidifierState, this.target);
    this.service.updateCharacteristic(C.RelativeHumidityHumidifierThreshold, this.low);
    this.service.updateCharacteristic(C.RelativeHumidityDehumidifierThreshold, this.high);
    this.source.onUpdate(() => this.schedule('mqtt-update', 0, () => this.poll()));
    if (!this.config.noHumidity && this.interval > 0) this.schedule('humidity', 0, () => this.poll());
  }

  private percentage(value: number): number {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Humidity must be between 0 and 100');
    return value;
  }

  private async apply(target: number, low: number, high: number, reading?: number): Promise<void> {
    if (!this.active) return;
    const C = this.platform.Characteristic;
    let desired = C.CurrentHumidifierDehumidifierState.IDLE;
    if (this.config.noHumidity) {
      desired = target === C.TargetHumidifierDehumidifierState.HUMIDIFIER
        ? C.CurrentHumidifierDehumidifierState.HUMIDIFYING : C.CurrentHumidifierDehumidifierState.DEHUMIDIFYING;
    } else {
      const humidity = reading ?? await this.source.read('humidity');
      if (this.disposed) return;
      this.service.updateCharacteristic(C.CurrentRelativeHumidity, humidity);
      if (humidity < low && target !== C.TargetHumidifierDehumidifierState.DEHUMIDIFIER) {
        desired = C.CurrentHumidifierDehumidifierState.HUMIDIFYING;
      } else if (humidity > high && target !== C.TargetHumidifierDehumidifierState.HUMIDIFIER) {
        desired = C.CurrentHumidifierDehumidifierState.DEHUMIDIFYING;
      }
    }
    if (desired === this.current) return;
    await this.sendConfigured(desired === C.CurrentHumidifierDehumidifierState.HUMIDIFYING ? 'targetStateHumidifier'
      : desired === C.CurrentHumidifierDehumidifierState.DEHUMIDIFYING ? 'targetStateDehumidifier'
        : this.config.data?.fanOnly ? 'fanOnly' : 'off');
    this.current = desired;
    this.service.updateCharacteristic(C.CurrentHumidifierDehumidifierState, this.current);
  }

  protected override async setActive(value: CharacteristicValue): Promise<void> {
    if (Number(value) && this.active) {
      await this.apply(this.target, this.low, this.high);
      return;
    }
    await super.setActive(value);
  }

  protected override async activeChanged(): Promise<void> {
    const C = this.platform.Characteristic;
    this.current = C.CurrentHumidifierDehumidifierState.INACTIVE;
    this.service.updateCharacteristic(C.CurrentHumidifierDehumidifierState, this.current);
    await this.apply(this.target, this.low, this.high);
  }

  private async poll(): Promise<void> {
    try {
      let humidity: number;
      try {
        humidity = await this.source.read('humidity');
      } catch (error) {
        if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, error as Error);
        throw error;
      }
      if (this.disposed) return;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
      await this.apply(this.target, this.low, this.high, humidity);
    } finally {
      if (!this.config.noHumidity && this.interval > 0) this.schedule('humidity', this.interval * 1000, () => this.poll());
    }
  }

  public override dispose(): void {
    super.dispose();
    this.source.dispose();
  }

}
