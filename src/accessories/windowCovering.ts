import { performance } from 'node:perf_hooks';
import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { stateBoolean, stateNumber } from '../helpers/state';

export class WindowCoveringAccessory extends TimedAccessory {
  private readonly service: Service;
  private readonly openDuration: number;
  private readonly closeDuration: number;
  private readonly initialDelay: number;
  private position: number;
  private target: number;
  private positionState: number;
  private startedAt = 0;
  private uncertain = false;
  private wasMoving = false;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    this.openDuration = this.seconds(this.config.totalDurationOpen, NaN, true);
    this.closeDuration = this.seconds(this.config.totalDurationClose, NaN, true);
    this.initialDelay = this.seconds(this.config.initialDelay, 0.1);
    this.position = this.config.initialPosition ?? 0;
    this.validatePosition(this.position);
    this.target = this.position;
    this.restoreState({ position: stateNumber(0, 100), target: stateNumber(0, 100, true), wasMoving: stateBoolean, uncertain: stateBoolean });
    this.uncertain ||= this.wasMoving;
    const C = platform.Characteristic;
    this.positionState = C.PositionState.STOPPED;
    const serviceType = String(this.config.type).toLowerCase() === 'window'
      ? platform.Service.Window : platform.Service.WindowCovering;
    this.service = accessory.getService(serviceType) || accessory.addService(serviceType, this.name);
    this.service.getCharacteristic(C.CurrentPosition).onGet(() => {
      if (this.uncertain) throw -70402; // HAP communication failure until endpoint recalibration.
      return Math.round(this.estimatePosition());
    });
    this.service.getCharacteristic(C.PositionState).onGet(() => this.positionState);
    this.service.getCharacteristic(C.TargetPosition).onGet(() => this.target)
      .onSet(value => this.serialize(() => this.setTarget(Number(value))));
    this.service.getCharacteristic(C.HoldPosition).onSet(value => this.serialize(async () => {
      if (value && this.moving()) await this.stop();
    }));
    this.publish();
  }

  private validatePosition(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error('Window position must be between 0 and 100');
    }
  }

  private moving(): boolean {
    return this.positionState !== this.platform.Characteristic.PositionState.STOPPED;
  }

  private estimatePosition(): number {
    if (!this.moving()) return this.position;
    const opening = this.positionState === this.platform.Characteristic.PositionState.INCREASING;
    const fullDuration = opening ? this.openDuration : this.closeDuration;
    const delta = (performance.now() - this.startedAt) / (fullDuration * 1000) * 100;
    return Math.max(0, Math.min(100, this.position + (opening ? delta : -delta)));
  }

  private publish(): void {
    const C = this.platform.Characteristic;
    this.service.updateCharacteristic(C.CurrentPosition, Math.round(this.estimatePosition()));
    if (this.uncertain) this.service.updateCharacteristic(C.CurrentPosition, new Error('Position is uncertain after interrupted movement'));
    this.service.updateCharacteristic(C.TargetPosition, this.target);
    this.service.updateCharacteristic(C.PositionState, this.positionState);
  }

  private async stop(): Promise<void> {
    await this.transmit('stop');
    this.position = this.estimatePosition();
    this.target = Math.round(this.position);
    this.positionState = this.platform.Characteristic.PositionState.STOPPED;
    this.wasMoving = this.uncertain;
    this.cancelTimer('movement');
    this.publish();
  }

  private async setTarget(target: number): Promise<void> {
    this.validatePosition(target);
    if (target === this.target && !this.config.allowResend && !this.uncertain) return;
    const partial = target > 0 && target < 100;
    if (this.uncertain && partial) throw new Error('Recalibrate at 0 or 100 before selecting a partial position');
    const stopAtEnd = partial || (target === 0 ? this.config.sendStopAt0 : this.config.sendStopAt100);
    if (stopAtEnd && !this.config.data?.stop) throw new Error('A stop code is required for this window position');
    await this.delay(this.initialDelay);
    // Stop a moving covering before changing its direction or destination.
    if (this.moving()) await this.stop();
    let difference = target - this.position;
    if (this.uncertain) difference = target === 100 ? 100 : -100;
    if (difference === 0 && !(this.config.allowResend && !partial)) return;
    const opening = difference > 0 || (difference === 0 && target === 100);
    const key = target === 100 && this.config.data?.openCompletely ? 'openCompletely'
      : target === 0 && this.config.data?.closeCompletely ? 'closeCompletely'
        : opening ? 'open' : 'close';
    await this.transmit(key);
    this.target = target;
    this.startedAt = performance.now();
    this.wasMoving = true;
    this.positionState = opening ? this.platform.Characteristic.PositionState.INCREASING
      : this.platform.Characteristic.PositionState.DECREASING;
    // Resending an endpoint command performs a full travel for recalibration.
    if (difference === 0) difference = 100;
    const duration = Math.abs(difference) / 100 * (opening ? this.openDuration : this.closeDuration);
    this.publish();
    this.schedule('movement', duration * 1000, async () => {
      if (stopAtEnd) await this.transmit('stop');
      this.position = target;
      this.positionState = this.platform.Characteristic.PositionState.STOPPED;
      this.wasMoving = this.uncertain = false;
      this.publish();
    });
  }
}
