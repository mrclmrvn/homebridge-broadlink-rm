import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';

export class GarageDoorOpenerAccessory extends TimedAccessory {
  private readonly service: Service;
  private current: number;
  private target: number;
  private lockCurrent: number;
  private lockTarget: number;
  private readonly openDuration: number;
  private readonly closeDuration: number;
  private readonly autoCloseDelay: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    this.current = C.CurrentDoorState.STOPPED;
    this.target = C.TargetDoorState.CLOSED;
    this.lockCurrent = C.LockCurrentState.UNKNOWN;
    this.lockTarget = C.LockTargetState.SECURED;
    this.openDuration = this.seconds(this.config.openDuration ?? this.config.openCloseDuration, 8);
    this.closeDuration = this.seconds(this.config.closeDuration ?? this.config.openCloseDuration, 8);
    this.autoCloseDelay = this.seconds(this.config.autoCloseDelay, 0);
    this.service = accessory.getService(platform.Service.GarageDoorOpener)
      || accessory.addService(platform.Service.GarageDoorOpener, this.name);
    this.service.getCharacteristic(C.CurrentDoorState).onGet(() => this.current);
    this.service.getCharacteristic(C.TargetDoorState).onGet(() => this.target)
      .onSet(value => this.serialize(() => this.setTarget(Number(value))));
    this.service.getCharacteristic(C.ObstructionDetected).onGet(() => false);
    this.service.updateCharacteristic(C.CurrentDoorState, this.current);
    this.service.updateCharacteristic(C.TargetDoorState, this.target);
    if (this.config.data?.lock && this.config.data?.unlock) {
      this.service.getCharacteristic(C.LockCurrentState).onGet(() => this.lockCurrent);
      this.service.getCharacteristic(C.LockTargetState).onGet(() => this.lockTarget)
        .onSet(value => this.serialize(async () => {
          const target = Number(value);
          if (![C.LockTargetState.SECURED, C.LockTargetState.UNSECURED].includes(target)) {
            throw new Error('Invalid garage lock target state');
          }
          if (this.lockCurrent === target) return;
          await this.transmit(target === C.LockTargetState.SECURED ? 'lock' : 'unlock');
          this.lockTarget = this.lockCurrent = target;
          this.service.updateCharacteristic(C.LockCurrentState, target);
          this.service.updateCharacteristic(C.LockTargetState, target);
        }));
      this.service.updateCharacteristic(C.LockCurrentState, this.lockCurrent);
      this.service.updateCharacteristic(C.LockTargetState, this.lockTarget);
    } else {
      for (const type of [C.LockCurrentState, C.LockTargetState]) {
        if (this.service.testCharacteristic(type)) this.service.removeCharacteristic(this.service.getCharacteristic(type));
      }
    }
  }

  private async setTarget(target: number): Promise<void> {
    const C = this.platform.Characteristic;
    if (![C.TargetDoorState.OPEN, C.TargetDoorState.CLOSED].includes(target)) {
      throw new Error('Invalid garage door target state');
    }
    if (target === this.target && this.current !== C.CurrentDoorState.STOPPED) return;
    const opening = target === C.TargetDoorState.OPEN;
    await this.transmit(opening ? 'open' : 'close');
    this.cancelTimer('transition');
    this.cancelTimer('autoClose');
    this.target = target;
    this.current = opening ? C.CurrentDoorState.OPENING : C.CurrentDoorState.CLOSING;
    this.service.updateCharacteristic(C.TargetDoorState, target);
    this.service.updateCharacteristic(C.CurrentDoorState, this.current);
    this.schedule('transition', (opening ? this.openDuration : this.closeDuration) * 1000, async () => {
      this.current = opening ? C.CurrentDoorState.OPEN : C.CurrentDoorState.CLOSED;
      this.service.updateCharacteristic(C.CurrentDoorState, this.current);
      if (opening && this.autoCloseDelay > 0) {
        this.schedule('autoClose', this.autoCloseDelay * 1000, () => this.setTarget(C.TargetDoorState.CLOSED));
      }
    });
  }
}
