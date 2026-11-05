import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { SensorSource } from './sensorSource';

/** Optional battery telemetry; no assumed full battery or charging capability. */
export class BatteryStatus {
  private readonly service?: Service;
  private unsubscribe?: () => void;
  private disposed = false;

  constructor(private readonly platform: BroadlinkRMPlatform, accessory: PlatformAccessory, private readonly source: SensorSource) {
    const C = platform.Characteristic;
    const stale = accessory.getService(platform.Service.Battery);
    if (!accessory.context.config.batteryAlerts) {
      if (stale) accessory.removeService(stale);
      return;
    }
    this.service = stale || accessory.addService(platform.Service.Battery, `${accessory.displayName} Battery`);
    this.service.getCharacteristic(C.BatteryLevel).onGet(() => this.source.read('battery'));
    this.service.getCharacteristic(C.StatusLowBattery).onGet(async () => this.low(await this.source.read('battery')));
    this.service.getCharacteristic(C.ChargingState).onGet(() => { throw new Error('Charging state is unavailable'); });
    for (const characteristic of [C.BatteryLevel, C.StatusLowBattery]) {
      this.service.updateCharacteristic(characteristic, new Error('Waiting for battery telemetry'));
    }
    this.service.updateCharacteristic(C.ChargingState, new Error('Charging state is unavailable'));
    this.unsubscribe = source.onUpdate(quantity => {
      if (quantity === undefined || quantity === 'battery') void this.update();
    });
  }

  private low(level: number): number {
    const C = this.platform.Characteristic.StatusLowBattery;
    return level <= 20 ? C.BATTERY_LEVEL_LOW : C.BATTERY_LEVEL_NORMAL;
  }

  public async update(): Promise<void> {
    if (!this.service || this.disposed) return;
    const C = this.platform.Characteristic;
    try {
      const level = await this.source.read('battery');
      if (this.disposed) return;
      this.service.updateCharacteristic(C.BatteryLevel, level);
      this.service.updateCharacteristic(C.StatusLowBattery, this.low(level));
    } catch (error) {
      if (this.disposed) return;
      this.service.updateCharacteristic(C.BatteryLevel, error as Error);
      this.service.updateCharacteristic(C.StatusLowBattery, error as Error);
    }
  }

  public dispose(): void { this.disposed = true; this.unsubscribe?.(); }
}
