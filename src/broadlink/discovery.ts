import * as dgram from 'dgram';
import * as os from 'os';
import { BROADLINK_PORT, PacketCommand } from './constants';
import { RMDevice } from './rmDevice';
import { macBufferToString } from './crypto';

export interface DiscoveredDeviceInfo {
  host: string;
  port: number;
  mac: Buffer;
  macAddress: string;
  devType: number;
  device: RMDevice;
}

export function getLocalBroadcastAddresses(): string[] {
  const broadcasts: string[] = ['255.255.255.255'];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Compute broadcast address if netmask available
        const ipParts = iface.address.split('.').map(Number);
        const maskParts = iface.netmask.split('.').map(Number);
        if (ipParts.length === 4 && maskParts.length === 4) {
          const broadcastParts = ipParts.map((part, i) => (part | (~maskParts[i] & 255)) >>> 0);
          broadcasts.push(broadcastParts.join('.'));
        }
      }
    }
  }

  return Array.from(new Set(broadcasts));
}

/**
 * Discover Broadlink devices on the local network
 * @param timeoutMs Maximum duration to listen for discovery responses
 */
export async function discoverDevices(timeoutMs: number = 3000): Promise<DiscoveredDeviceInfo[]> {
  return new Promise((resolve) => {
    const discovered = new Map<string, DiscoveredDeviceInfo>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      try {
        if (msg.length < 0x40) return;

        // DevType at offset 0x34 (uint16 LE)
        const devType = msg.readUInt16LE(0x34);

        // MAC at offset 0x3a..0x40 (stored in reversed order)
        const mac = Buffer.alloc(6);
        for (let i = 0; i < 6; i++) {
          mac[i] = msg[0x3a + (5 - i)];
        }
        const macAddress = macBufferToString(mac);

        if (!discovered.has(macAddress)) {
          const device = new RMDevice(rinfo.address, mac, devType, rinfo.port || BROADLINK_PORT);
          discovered.set(macAddress, {
            host: rinfo.address,
            port: rinfo.port || BROADLINK_PORT,
            mac,
            macAddress,
            devType,
            device,
          });
        }
      } catch {
        // ignore malformed packets
      }
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);

      const packet = Buffer.alloc(0x30, 0);
      packet[0x26] = PacketCommand.DISCOVER;

      const broadcastAddresses = getLocalBroadcastAddresses();
      for (const target of broadcastAddresses) {
        socket.send(packet, 0, packet.length, BROADLINK_PORT, target, () => {});
      }
    });

    setTimeout(() => {
      try {
        socket.close();
      } catch {}
      resolve(Array.from(discovered.values()));
    }, timeoutMs);
  });
}

