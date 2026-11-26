import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { IRScheduler } from './helpers/irScheduler';
import { ExternalStateStore } from './helpers/externalState';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeviceManager } from './deviceManager';
import { createAccessoryInstance, BaseAccessory } from './accessories';

export class BroadlinkRMPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly instances: Map<string, BaseAccessory> = new Map();
  public readonly deviceManager: DeviceManager;
  public readonly irScheduler: IRScheduler;
  private stopped = false;
  private readonly externalIds = new Set<string>();
  private externalStateStore?: ExternalStateStore;

  private externalStore(): ExternalStateStore {
    this.externalStateStore ||= new ExternalStateStore(this.api.user.storagePath(),
      `${PLUGIN_NAME}:${this.config._bridge?.username || this.config.name || PLATFORM_NAME}`);
    return this.externalStateStore;
  }

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.irScheduler = new IRScheduler(config.irCommandDelay, config.irDeviceGroupDelay);
    this.deviceManager = new DeviceManager(this.log);

    this.log.info(`[${PLATFORM_NAME}] Initializing Broadlink RM v5 platform...`);

    this.api.on('didFinishLaunching', async () => {
      await this.initDevicesAndAccessories();
    });

    this.api.on('shutdown', () => {
      this.stopped = true;
      for (const instance of this.instances.values()) instance.dispose();
      this.deviceManager.closeAll();
    });
  }

  /**
   * Homebridge calls this for each cached accessory restored from disk on startup
   */
  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`[${PLATFORM_NAME}] Restoring cached accessory: ${accessory.displayName} (${accessory.UUID})`);
    this.accessories.set(accessory.UUID, accessory);
  }

  /** Ask Homebridge to persist updated context without replaying accessory commands. */
  public updateAccessoryContext(accessory: PlatformAccessory): boolean {
    try {
      if (this.externalIds.has(accessory.UUID)) this.externalStore().write(accessory.UUID, accessory.context.broadlinkRMState);
      else this.api.updatePlatformAccessories([accessory]);
      return true;
    } catch {
      this.log.warn(`[${PLATFORM_NAME}] Could not persist state for "${accessory.displayName}"; it may be lost on restart.`);
      return false;
    }
  }

  private createInstance(accessory: PlatformAccessory): BaseAccessory | null {
    try {
      return createAccessoryInstance(this, accessory);
    } catch (error) {
      this.log.error(`[${PLATFORM_NAME}] Cannot configure "${accessory.displayName}": ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private async initDevicesAndAccessories(): Promise<void> {
    // 1. Initialize statically declared hosts
    if (this.config.hosts && Array.isArray(this.config.hosts)) {
      await this.deviceManager.initHosts(this.config.hosts);
    }

    // 2. Run UDP discovery if hosts are not configured or auto-discovery is enabled
    const disableDiscovery = this.config.disableDiscovery === true;
    if (!disableDiscovery) {
      this.log.info(`[${PLATFORM_NAME}] Discovering Broadlink devices on local network...`);
      await this.deviceManager.discover(3000);
    }
    if (this.stopped) return;
    if (!disableDiscovery) this.deviceManager.startRediscovery(this.config.rediscoveryInterval);

    // 3. Register and bind accessories from config
    const configuredAccessories = Array.isArray(this.config.accessories) ? this.config.accessories : [];
    const hasLearningAccessory = configuredAccessories.some((accessory: any) =>
      ['learn-ir', 'learn-code'].includes(String(accessory?.type || '').toLowerCase()));
    const platformOptions = this.config as PlatformConfig & {
      hideLearnButton?: boolean;
      hideScanFrequencyButton?: boolean;
    };
    const accessoriesToRegister = [...configuredAccessories];
    if (!hasLearningAccessory) {
      if (!platformOptions.hideLearnButton) {
        accessoriesToRegister.push({ name: 'Learn', type: 'learn-code' });
      }
      if (!platformOptions.hideScanFrequencyButton) {
        accessoriesToRegister.push({ name: 'Scan Frequency', type: 'learn-code', scanFrequency: true });
      }
    }
    const activeUUIDs = new Set<string>();
    const configuredUUIDs = new Set<string>();

    for (const accConfig of accessoriesToRegister) {
      if (!accConfig.name || !accConfig.type) {
        this.log.warn(`[${PLATFORM_NAME}] Skipping accessory missing "name" or "type"`);
        continue;
      }

      if (accConfig.disabled) {
        this.log.info(`[${PLATFORM_NAME}] Skipping disabled accessory: "${accConfig.name}"`);
        continue;
      }

      // Generate a deterministic UUID based on accessory name and host
      const uuidKey = `${accConfig.name}:${accConfig.host || 'default'}`;
      const uuid = this.api.hap.uuid.generate(uuidKey);
      // An external TV's UUID also determines its advertised HomeKit address.
      // Publishing it twice can reject asynchronously inside Homebridge.
      if (configuredUUIDs.has(uuid)) {
        this.log.warn(`[${PLATFORM_NAME}] Skipping duplicate accessory identity for "${accConfig.name}"; name and host must be unique.`);
        continue;
      }
      configuredUUIDs.add(uuid);
      if (['tv', 'television'].includes(String(accConfig.type).toLowerCase())) {
        // External TVs are recreated each launch; remove any older bridged cache entry.
        const cached = this.accessories.get(uuid);
        if (cached) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
          this.accessories.delete(uuid);
        }
        const television = new this.api.platformAccessory(
          accConfig.name, uuid, this.api.hap.Categories.TELEVISION,
        );
        television.context.config = accConfig;
        this.externalIds.add(uuid);
        if (accConfig.persistState !== false && this.api.user) {
          try { television.context.broadlinkRMState = this.externalStore().read(uuid) ?? cached?.context.broadlinkRMState; }
          catch (error) { this.log.warn(`[${accConfig.name}] Could not load saved TV state: ${(error as Error).message}`); }
        }
        const instance = this.createInstance(television);
        if (instance) {
          this.api.publishExternalAccessories(PLUGIN_NAME, [television]);
          this.instances.set(uuid, instance);
        }
        continue;
      }
      const cached = this.accessories.get(uuid);
      const accessory = cached || new this.api.platformAccessory(accConfig.name, uuid);
      accessory.context.config = accConfig;
      const instance = this.createInstance(accessory);
      if (!instance) continue;
      activeUUIDs.add(uuid);
      if (cached) {
        this.log.info(`[${PLATFORM_NAME}] Restoring accessory: "${accConfig.name}"`);
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info(`[${PLATFORM_NAME}] Registering new accessory: "${accConfig.name}"`);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
      this.instances.get(uuid)?.dispose();
      this.instances.set(uuid, instance);
    }

    // 4. Remove stale cached accessories that are no longer configured
    const staleAccessories: PlatformAccessory[] = [];
    for (const [uuid, accessory] of this.accessories.entries()) {
      if (!activeUUIDs.has(uuid)) {
        this.log.info(`[${PLATFORM_NAME}] Removing stale cached accessory: "${accessory.displayName}"`);
        staleAccessories.push(accessory);
        this.accessories.delete(uuid);
        this.instances.get(uuid)?.dispose();
        this.instances.delete(uuid);
      }
    }

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }

    this.log.info(`[${PLATFORM_NAME}] Platform ready with ${this.instances.size} active accessories.`);
  }
}

