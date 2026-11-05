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
  private closed = false;
  private readonly shutdown = new AbortController();
  private discovering?: Promise<void>;
  private rediscoveryTimer?: NodeJS.Timeout;
  private rediscoveryGeneration = 0;

  constructor(log: Logging) {
    this.log = log;
  }

  private normalizeMac(mac: string): string {
    return mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  }

  public registerDevice(device: RMDevice): void {
    if (this.closed) { device.close(); return; }
    const ip = device.host;
    if (ip.startsWith('169.254.')) {
      this.log.warn(`[DeviceManager] Device ${device.macAddress} has link-local address ${ip}; check DHCP/network configuration and power-cycle it after fixing its address.`);
      device.close();
      return;
    }
    const macKey = this.normalizeMac(device.macAddress);

    const existing = this.devicesByMac.get(macKey);
    if (existing === device) return;
    if (existing) {
      if (existing.isUsable !== false && existing.host === device.host && existing.devType === device.devType && existing.port === device.port) {
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
    if (this.closed) return;
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

  public discover(timeoutMs: number = 3000): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.discovering) return this.discovering;
    this.discovering = (async () => {
      try {
        const discovered = await discoverDevices(timeoutMs, this.shutdown.signal);
        for (const item of discovered) this.registerDevice(item.device);
      } catch (error) {
        if (!this.closed) this.log.error(`[DeviceManager] Discovery error: ${error instanceof Error ? error.message : error}`);
      }
    })().finally(() => { this.discovering = undefined; });
    return this.discovering;
  }

  /** Schedule the next sweep after completion, avoiding overlapping broadcasts. */
  public startRediscovery(minutes: unknown = 60): void {
    const generation = ++this.rediscoveryGeneration;
    clearTimeout(this.rediscoveryTimer);
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes * 60000 > 2147483647) {
      this.log.warn('[DeviceManager] Invalid rediscoveryInterval; use nonnegative minutes within the Node.js timer range. Scheduled discovery is disabled.');
      return;
    }
    if (this.closed || minutes === 0) return;
    const schedule = () => {
      if (this.closed || generation !== this.rediscoveryGeneration) return;
      this.rediscoveryTimer = setTimeout(() => {
        void this.discover().finally(schedule);
      }, minutes * 60000);
      this.rediscoveryTimer.unref();
    };
    schedule();
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
    this.closed = true;
    clearTimeout(this.rediscoveryTimer);
    this.shutdown.abort();
    for (const dev of this.allDevices) {
      dev.close();
    }
    this.devicesByIp.clear();
    this.devicesByMac.clear();
    this.allDevices = [];
  }
}

