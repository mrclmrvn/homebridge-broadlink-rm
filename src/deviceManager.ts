import { Logging } from 'homebridge';
import { RMDevice, discoverDevices, getDeviceInfo } from './broadlink';

export interface HostConfig {
  address: string;
  mac: string;
  devType?: number | string;
  port?: number;
  isRM4?: boolean;
  isRFSupported?: boolean;
}

export class DeviceManager {
  private devicesByIp: Map<string, RMDevice> = new Map();
  private devicesByMac: Map<string, RMDevice> = new Map();
  private allDevices: RMDevice[] = [];
  private log: Logging;

  constructor(log: Logging) {
    this.log = log;
  }

  private normalizeMac(mac: string): string {
    return mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  }

  public registerDevice(device: RMDevice): void {
    const ip = device.host;
    const macKey = this.normalizeMac(device.macAddress);

    const existing = this.devicesByMac.get(macKey);
    if (existing === device) return;
    if (existing) {
      if (existing.host === device.host && existing.devType === device.devType && existing.port === device.port) {
        device.close();
        return;
      }
      existing.close();
      if (this.devicesByIp.get(existing.host) === existing) this.devicesByIp.delete(existing.host);
      this.allDevices[this.allDevices.indexOf(existing)] = device;
    } else this.allDevices.push(device);

    this.devicesByIp.set(ip, device);
    this.devicesByMac.set(macKey, device);

    const info = getDeviceInfo(device.devType);
    this.log.info(`[DeviceManager] Registered ${info.name} at ${ip} (${device.macAddress})`);
  }

  public async initHosts(hosts?: HostConfig[]): Promise<void> {
    if (hosts && Array.isArray(hosts) && hosts.length > 0) {
      for (const host of hosts) {
        if (!host || typeof host !== 'object' || !host.address || !host.mac) {
          this.log.warn(`[DeviceManager] Skipping invalid host config: ${JSON.stringify(host)}`);
          continue;
        }

        try {
          let devType = host.isRM4 ? host.isRFSupported ? 0x520b : 0x520c : host.isRFSupported ? 0x2712 : 0x2737;
          if (host.devType !== undefined) {
            if (typeof host.devType === 'number') devType = host.devType;
            else if (/^(?:0x)?[0-9a-f]{1,4}$/i.test(host.devType)) devType = parseInt(host.devType.replace(/^0x/i, ''), 16);
            else throw new Error('devType must be an integer or a hexadecimal string');
          }
          const device = new RMDevice(host.address, host.mac, devType, host.port);
          this.registerDevice(device);
        } catch (error) {
          this.log.warn(`[DeviceManager] Skipping invalid host: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  public async discover(timeoutMs: number = 3000): Promise<void> {
    try {
      const discovered = await discoverDevices(timeoutMs);
      for (const item of discovered) {
        this.registerDevice(item.device);
      }
    } catch (err: any) {
      this.log.error(`[DeviceManager] Discovery error: ${err.message}`);
    }
  }

  public getDevice(host?: string): RMDevice | undefined {
    if (!host) {
      return this.allDevices[0];
    }

    const byIp = this.devicesByIp.get(host);
    if (byIp) return byIp;

    const byMac = this.devicesByMac.get(this.normalizeMac(host));
    if (byMac) return byMac;

    return undefined;
  }

  public closeAll(): void {
    for (const dev of this.allDevices) {
      dev.close();
    }
    this.devicesByIp.clear();
    this.devicesByMac.clear();
    this.allDevices = [];
  }
}

