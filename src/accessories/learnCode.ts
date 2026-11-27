import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { BaseAccessory } from './base';

export class LearnCodeAccessory extends BaseAccessory {
  private readonly service: Service;
  private controller?: AbortController;
  private disposed = false;
  private start?: NodeJS.Immediate;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    this.service = accessory.getService(platform.Service.Switch) || accessory.addService(platform.Service.Switch, this.name);
    this.service.getCharacteristic(platform.Characteristic.On).onGet(() => Boolean(this.controller))
      .onSet(value => {
        if (!value) {
          this.controller?.abort();
          if (this.start) { clearImmediate(this.start); this.start = undefined; this.controller = undefined; }
          return;
        }
        if (this.disposed) throw new Error('Accessory has shut down');
        if (!this.controller) {
          const controller = this.controller = new AbortController();
          // Let HomeKit acknowledge On before any immediate learning failure resets it.
          this.start = setImmediate(() => {
            this.start = undefined;
            if (!this.disposed) void this.learn(controller);
          });
        }
      });
  }

  private async learn(controller: AbortController): Promise<void> {
    try {
      const device = this.platform.deviceManager.getDevice(this.config.host);
      if (!device) {
        const host = this.config.host;
        throw new Error(host
          ? `No Broadlink device matched host "${host}". Check its IP or MAC against discovery or the configured hosts.`
          : 'No Broadlink device is registered. Check discovery or configure a static host.');
      }
      const rf = String(this.config.type).toLowerCase() === 'learn-rf' || this.config.scanFrequency === true;
      this.log.debug(`[${this.name}] Starting ${rf ? 'RF' : 'IR'} learning on ${device.host} (type 0x${device.devType.toString(16)})`);
      if (!rf) this.log.info(`[${this.name}] Press one IR remote button after the Broadlink enters learning mode`);
      const code = rf ? await device.learnRFData({ signal: controller.signal, onProgress: stage =>
        this.log.info(`[${this.name}] ${stage === 'frequency' ? 'Hold the RF remote button for frequency detection' : 'Release and press the button again to capture the RF code'}`) })
        : await device.learnData(20000, 1000, controller.signal);
      if (!this.disposed) this.log.info(`[${this.name}] Learned hex code: ${code}`);
    } catch (error) {
      if (!this.disposed && controller.signal.aborted) this.log.debug(`[${this.name}] Learning cancelled`);
      else if (!this.disposed) this.log.warn(`[${this.name}] Learning stopped: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.controller = undefined;
      if (!this.disposed) this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }
  }

  public override dispose(): void {
    this.disposed = true;
    super.dispose();
    this.controller?.abort();
    if (this.start) clearImmediate(this.start);
    this.start = undefined;
  }
}
