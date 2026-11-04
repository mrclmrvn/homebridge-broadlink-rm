import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';

type SendStep = { code: string | Buffer } | { delay: number };

export class SwitchAccessory extends TimedAccessory {
  private readonly service: Service;
  private state = false;
  private readonly outlet: boolean;
  private readonly onDuration: number;
  private readonly offDuration: number;
  private readonly interval: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    this.outlet = String(this.config.type).toLowerCase() === 'outlet';
    this.onDuration = this.seconds(this.config.onDuration, this.config.enableAutoOff ? 60 : 0);
    this.offDuration = this.seconds(this.config.offDuration, 60);
    this.interval = this.seconds(this.config.interval, 1);
    const type = this.outlet ? platform.Service.Outlet : platform.Service.Switch;
    this.service = accessory.getService(type) || accessory.addService(type, this.name);
    this.service.getCharacteristic(platform.Characteristic.On).onGet(() => this.state)
      .onSet(value => this.serialize(() => this.setOn(Boolean(value))));
    if (this.outlet) this.service.getCharacteristic(platform.Characteristic.OutletInUse).onGet(() => this.state);
  }

  private count(value: unknown): number {
    const count = value ?? 1;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 10000) {
      throw new Error('sendCount must be an integer between 1 and 10000');
    }
    return count;
  }

  /** Validate the complete sequence before transmitting any of it. */
  private plan(value: any, interval = this.interval, depth = 0): SendStep[] {
    if (depth > 20) throw new Error('Code sequence is nested too deeply');
    if (typeof value === 'string' && value.length > 0 || Buffer.isBuffer(value)) return [{ code: value }];
    if (Array.isArray(value)) {
      if (!value.length) throw new Error('Code sequence must not be empty');
      return value.flatMap((entry, index) => {
        const steps = this.plan(entry, interval, depth + 1);
        if (index < value.length - 1 && !entry?.pause && interval > 0) steps.push({ delay: interval });
        return steps;
      });
    }
    if (!value || typeof value !== 'object' || !value.data) throw new Error('Invalid IR/RF code sequence');
    const count = this.count(value.sendCount);
    const gap = this.seconds(value.interval, 0.1);
    const pause = this.seconds(value.pause, 0);
    const steps: SendStep[] = [];
    for (let i = 0; i < count; i++) {
      steps.push(...this.plan(value.data, interval, depth + 1));
      if (i < count - 1 && gap > 0) steps.push({ delay: gap });
      if (steps.length > 10000) throw new Error('Code sequence is too long');
    }
    if (pause > 0) steps.push({ delay: pause });
    return steps;
  }

  private async setOn(target: boolean): Promise<void> {
    const data = this.config.data;
    const actionOnly = typeof data === 'string' || Buffer.isBuffer(data) || Array.isArray(data);
    const code = actionOnly ? target ? data : undefined : target ? data?.on : data?.off;
    if (!code && !(target === false && (actionOnly || this.config.stateless))) {
      throw new Error(`No IR/RF code configured for "${target ? 'on' : 'off'}"`);
    }
    let steps: SendStep[] = [];
    if (code) {
      const repeating = String(this.config.type).toLowerCase() === 'switch-repeat';
      steps = this.plan(repeating ? {
        data: code,
        sendCount: (target ? this.config.onSendCount : this.config.offSendCount) ?? this.config.sendCount,
        interval: this.interval,
      } : code);
      if (steps.length > 10000) throw new Error('Code sequence is too long');
    }
    for (const step of steps) {
      if ('delay' in step) await this.delay(step.delay);
      else {
        await this.sendCode(step.code);
        if (this.disposed) throw new Error('Accessory has shut down');
      }
    }
    this.cancelTimer('autoOff');
    this.cancelTimer('autoOn');
    this.state = target;
    this.service.updateCharacteristic(this.platform.Characteristic.On, target);
    if (this.outlet) this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, target);
    if (target && (this.config.stateless || this.onDuration > 0)) {
      this.schedule('autoOff', (this.onDuration || 0.5) * 1000, async () => {
        if (this.config.enableAutoOff) await this.setOn(false);
        else {
          this.state = false;
          this.service.updateCharacteristic(this.platform.Characteristic.On, false);
          if (this.outlet) this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, false);
        }
      });
    } else if (!target && this.config.enableAutoOn) {
      this.schedule('autoOn', this.offDuration * 1000, () => this.setOn(true));
    }
  }
}
