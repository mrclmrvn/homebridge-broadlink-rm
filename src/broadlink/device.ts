import * as dgram from 'dgram';
import {
  BROADLINK_PORT,
  INIT_KEY,
  INIT_IV,
  PACKET_HEADER_MAGIC,
  PacketCommand,
  getDeviceInfo,
  DeviceTypeInfo,
} from './constants';
import {
  calculateChecksum,
  encryptPayload,
  decryptPayload,
  macStringToBuffer,
  macBufferToString,
} from './crypto';

export class BroadlinkDevice {
  public readonly host: string;
  public readonly port: number;
  public readonly mac: Buffer;
  public readonly macAddress: string;
  public readonly devType: number;
  public readonly typeInfo: DeviceTypeInfo;

  protected key: Buffer = Buffer.from(INIT_KEY);
  protected iv: Buffer = Buffer.from(INIT_IV);
  protected id: number = 0;
  protected count: number = Math.floor(Math.random() * 0xffff);
  protected socket: dgram.Socket;
  protected isAuthenticated: boolean = false;
  private queue: Promise<any> = Promise.resolve();

  constructor(host: string, mac: string | Buffer, devType: number = 0x520b, port: number = BROADLINK_PORT) {
    this.host = host;
    this.port = port;
    this.mac = typeof mac === 'string' ? macStringToBuffer(mac) : mac;
    this.macAddress = macBufferToString(this.mac);
    this.devType = devType;
    this.typeInfo = getDeviceInfo(devType);

    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.bind(0);
  }

  /**
   * Serialize commands so only one UDP packet is in flight at a time to this device
   */
  public synchronized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * Send a raw Broadlink packet and wait for decrypted response
   */
  public async sendPacket(packetType: number, payload: Buffer, timeoutMs: number = 5000): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      this.count = ((this.count + 1) | 0x8000) & 0xffff;

      const pChecksum = calculateChecksum(payload);
      const encryptedPayload = encryptPayload(this.key, this.iv, payload);

      const packet = Buffer.alloc(0x38 + encryptedPayload.length);
      PACKET_HEADER_MAGIC.copy(packet, 0x00);

      packet.writeUInt16LE(this.devType, 0x24);
      packet.writeUInt16LE(packetType, 0x26);
      packet.writeUInt16LE(this.count, 0x28);

      // MAC reversed: byte 5 down to 0
      for (let i = 0; i < 6; i++) {
        packet[0x2a + i] = this.mac[5 - i];
      }

      packet.writeUInt32LE(this.id, 0x30);
      packet.writeUInt16LE(pChecksum, 0x34);

      encryptedPayload.copy(packet, 0x38);

      packet.writeUInt16LE(0, 0x20);
      const fullChecksum = calculateChecksum(packet);
      packet.writeUInt16LE(fullChecksum, 0x20);

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timeout waiting for response from ${this.host} (${this.macAddress}) for command 0x${packetType.toString(16)}`,
          ),
        );
      }, timeoutMs);

      const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        if (rinfo.address !== this.host) return;
        cleanup();

        const errCode = msg.readUInt16LE(0x22);
        if (errCode !== 0) {
          const signedErr = -(0x10000 - errCode);
          return reject(
            new Error(
              `Device ${this.host} returned error code: 0x${errCode.toString(16)} (${signedErr}). Check device lock or key status.`,
            ),
          );
        }

        const encryptedResp = msg.slice(0x38);
        if (encryptedResp.length > 0) {
          try {
            const decrypted = decryptPayload(this.key, this.iv, encryptedResp);
            resolve(decrypted);
          } catch (err: any) {
            reject(new Error(`Failed to decrypt response from ${this.host}: ${err.message}`));
          }
        } else {
          resolve(Buffer.alloc(0));
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeListener('message', onMessage);
      };

      this.socket.on('message', onMessage);
      this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Authenticate with the Broadlink device to establish session keys
   */
  public async auth(): Promise<boolean> {
    return this.synchronized(async () => {
      this.id = 0;
      this.key = Buffer.from(INIT_KEY);
      this.iv = Buffer.from(INIT_IV);

      const payload = Buffer.alloc(0x50, 0);
      for (let i = 0x04; i < 0x14; i++) {
        payload[i] = 0x31;
      }
      payload[0x1e] = 0x01;
      payload[0x2d] = 0x01;
      payload.write('Homebridge', 0x30, 'ascii');

      const response = await this.sendPacket(PacketCommand.AUTH, payload);

      this.id = response.readUInt32LE(0x00);
      this.iv = Buffer.from(response.slice(0x04, 0x14));
      this.key = Buffer.from(response.slice(0x14, 0x24));
      this.isAuthenticated = true;

      return true;
    });
  }

  /**
   * Close the UDP socket
   */
  public close(): void {
    try {
      this.socket.close();
    } catch {
      // ignore
    }
  }
}

