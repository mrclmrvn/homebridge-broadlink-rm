import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeviceManager } from './deviceManager';
import { createAccessoryInstance, BaseAccessory } from './accessories';

export class BroadlinkRMPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly instances: Map<string, BaseAccessory> = new Map();
  public readonly deviceManager: DeviceManager;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.deviceManager = new DeviceManager(this.log);

    this.log.info(`[${PLATFORM_NAME}] Initializing Broadlink RM v5 platform...`);

    this.api.on('didFinishLaunching', async () => {
      await this.initDevicesAndAccessories();
    });

    this.api.on('shutdown', () => {
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
  public updateAccessoryContext(accessory: PlatformAccessory): void {
    try {
      this.api.updatePlatformAccessories([accessory]);
    } catch {
      this.log.warn(`[${PLATFORM_NAME}] Could not persist state for "${accessory.displayName}"; it may be lost on restart.`);
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

    // 3. Register and bind accessories from config
    const configuredAccessories = this.config.accessories || [];
    const activeUUIDs = new Set<string>();

    for (const accConfig of configuredAccessories) {
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

