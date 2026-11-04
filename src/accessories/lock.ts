import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';

export class LockAccessory extends TimedAccessory {
  private readonly service: Service;
  private current: number;
  private target: number;
  private transitioning = false;
  private readonly lockDuration: number;
  private readonly unlockDuration: number;
  private readonly autoLockDelay: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    this.current = C.LockCurrentState.UNKNOWN;
    this.target = C.LockTargetState.SECURED;
    this.lockDuration = this.seconds(this.config.lockDuration ?? this.config.lockUnlockDuration, 1);
    this.unlockDuration = this.seconds(this.config.unlockDuration ?? this.config.lockUnlockDuration, 1);
    this.autoLockDelay = this.seconds(this.config.autoLockDelay, 0);
    this.service = accessory.getService(platform.Service.LockMechanism)
      || accessory.addService(platform.Service.LockMechanism, this.name);
    this.service.getCharacteristic(C.LockCurrentState).onGet(() => this.current);
    this.service.getCharacteristic(C.LockTargetState).onGet(() => this.target)
      .onSet(value => this.serialize(() => this.setTarget(Number(value))));
    this.service.updateCharacteristic(C.LockCurrentState, this.current);
    this.service.updateCharacteristic(C.LockTargetState, this.target);
  }

  private async setTarget(target: number): Promise<void> {
    const C = this.platform.Characteristic;
    if (![C.LockTargetState.SECURED, C.LockTargetState.UNSECURED].includes(target)) {
      throw new Error('Invalid lock target state');
    }
    if (target === this.target && (this.transitioning || this.current === target)) return;
    const locking = target === C.LockTargetState.SECURED;
    await this.transmit(locking ? 'lock' : 'unlock');
    this.cancelTimer('transition');
    this.cancelTimer('autoLock');
    this.target = target;
    this.transitioning = true;
    this.current = C.LockCurrentState.UNKNOWN;
    this.service.updateCharacteristic(C.LockTargetState, target);
    this.service.updateCharacteristic(C.LockCurrentState, this.current);
    this.schedule('transition', (locking ? this.lockDuration : this.unlockDuration) * 1000, async () => {
      this.current = target;
      this.transitioning = false;
      this.service.updateCharacteristic(C.LockCurrentState, this.current);
      if (!locking && this.autoLockDelay > 0) {
        this.schedule('autoLock', this.autoLockDelay * 1000, () => this.setTarget(C.LockTargetState.SECURED));
      }
    });
  }
}
