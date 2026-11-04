import { Logging } from 'homebridge';
import { RMDevice, discoverDevices, getDeviceInfo } from './broadlink';

export interface HostConfig {
  address: string;
  mac: string;
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

    if (this.devicesByMac.has(macKey)) {
      return;
    }

    this.devicesByIp.set(ip, device);
    this.devicesByMac.set(macKey, device);
    this.allDevices.push(device);

    const info = getDeviceInfo(device.devType);
    this.log.info(`[DeviceManager] Registered ${info.name} at ${ip} (${device.macAddress})`);
  }

  public async initHosts(hosts?: HostConfig[]): Promise<void> {
    if (hosts && Array.isArray(hosts) && hosts.length > 0) {
      for (const host of hosts) {
        if (!host.address || !host.mac) {
          this.log.warn(`[DeviceManager] Skipping invalid host config: ${JSON.stringify(host)}`);
          continue;
        }

        // Determine devType
        let devType = 0x2221;
        if (host.isRFSupported) devType |= 0x02;
        if (host.isRM4) devType |= 0x04;
        // RM4 Pro real devType 0x520b
        if (devType === 0x2227 || (host.isRM4 && host.isRFSupported)) {
          devType = 0x520b;
        } else if (host.isRM4) {
          devType = 0x520c;
        }

        const device = new RMDevice(host.address, host.mac, devType);
        this.registerDevice(device);
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
