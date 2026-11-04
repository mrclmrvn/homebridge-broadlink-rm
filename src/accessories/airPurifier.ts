import type { PlatformAccessory } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { FanAccessory } from './fan';

export class AirPurifierAccessory extends FanAccessory {
  private target: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    this.target = C.TargetAirPurifierState.MANUAL;
    this.service.getCharacteristic(C.CurrentAirPurifierState).onGet(() => this.currentState());
    this.service.getCharacteristic(C.TargetAirPurifierState).onGet(() => this.target)
      .onSet(value => this.serialize(async () => {
        const target = Number(value);
        if (![C.TargetAirPurifierState.MANUAL, C.TargetAirPurifierState.AUTO].includes(target)) throw new Error('Invalid purifier mode');
        await this.sendConfigured(target === C.TargetAirPurifierState.AUTO ? 'targetStateAuto' : 'targetStateManual');
        this.target = target;
      }));
    this.service.updateCharacteristic(C.CurrentAirPurifierState, this.currentState());
    this.service.updateCharacteristic(C.TargetAirPurifierState, this.target);
    this.setupPhysicalLock();
  }

  private currentState(): number {
    const C = this.platform.Characteristic;
    return this.active ? C.CurrentAirPurifierState.PURIFYING_AIR : C.CurrentAirPurifierState.INACTIVE;
  }

  protected override async activeChanged(): Promise<void> {
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentAirPurifierState, this.currentState());
  }
}
