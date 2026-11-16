import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { compileCommands, type CommandStep } from '../helpers/commands';
import { stateBoolean } from '../helpers/state';

export class SwitchAccessory extends TimedAccessory {
  private readonly service: Service;
  private state = false;
  private inUse = false;
  private readonly outlet: boolean;
  private readonly onDuration: number;
  private readonly offDuration: number;
  private readonly interval: number;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    if (this.config.virtual !== undefined && typeof this.config.virtual !== 'boolean') throw new Error('virtual must be a boolean');
    if (this.config.virtual && (!['switch', 'outlet'].includes(String(this.config.type).toLowerCase())
      || this.config.data !== undefined || this.config.pingIPAddress !== undefined)) throw new Error('Virtual switches/outlets cannot configure data or power probes');
    this.outlet = String(this.config.type).toLowerCase() === 'outlet';
    this.onDuration = this.seconds(this.config.onDuration, this.config.enableAutoOff ? 60 : 0);
    this.offDuration = this.seconds(this.config.offDuration, 60);
    this.interval = this.seconds(this.config.interval, 1);
    const actionOnly = typeof this.config.data === 'string' || Buffer.isBuffer(this.config.data) || Array.isArray(this.config.data);
    if (!this.config.stateless && !actionOnly) this.restoreState({ state: stateBoolean });
    // Outlet use is a live observation when a power probe is configured.
    this.inUse = !this.config.pingIPAddress && this.state;
    const type = this.outlet ? platform.Service.Outlet : platform.Service.Switch;
    this.service = accessory.getService(type) || accessory.addService(type, this.name);
    this.service.getCharacteristic(platform.Characteristic.On).onGet(() => this.state)
      .onSet(value => this.serialize(() => this.setOn(Boolean(value))));
    if (this.outlet) this.service.getCharacteristic(platform.Characteristic.OutletInUse).onGet(() => this.inUse);
    this.service.updateCharacteristic(platform.Characteristic.On, this.state);
    if (this.outlet) this.service.updateCharacteristic(platform.Characteristic.OutletInUse, this.inUse);
    this.watchPower(on => {
      this.inUse = on;
      if (this.outlet) this.service.updateCharacteristic(platform.Characteristic.OutletInUse, on);
      if (!this.outlet || !this.config.pingIPAddressStateOnly) {
        if (this.state !== on) { this.cancelTimer('autoOn'); this.cancelTimer('autoOff'); }
        this.state = on;
        this.service.updateCharacteristic(platform.Characteristic.On, on);
      }
    });
  }

  /** Read-only gate for named AC ambient automation; undefined means no name match. */
  public automationState(name: string): boolean | undefined { return name === this.name ? this.state : undefined; }

  private async setOn(target: boolean): Promise<void> {
    const requiresSend = !this.power || await this.power.requiresSend(target);
    const data = this.config.data;
    const actionOnly = typeof data === 'string' || Buffer.isBuffer(data) || Array.isArray(data);
    const code = actionOnly ? target ? data : undefined : target ? data?.on : data?.off;
    if (!this.config.virtual && requiresSend && !code && !(target === false && (actionOnly || this.config.stateless))) {
      throw new Error(`No IR/RF code configured for "${target ? 'on' : 'off'}"`);
    }
    let steps: CommandStep[] = [];
    if (requiresSend && code) {
      const repeating = String(this.config.type).toLowerCase() === 'switch-repeat';
      steps = compileCommands(repeating ? {
        data: code,
        sendCount: (target ? this.config.onSendCount : this.config.offSendCount) ?? this.config.sendCount,
        interval: this.interval,
      } : code, this.interval);
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
    if (!this.config.pingIPAddressStateOnly || !this.outlet || !this.power) this.inUse = target;
    if (requiresSend && code && !this.config.pingIPAddressStateOnly) this.power?.recordSent(target);
    this.service.updateCharacteristic(this.platform.Characteristic.On, target);
    if (this.outlet) this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, this.inUse);
    if (target && (this.config.stateless || this.onDuration > 0)) {
      this.schedule('autoOff', (this.onDuration || 0.5) * 1000, async () => {
        if (this.config.enableAutoOff) await this.setOn(false);
        else {
          this.state = false;
          if (!this.outlet || !this.power || !this.config.pingIPAddressStateOnly) this.inUse = false;
          this.service.updateCharacteristic(this.platform.Characteristic.On, false);
          if (this.outlet) this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, this.inUse);
        }
      });
    } else if (!target && this.config.enableAutoOn) {
      this.schedule('autoOn', this.offDuration * 1000, () => this.setOn(true));
    }
  }
}
