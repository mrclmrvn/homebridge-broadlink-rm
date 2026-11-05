import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { FeedbackSource } from '../sensors/feedback';

export class GarageDoorOpenerAccessory extends TimedAccessory {
  private readonly service: Service;
  private current: number;
  private target: number;
  private lockCurrent: number;
  private lockTarget: number;
  private readonly openDuration: number;
  private readonly closeDuration: number;
  private readonly autoCloseDelay: number;
  private readonly closedSensor?: FeedbackSource;
  private readonly openSensor?: FeedbackSource;
  private readonly obstructionSensor?: FeedbackSource;
  private movement?: number;
  private pendingAutoClose = false;

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
    if (this.config.closedSensor) this.closedSensor = new FeedbackSource(this.config.closedSensor, 'contact');
    if (this.config.openSensor) this.openSensor = new FeedbackSource(this.config.openSensor, 'contact');
    if (this.config.obstructionSensor) this.obstructionSensor = new FeedbackSource(this.config.obstructionSensor, 'obstruction');
    if (this.hasEndpoints() && this.autoCloseDelay > 0 && !this.openSensor) throw new Error('Automatic close with endpoint feedback requires an openSensor');
    this.service = accessory.getService(platform.Service.GarageDoorOpener)
      || accessory.addService(platform.Service.GarageDoorOpener, this.name);
    this.service.getCharacteristic(C.CurrentDoorState).onGet(() =>
      this.hasEndpoints() ? this.refreshEndpoints().then(() => this.current) : this.current);
    this.service.getCharacteristic(C.TargetDoorState).onGet(() => this.target)
      .onSet(value => this.serialize(() => this.setTarget(Number(value))));
    this.service.getCharacteristic(C.ObstructionDetected).onGet(() => this.obstructionSensor ? this.readObstruction() : false);
    if (this.hasEndpoints()) this.service.updateCharacteristic(C.CurrentDoorState, new Error('Waiting for door endpoint feedback'));
    else this.service.updateCharacteristic(C.CurrentDoorState, this.current);
    this.service.updateCharacteristic(C.TargetDoorState, this.target);
    if (this.config.data?.lock && this.config.data?.unlock) {
      this.service.getCharacteristic(C.LockCurrentState).onGet(() => this.lockCurrent);
      this.service.getCharacteristic(C.LockTargetState).onGet(() => this.lockTarget)
        .onSet(value => this.serialize(async () => {
          const target = Number(value);
          if (![C.LockTargetState.SECURED, C.LockTargetState.UNSECURED].includes(target)) throw new Error('Invalid garage lock target state');
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
    for (const source of this.sources()) source.onUpdate(() => this.schedule('feedback', 0, () => this.poll()));
    if (this.sources().length) this.schedule('feedback', 0, () => this.poll());
  }

  private sources(): FeedbackSource[] {
    return [this.closedSensor, this.openSensor, this.obstructionSensor].filter((source): source is FeedbackSource => Boolean(source));
  }
  private hasEndpoints(): boolean { return Boolean(this.closedSensor || this.openSensor); }

  private armAutoClose(): void {
    if (this.pendingAutoClose && this.autoCloseDelay > 0) {
      this.schedule('autoClose', this.autoCloseDelay * 1000, () => this.setTarget(this.platform.Characteristic.TargetDoorState.CLOSED));
    }
    this.pendingAutoClose = false;
  }

  private async readObstruction(): Promise<boolean> {
    if (!this.obstructionSensor) return false;
    try {
      const obstructed = await this.obstructionSensor.read();
      if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, obstructed);
      return obstructed;
    } catch (error) {
      if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, error as Error);
      throw error;
    }
  }

  private async refreshEndpoints(): Promise<void> {
    if (!this.hasEndpoints()) return;
    const C = this.platform.Characteristic;
    try {
      const [closed, open] = await Promise.all([this.closedSensor?.read(), this.openSensor?.read()]);
      if (this.disposed) return;
      if (closed && open) throw new Error('Garage endpoints report contradictory states');
      this.current = closed ? C.CurrentDoorState.CLOSED : open ? C.CurrentDoorState.OPEN
        : this.movement === C.TargetDoorState.OPEN ? C.CurrentDoorState.OPENING
          : this.movement === C.TargetDoorState.CLOSED ? C.CurrentDoorState.CLOSING : C.CurrentDoorState.STOPPED;
      const reached = this.movement === C.TargetDoorState.OPEN && open || this.movement === C.TargetDoorState.CLOSED && closed;
      if (reached) {
        this.cancelTimer('transition');
        this.movement = undefined;
        if (open) this.armAutoClose();
      }
      if (this.movement === undefined && (closed || open)) {
        this.target = closed ? C.TargetDoorState.CLOSED : C.TargetDoorState.OPEN;
        this.service.updateCharacteristic(C.TargetDoorState, this.target);
      }
      this.service.updateCharacteristic(C.CurrentDoorState, this.current);
    } catch (error) {
      if (!this.disposed) this.service.updateCharacteristic(C.CurrentDoorState, error as Error);
      throw error;
    }
  }

  private async poll(): Promise<void> {
    try { await this.refreshEndpoints(); } catch { /* Publish the fault, retain last observed state. */ }
    try { await this.readObstruction(); } catch { /* An unavailable obstruction source blocks closing. */ }
    const intervals = this.sources().map(source => source.interval).filter(interval => interval > 0);
    if (intervals.length) this.schedule('feedback', Math.min(...intervals), () => this.poll());
  }

  private async setTarget(target: number): Promise<void> {
    const C = this.platform.Characteristic;
    if (![C.TargetDoorState.OPEN, C.TargetDoorState.CLOSED].includes(target)) throw new Error('Invalid garage door target state');
    if (target === C.TargetDoorState.CLOSED && await this.readObstruction()) throw new Error('Garage obstruction detected; close command blocked');
    if (this.hasEndpoints()) await this.refreshEndpoints();
    if (this.disposed) throw new Error('Accessory has shut down');
    if (target === this.target && (this.movement === target || this.current === target)) return;
    const opening = target === C.TargetDoorState.OPEN;
    await this.transmit(opening ? 'open' : 'close');
    this.cancelTimer('transition');
    this.cancelTimer('autoClose');
    this.target = this.movement = target;
    this.pendingAutoClose = opening;
    this.current = opening ? C.CurrentDoorState.OPENING : C.CurrentDoorState.CLOSING;
    this.service.updateCharacteristic(C.TargetDoorState, target);
    this.service.updateCharacteristic(C.CurrentDoorState, this.current);
    this.schedule('transition', (opening ? this.openDuration : this.closeDuration) * 1000, async () => {
      if (this.hasEndpoints()) {
        try { await this.refreshEndpoints(); }
        catch (error) { this.movement = undefined; this.pendingAutoClose = false; throw error; }
        if (this.movement !== undefined) {
          this.movement = undefined;
          this.pendingAutoClose = false;
          if (![C.CurrentDoorState.OPEN, C.CurrentDoorState.CLOSED].includes(this.current)) this.current = C.CurrentDoorState.STOPPED;
          this.service.updateCharacteristic(C.CurrentDoorState, this.current);
          const endpointConfigured = opening ? this.openSensor : this.closedSensor;
          if (endpointConfigured) throw new Error('Garage feedback did not reach the requested endpoint');
        }
      } else {
        this.movement = undefined;
        this.current = opening ? C.CurrentDoorState.OPEN : C.CurrentDoorState.CLOSED;
        this.service.updateCharacteristic(C.CurrentDoorState, this.current);
        if (opening) this.armAutoClose();
      }
    });
  }

  public override dispose(): void { super.dispose(); for (const source of this.sources()) source.dispose(); }
}
