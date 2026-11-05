import * as dgram from 'dgram';
import * as os from 'os';
import { isIPv4 } from 'node:net';
import { BROADLINK_PORT, PacketCommand } from './constants';
import { calculateChecksum, macBufferToString } from './crypto';
import { RMDevice } from './rmDevice';

export interface DiscoveredDeviceInfo {
  host: string; port: number; mac: Buffer; macAddress: string; devType: number; device: RMDevice;
}

function interfaces(): { address: string; broadcast: string }[] {
  return Object.values(os.networkInterfaces()).flatMap(list => (list || []).flatMap(iface => {
    if (iface.family !== 'IPv4' || iface.internal || !isIPv4(iface.address) || !isIPv4(iface.netmask)) return [];
    const mask = iface.netmask.split('.').map(Number);
    const broadcast = iface.address.split('.').map((part, index) => Number(part) | (~mask[index] & 255)).join('.');
    return [{ address: iface.address, broadcast }];
  }));
}

export function getLocalBroadcastAddresses(): string[] {
  return [...new Set(['255.255.255.255', ...interfaces().map(iface => iface.broadcast)])];
}

export function buildDiscoveryPacket(localAddress: string, port: number, date = new Date()): Buffer {
  if (!isIPv4(localAddress) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid discovery endpoint');
  const packet = Buffer.alloc(0x30);
  packet.writeInt32LE(Math.trunc(-date.getTimezoneOffset() / 60), 8);
  packet.writeUInt16LE(date.getFullYear(), 0x0c);
  packet[0x0e] = date.getMinutes(); packet[0x0f] = date.getHours();
  packet[0x10] = date.getFullYear() % 100; packet[0x11] = date.getDay() || 7;
  packet[0x12] = date.getDate(); packet[0x13] = date.getMonth() + 1;
  Buffer.from(localAddress.split('.').map(Number).reverse()).copy(packet, 0x18);
  packet.writeUInt16LE(port, 0x1c);
  packet[0x26] = PacketCommand.DISCOVER;
  packet.writeUInt16LE(calculateChecksum(packet), 0x20);
  return packet;
}

export async function discoverDevices(timeoutMs = 3000, signal?: AbortSignal): Promise<DiscoveredDeviceInfo[]> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('Invalid discovery timeout');
  if (signal?.aborted) throw new Error('Discovery aborted');
  return new Promise((resolve, reject) => {
    const found = new Map<string, DiscoveredDeviceInfo>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      try { socket.close(); } catch { /* Failed or already closed. */ }
      if (error) { for (const item of found.values()) item.device.close(); reject(error); }
      else resolve([...found.values()]);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    const aborted = () => finish(new Error('Discovery aborted'));
    signal?.addEventListener('abort', aborted, { once: true });
    socket.on('error', error => finish(error));
    socket.on('message', (message, remote) => {
      if (finished || message.length < 0x40) return;
      try {
        const devType = message.readUInt16LE(0x34);
        const mac = Buffer.from(message.subarray(0x3a, 0x40)).reverse();
        const macAddress = macBufferToString(mac);
        if (!found.has(macAddress)) {
          const device = new RMDevice(remote.address, mac, devType, remote.port || BROADLINK_PORT);
          found.set(macAddress, { host: remote.address, port: remote.port || BROADLINK_PORT, mac, macAddress, devType, device });
        }
      } catch { /* Ignore malformed datagrams. */ }
    });
    try { socket.bind(0, () => {
      if (finished) return;
      try {
        socket.setBroadcast(true);
        const port = socket.address().port;
        const local = interfaces();
        const targets = [{ address: local[0]?.address || '0.0.0.0', broadcast: '255.255.255.255' }, ...local];
        const sent = new Set<string>();
        for (const target of targets) {
          if (sent.has(target.broadcast)) continue;
          sent.add(target.broadcast);
          const packet = buildDiscoveryPacket(target.address, port);
          socket.send(packet, 0, packet.length, BROADLINK_PORT, target.broadcast, error => { if (error) finish(error); });
        }
      } catch (error) { finish(error as Error); }
    }); } catch (error) { finish(error as Error); }
  });
}
