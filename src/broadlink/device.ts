import * as dgram from 'dgram';
import { isIPv4 } from 'node:net';
import { BROADLINK_PORT, INIT_KEY, INIT_IV, PACKET_HEADER_MAGIC, PacketCommand, getDeviceInfo, DeviceTypeInfo } from './constants';
import { calculateChecksum, encryptPayload, decryptPayload, macStringToBuffer, macBufferToString } from './crypto';

export class BroadlinkError extends Error {
  public readonly signedCode: number;
  constructor(public readonly code: number, host: string) {
    const signed = code >= 0x8000 ? code - 0x10000 : code;
    super(`Device ${host} returned 0x${code.toString(16)} (${signed})${code === 0xfff9 ? ': control authorization failed; check session key and device lock settings' : ''}`);
    this.name = 'BroadlinkError';
    this.signedCode = signed;
  }
}

export class BroadlinkDevice {
  public readonly mac: Buffer;
  public readonly macAddress: string;
  public readonly typeInfo: DeviceTypeInfo;
  protected key = Buffer.from(INIT_KEY);
  protected iv = Buffer.from(INIT_IV);
  protected id = 0;
  protected count = Math.floor(Math.random() * 0xffff);
  protected readonly socket: dgram.Socket;
  protected isAuthenticated = false;
  protected readonly shutdown = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private packetQueue: Promise<unknown> = Promise.resolve();
  private readonly ready: Promise<void>;
  private socketError?: Error;
  private readonly pending = new Set<(error: Error) => void>();

