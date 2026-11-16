import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { FeedbackSource } from '../sensors/feedback';
import { stateEnum } from '../helpers/state';

export class LockAccessory extends TimedAccessory {
  private readonly service: Service;
  private current: number;
  private target: number;
  private transitioning = false;
  private readonly lockDuration: number;
  private readonly unlockDuration: number;
  private readonly autoLockDelay: number;
  private readonly feedback?: FeedbackSource;
  private readonly jam?: FeedbackSource;
  private pendingAutoLock = false;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    this.current = C.LockCurrentState.UNKNOWN;
    this.target = C.LockTargetState.SECURED;
    this.restoreState({ target: stateEnum(C.LockTargetState.SECURED, C.LockTargetState.UNSECURED) });
    this.lockDuration = this.seconds(this.config.lockDuration ?? this.config.lockUnlockDuration, 1);
    this.unlockDuration = this.seconds(this.config.unlockDuration ?? this.config.lockUnlockDuration, 1);
    this.autoLockDelay = this.seconds(this.config.autoLockDelay, 0);
    if (this.config.jamSensor) this.jam = new FeedbackSource(this.config.jamSensor, 'jam');
    if (this.config.lockSensor) this.feedback = new FeedbackSource(this.config.lockSensor, 'lock');
    this.service = accessory.getService(platform.Service.LockMechanism)
      || accessory.addService(platform.Service.LockMechanism, this.name);
    this.service.getCharacteristic(C.LockCurrentState).onGet(() =>
      this.feedback || this.jam ? this.refresh().then(() => this.current) : this.current);
    this.service.getCharacteristic(C.LockTargetState).onGet(() => this.target)
      .onSet(value => this.serialize(() => this.setTarget(Number(value))));
    if (this.feedback || this.jam) this.service.updateCharacteristic(C.LockCurrentState, new Error('Waiting for lock feedback'));
    else this.service.updateCharacteristic(C.LockCurrentState, this.current);
    this.service.updateCharacteristic(C.LockTargetState, this.target);
    for (const source of [this.feedback, this.jam]) source?.onUpdate(() => this.schedule('feedback', 0, () => this.poll()));
    if (this.feedback || this.jam) this.schedule('feedback', 0, () => this.poll());
  }

  private armAutoLock(): void {
    if (this.pendingAutoLock && this.autoLockDelay > 0) {
      this.schedule('autoLock', this.autoLockDelay * 1000, () => this.setTarget(this.platform.Characteristic.LockTargetState.SECURED));
    }
    this.pendingAutoLock = false;
  }

  private async refresh(): Promise<void> {
    try {
      if (this.jam) {
        const jammed = await this.jam.read();
        if (this.disposed) return;
        if (jammed) {
          this.cancelTimer('transition'); this.cancelTimer('autoLock');
          this.transitioning = this.pendingAutoLock = false;
          this.current = this.platform.Characteristic.LockCurrentState.JAMMED;
          this.service.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.current);
          return;
        }
        if (this.current === this.platform.Characteristic.LockCurrentState.JAMMED) this.current = this.platform.Characteristic.LockCurrentState.UNKNOWN;
      }
      if (!this.feedback) {
        this.service.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.current);
        return;
      }
      const secured = await this.feedback.read();
      if (this.disposed) return;
      this.current = secured ? this.platform.Characteristic.LockCurrentState.SECURED : this.platform.Characteristic.LockCurrentState.UNSECURED;
      if (this.transitioning && this.current === this.target) {
        this.cancelTimer('transition');
        this.transitioning = false;
        if (!secured) this.armAutoLock();
      }
      if (secured) this.cancelTimer('autoLock');
      if (!this.transitioning) {
        this.target = this.current;
        this.service.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.target);
      }
      this.service.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.current);
      this.persistState();
    } catch (error) {
      if (this.jam) { this.cancelTimer('transition'); this.cancelTimer('autoLock'); this.transitioning = this.pendingAutoLock = false; }
      if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.LockCurrentState, error as Error);
      throw error;
    }
  }

  private async poll(): Promise<void> {
    try { await this.refresh(); } catch { /* Error is exposed on the current-state characteristic. */ }
    finally {
      const intervals = [this.feedback?.interval, this.jam?.interval].filter((value): value is number => value !== undefined && value > 0);
      if (intervals.length) this.schedule('feedback', Math.min(...intervals), () => this.poll());
    }
  }

  private async setTarget(target: number): Promise<void> {
    const C = this.platform.Characteristic;
    if (![C.LockTargetState.SECURED, C.LockTargetState.UNSECURED].includes(target)) throw new Error('Invalid lock target state');
    if (this.feedback || this.jam) await this.refresh();
    if (this.current === C.LockCurrentState.JAMMED) throw new Error('Lock is jammed; command blocked');
    if (this.disposed) throw new Error('Accessory has shut down');
    if (target === this.target && (this.transitioning || this.current === target)) return;
    const locking = target === C.LockTargetState.SECURED;
    await this.transmit(locking ? 'lock' : 'unlock');
    this.cancelTimer('transition');
    this.cancelTimer('autoLock');
    this.target = target;
    this.transitioning = true;
    this.pendingAutoLock = !locking;
    if (!this.feedback) this.current = C.LockCurrentState.UNKNOWN;
    this.service.updateCharacteristic(C.LockTargetState, target);
    this.service.updateCharacteristic(C.LockCurrentState, this.current);
    this.schedule('transition', (locking ? this.lockDuration : this.unlockDuration) * 1000, async () => {
      if (this.feedback || this.jam) {
        try { await this.refresh(); }
        catch (error) { this.transitioning = false; this.pendingAutoLock = false; throw error; }
        if (this.current === C.LockCurrentState.JAMMED) throw new Error('Lock is jammed');
      }
      if (this.feedback) {
        if (this.current !== target) {
          this.transitioning = false;
          this.pendingAutoLock = false;
          const error = new Error('Lock feedback did not reach the requested state');
          this.service.updateCharacteristic(C.LockCurrentState, error);
          throw error;
        }
      } else {
        this.current = target;
        this.transitioning = false;
        this.service.updateCharacteristic(C.LockCurrentState, this.current);
        if (!locking) this.armAutoLock();
      }
    });
  }

  public override dispose(): void { super.dispose(); this.feedback?.dispose(); this.jam?.dispose(); }
}