  constructor(public readonly host: string, mac: string | Buffer, public readonly devType = 0x520b, public readonly port = BROADLINK_PORT) {
    if (!isIPv4(host)) throw new Error('Broadlink host must be an IPv4 address');
    this.mac = typeof mac === 'string' ? macStringToBuffer(mac) : Buffer.from(mac);
    this.macAddress = macBufferToString(this.mac);
    if (!Number.isInteger(devType) || devType < 0 || devType > 0xffff) throw new Error('Invalid Broadlink device type');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Broadlink UDP port');
    this.typeInfo = getDeviceInfo(devType);
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', error => {
      this.socketError = error;
      for (const reject of this.pending) reject(error);
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.socket.removeListener('listening', onReady); this.socket.removeListener('error', onError); this.socket.removeListener('close', onClose); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => onError(new Error('Broadlink device is closed'));
      const onReady = () => { cleanup(); resolve(); };
      this.socket.once('close', onClose);
      this.socket.once('error', onError);
      this.socket.once('listening', onReady);
      this.socket.bind(0);
    });
    // Binding can fail before the first command is submitted.
    void this.ready.catch(() => {});
  }

  public synchronized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { this.assertOpen(); return task(); });
    this.queue = next.catch(() => {});
    return next;
  }

  public get isUsable(): boolean { return !this.socketError && !this.shutdown.signal.aborted; }

  protected assertOpen(): void {
    if (this.shutdown.signal.aborted) throw new Error('Broadlink device is closed');
    if (this.socketError) throw this.socketError;
  }

  /** Called only from inside the command queue; never enqueue auth recursively. */
  protected async ensureAuthenticated(signal?: AbortSignal): Promise<void> {
    if (!this.isAuthenticated) await this.authenticate(signal);
  }

  public sendPacket(packetType: number, payload: Buffer, timeoutMs = 5000, signal?: AbortSignal): Promise<Buffer> {
    const result = this.packetQueue.then(() => this.exchange(packetType, payload, timeoutMs, signal));
    this.packetQueue = result.catch(() => {});
    return result;
  }

  private async exchange(packetType: number, payload: Buffer, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
    this.assertOpen();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('Invalid packet timeout');
    if (signal?.aborted) throw new Error('Broadlink command aborted');
    await this.ready;
    this.assertOpen();
    if (signal?.aborted) throw new Error('Broadlink command aborted');
    const sequence = this.count = ((this.count + 1) | 0x8000) & 0xffff;
    const encrypted = encryptPayload(this.key, this.iv, payload);
    const packet = Buffer.alloc(0x38 + encrypted.length);
    PACKET_HEADER_MAGIC.copy(packet);
    packet.writeUInt16LE(this.devType, 0x24);
    packet.writeUInt16LE(packetType, 0x26);
    packet.writeUInt16LE(sequence, 0x28);
    Buffer.from(this.mac).reverse().copy(packet, 0x2a);
    packet.writeUInt32LE(this.id, 0x30);
    packet.writeUInt16LE(calculateChecksum(payload), 0x34);
    encrypted.copy(packet, 0x38);
    packet.writeUInt16LE(calculateChecksum(packet), 0x20);

    return new Promise<Buffer>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(fail);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => fail(new Error('Broadlink command aborted'));
      const onMessage = (message: Buffer, remote: dgram.RemoteInfo) => {
        // Unrelated, stale, and truncated datagrams must not finish this request.
        if (remote.address !== this.host || remote.port !== this.port || message.length < 0x38) return;
        if (!message.subarray(0, 8).equals(PACKET_HEADER_MAGIC) || message.readUInt16LE(0x28) !== sequence) return;
        // The response opcode is byte 0x26. Real RM4 0x653a firmware replies
        // with a nonzero adjacent byte (e.g. e9 03); it is not part of the
        // opcode. V4 likewise reads only byte 0x26. The full header remains
        // protected by the packet checksum below.
        const responseCommand = message[0x26];
        if (packetType === PacketCommand.AUTH && responseCommand !== 0xe9) return;
        // Firmware supported by the previous driver can answer commands with
        // either response opcode. Keep sender, sequence and integrity checks.
        if (packetType === PacketCommand.COMMAND && responseCommand !== 0xee && responseCommand !== 0xef) return;
        try {
          const checked = Buffer.from(message);
          const checksum = checked.readUInt16LE(0x20);
          checked.writeUInt16LE(0, 0x20);
          if (calculateChecksum(checked) !== checksum) throw new Error('Broadlink response checksum mismatch');
          const code = message.readUInt16LE(0x22);
          if (code) {
            if (code === 0xffff || code === 0xfffe || code === 0xfff9) this.isAuthenticated = false;
            throw new BroadlinkError(code, this.host);
          }
          const ciphertext = message.subarray(0x38);
          if (ciphertext.length % 16) throw new Error('Invalid encrypted Broadlink response length');
          const decoded = decryptPayload(this.key, this.iv, ciphertext);
          if (calculateChecksum(decoded) !== message.readUInt16LE(0x34)) throw new Error('Broadlink payload checksum mismatch');
          settled = true;
          cleanup();
          resolve(decoded);
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
      const phase = packetType === PacketCommand.AUTH ? 'authentication' : 'command';
      timer = setTimeout(() => fail(new Error(`Timeout waiting for ${phase} response from ${this.host} (type 0x${this.devType.toString(16)})`)), timeoutMs);
      this.pending.add(fail);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.on('message', onMessage);
      try {
        this.socket.send(packet, 0, packet.length, this.port, this.host, error => { if (error) fail(error); });
      } catch (error) { fail(error as Error); }
    });
  }

  public auth(signal?: AbortSignal): Promise<boolean> {
    return this.synchronized(() => this.authenticate(signal));
  }

  private async authenticate(signal?: AbortSignal): Promise<boolean> {
    this.isAuthenticated = false;
    this.id = 0;
    this.key = Buffer.from(INIT_KEY);
    this.iv = Buffer.from(INIT_IV);
    const payload = Buffer.alloc(0x50);
    payload.fill(0x31, 4, 0x14);
    payload[0x1e] = 1;
    payload[0x2d] = 1;
    payload.write('Homebridge', 0x30, 'ascii');
    const response = await this.sendPacket(PacketCommand.AUTH, payload, 5000, signal);
    if (response.length < 0x14) throw new Error('Truncated Broadlink authentication response');
    this.id = response.readUInt32LE(0);
    this.key = Buffer.from(response.subarray(4, 0x14));
    // The IV remains the protocol's fixed IV; the response carries ID + key.
    this.isAuthenticated = true;
    return true;
  }

  public close(): void {
    if (this.shutdown.signal.aborted) return;
    this.shutdown.abort();
    for (const reject of this.pending) reject(new Error('Broadlink device is closed'));
    try { this.socket.close(); } catch { /* Already closed or failed to bind. */ }
  }
}
