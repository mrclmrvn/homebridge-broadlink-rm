const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const { spawnSync } = require('node:child_process');
const { calculateChecksum, encryptPayload, decryptPayload, macStringToBuffer } = require('../../dist/broadlink/crypto');
const { INIT_KEY, INIT_IV } = require('../../dist/broadlink/constants');
const { RMDevice } = require('../../dist/broadlink/rmDevice');
const { BroadlinkError } = require('../../dist/broadlink/device');
const { convertProntoCode } = require('../../dist/helpers/convertProntoCode');
const checksum = data => [...data].reduce((sum, byte) => (sum + byte) & 65535, 0xbeaf);
const sessionKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const remote = { address: '192.0.2.10', port: 80 };

function encrypted(payload, key = INIT_KEY) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, INIT_IV);
  cipher.setAutoPadding(false);
  const padded = Buffer.alloc(Math.ceil(payload.length / 16) * 16);
  payload.copy(padded);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}
function response(request, payload = Buffer.alloc(0), key = INIT_KEY, error = 0) {
  const packet = Buffer.alloc(56 + encrypted(payload, key).length);
  Buffer.from('5aa5aa555aa5aa55', 'hex').copy(packet);
  packet.writeUInt16LE(request.readUInt16LE(0x26) === 0x65 ? 0xe9 : 0xee, 0x26);
  packet.writeUInt16LE(request.readUInt16LE(0x28), 0x28);
  packet.writeUInt16LE(error, 0x22);
  packet.writeUInt16LE(checksum(payload), 0x34);
  encrypted(payload, key).copy(packet, 56);
  packet.writeUInt16LE(checksum(packet), 0x20);
  return packet;
}
function inner(command, body = Buffer.alloc(0), rm4 = true) {
  const packet = Buffer.alloc((rm4 ? 6 : 4) + body.length);
  if (rm4) packet.writeUInt16LE(body.length + 4);
  packet.writeUInt32LE(command, rm4 ? 2 : 0);
  body.copy(packet, rm4 ? 6 : 4);
  return packet;
}
function fixture(t, type = 0x520b) {
  const sockets = [];
  class Socket extends EventEmitter {
    packets = [];
    bind() { queueMicrotask(() => this.emit('listening')); }
    send(packet, offset, length, port, host, callback) {
      this.packets.push(Buffer.from(packet));
      callback?.(null);
      this.onSend?.(packet);
    }
    close() { this.emit('close'); }
  }
  t.mock.method(dgram, 'createSocket', () => { const socket = new Socket(); sockets.push(socket); return socket; });
  const device = new RMDevice(remote.address, '01:02:03:04:05:06', type);
  const socket = sockets[0];
  t.after(() => device.close());
  socket.onSend = request => {
    if (request.readUInt16LE(0x26) === 0x65) {
      const auth = Buffer.alloc(20); auth.writeUInt32LE(0x12345678); sessionKey.copy(auth, 4);
      socket.emit('message', response(request, auth), remote);
    } else socket.emit('message', response(request, inner(2, undefined, type >= 0x5000), sessionKey), remote);
  };
  return { socket, device };
}

test('native sensor deadline cancels lost authentication or sensor packets and leaves the device usable', async t => {
  for (const stage of ['authentication', 'sensor']) await t.test(stage, async t => {
    const { SensorSource } = require('../../dist/accessories/sensorSource');
    const { socket, device } = fixture(t);
    if (stage === 'sensor') await device.auth();
    const timers = new Map();
    t.mock.method(global, 'setTimeout', (callback, delay) => {
      const handle = {}; timers.set(handle, { callback, delay }); return handle;
    });
    t.mock.method(global, 'clearTimeout', handle => timers.delete(handle));
    socket.onSend = () => {}; // Drop the response at the selected protocol stage.
    const source = new SensorSource({}, () => device); t.after(() => source.dispose());
    const lost = assert.rejects(source.read('temperature'), /Sensor read timed out/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(socket.listenerCount('message'), 1);
    [...timers.values()].find(timer => timer.delay === 2000).callback();
    await lost; await new Promise(resolve => setImmediate(resolve));
    assert.equal(socket.listenerCount('message'), 0);
    assert.equal(timers.size, 0);
    socket.onSend = request => {
      if (request.readUInt16LE(0x26) === 0x65) {
        const auth = Buffer.alloc(20); sessionKey.copy(auth, 4);
        socket.emit('message', response(request, auth), remote);
      } else socket.emit('message', response(request, inner(0x24, Buffer.from([23, 50, 45, 0])), sessionKey), remote);
    };
    assert.equal(await source.read('temperature'), 23.5);
    assert.equal(timers.size, 0);
  });
});

test('a sensor read expires while queued and sends no delayed packet when the queue resumes', async t => {
  const { SensorSource } = require('../../dist/accessories/sensorSource');
  const { socket, device } = fixture(t);
  await device.auth();
  let release;
  const blocking = device.synchronized(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  let deadline;
  t.mock.method(global, 'setTimeout', (callback, delay) => { assert.equal(delay, 2000); deadline = callback; return {}; });
  t.mock.method(global, 'clearTimeout', () => {});
  const source = new SensorSource({}, () => device); t.after(() => source.dispose());
  const lost = assert.rejects(source.read('temperature'), /Sensor read timed out/);
  deadline(); await lost;
  release(); await blocking; await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.packets.length, 1); // Authentication only; expired read never sent.
});

test('AES uses the NIST CBC vector and zero padding without an extra aligned block', () => {
  const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
  const iv = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
  assert.equal(encryptPayload(key, iv, plain).toString('hex'), '7649abac8119b246cee98e9b12e9197d');
  assert.equal(encryptPayload(key, iv, Buffer.from([1])).length, 16);
  const padded = decryptPayload(key, iv, encryptPayload(key, iv, Buffer.from([1])));
  assert.deepEqual(padded, Buffer.concat([Buffer.from([1]), Buffer.alloc(15)]));
  assert.equal(calculateChecksum(Buffer.alloc(0)), 0xbeaf);
  assert.equal(calculateChecksum(Buffer.from([255, 1]), 0xff00), 0);
  assert.throws(() => macStringToBuffer('not-a-mac-010203040506'), /Invalid MAC/);
});

test('send authenticates once without deadlock, uses the session key and correct headers', async t => {
  const { socket, device } = fixture(t);
  await device.sendData('260002000102');
  assert.equal(socket.packets.length, 2);
  const [auth, send] = socket.packets;
  assert.equal(auth.length, 56 + 80);
  assert.equal(send.readUInt16LE(0x24), 0x520b);
  assert.equal(send.readUInt16LE(0x26), 0x6a);
  assert.equal(send.readUInt32LE(0x30), 0x12345678);
  assert.equal(send.subarray(0x2a, 0x30).toString('hex'), '060504030201');
  assert.deepEqual(decryptPayload(sessionKey, INIT_IV, send.subarray(56)).subarray(0, 12), inner(2, Buffer.from('260002000102', 'hex')));
  await device.sendData('260002000102');
  assert.equal(socket.packets.filter(packet => packet.readUInt16LE(0x26) === 0x65).length, 1);
});

test('RM4 0x653a accepts authentication and sensor replies with a nonzero byte at 0x27', async t => {
  for (const opcode of [0xee, 0xef]) await t.test(`command 0x03${opcode.toString(16)}`, async t => {
    const { socket, device } = fixture(t, 0x653a);
    socket.onSend = request => {
      const authenticating = request.readUInt16LE(0x26) === 0x65;
      const auth = Buffer.alloc(20); auth.writeUInt32LE(0x12345678); sessionKey.copy(auth, 4);
      const reply = response(request, authenticating ? auth : inner(0x24, Buffer.from([24, 50, 55, 25])),
        authenticating ? INIT_KEY : sessionKey);
      reply.writeUInt16LE(0x0300 | (authenticating ? 0xe9 : opcode), 0x26);
      reply.writeUInt16LE(0, 0x20);
      reply.writeUInt16LE(checksum(reply), 0x20);
      socket.emit('message', reply, remote);
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);
    try {
      assert.equal(await device.auth(controller.signal), true);
      assert.deepEqual(await device.checkSensors(controller.signal), { temperature: 24.5, humidity: 55.25 });
      assert.equal(socket.packets.length, 2);
    } finally { clearTimeout(timeout); }
    socket.onSend = request => {
      const reply = response(request, inner(0x24, Buffer.from([24, 50, 55, 25])), sessionKey);
      reply[0x27] = 3; // Header remains covered by the packet checksum.
      socket.emit('message', reply, remote);
    };
    await assert.rejects(device.checkSensors(), /checksum mismatch/);
  });
});

test('packet request ignores unrelated, short and stale packets; validates checksums', async t => {
  const { socket, device } = fixture(t);
  await device.auth();
  socket.onSend = request => {
    socket.emit('message', Buffer.alloc(2), remote);
    socket.emit('message', response(request, inner(2), sessionKey), { ...remote, address: '192.0.2.11' });
    const stale = Buffer.from(request); stale.writeUInt16LE(request.readUInt16LE(0x28) - 1, 0x28);
    socket.emit('message', response(stale, inner(2), sessionKey), remote);
    socket.emit('message', response(request, inner(2), sessionKey), remote);
  };
  await device.sendData('260002000102');
  socket.onSend = request => {
    const packet = response(request, inner(2), sessionKey); packet[packet.length - 1] ^= 1;
    socket.emit('message', packet, remote);
  };
  await assert.rejects(device.sendData('260002000102'), /checksum mismatch/);
  assert.equal(socket.listenerCount('message'), 0);
});

test('typed authorization errors are not swallowed and invalidate the session', async t => {
  const { socket, device } = fixture(t);
  await device.auth();
  socket.onSend = request => socket.emit('message', response(request, undefined, sessionKey, 0xfff9), remote);
  await assert.rejects(device.checkData(), error => error instanceof BroadlinkError && error.signedCode === -7);
  assert.equal(device.isAuthenticated, false);
  assert.equal(socket.listenerCount('message'), 0);
});

test('socket errors and close reject outstanding commands and prevent queued sends', async t => {
  const { socket, device } = fixture(t);
  await device.auth();
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  socket.onSend = () => started();
  const first = device.sendData('260002000102');
  const second = device.sendData('260002000102');
  await sending;
  device.close();
  await assert.rejects(first, /closed/);
  await assert.rejects(second, /closed/);
  assert.equal(socket.listenerCount('message'), 0);
  assert.equal(socket.packets.length, 2);
});

test('RM sensor commands and signed decimal readings match legacy and RM4 layouts', async t => {
  const { socket, device } = fixture(t, 0x520c);
  await device.auth();
  socket.onSend = request => {
    const command = decryptPayload(sessionKey, INIT_IV, request.subarray(56)).readUInt32LE(2);
    assert.equal(command, 0x24);
    socket.emit('message', response(request, inner(command, Buffer.from([0xff, 0xce, 55, 25])), sessionKey), remote);
  };
  assert.deepEqual(await device.checkSensors(), { temperature: -1.5, humidity: 55.25 });
  const legacy = new RMDevice(remote.address, '01:02:03:04:05:06', 0x2712);
  t.after(() => legacy.close());
  legacy.isAuthenticated = true;
  legacy.sendPacket = async (command, payload) => {
    assert.equal(payload.readUInt32LE(0), 1);
    return inner(1, Buffer.from([20, 5]), false);
  };
  assert.deepEqual(await legacy.checkSensors(), { temperature: 20.5 });
});

test('RM4 sensor reads accept the alternate 0xef command response used by legacy-supported firmware', async t => {
  const { socket, device } = fixture(t);
  await device.auth();
  socket.onSend = request => {
    const unrelated = response(request, inner(0x24, Buffer.from([99, 0, 99, 0])), sessionKey);
    unrelated.writeUInt16LE(0x72, 0x26);
    unrelated.writeUInt16LE(0, 0x20);
    unrelated.writeUInt16LE(checksum(unrelated), 0x20);
    socket.emit('message', unrelated, remote);
    const reply = response(request, inner(0x24, Buffer.from([24, 50, 55, 25])), sessionKey);
    reply.writeUInt16LE(0xef, 0x26);
    reply.writeUInt16LE(0, 0x20);
    reply.writeUInt16LE(checksum(reply), 0x20);
    socket.emit('message', reply, remote);
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100);
  try { assert.deepEqual(await device.checkSensors(controller.signal), { temperature: 24.5, humidity: 55.25 }); }
  finally { clearTimeout(timeout); }
  socket.onSend = request => {
    const reply = response(request, inner(0x24, Buffer.from([24, 50, 55, 25])), sessionKey);
    reply.writeUInt16LE(0xef, 0x26); // Deliberately leave the old checksum.
    socket.emit('message', reply, remote);
  };
  await assert.rejects(device.checkSensors(), /checksum mismatch/);
});

test('RF learning performs sweep, frequency check, packet capture and cancellation', async t => {
  const { device } = fixture(t);
  device.isAuthenticated = true;
  const commands = [];
  device.pause = async () => {};
  device.sendPacket = async (packetType, payload) => {
    const command = payload.readUInt32LE(2); commands.push(command);
    if (command === 0x1a) return inner(command, Buffer.from([1, 0, 0, 0, 0]));
    if (command === 4) return inner(command, Buffer.from('b20002000102', 'hex'));
    return inner(command);
  };
  const progress = [];
  assert.equal(await device.learnRFData({ onProgress: stage => progress.push(stage) }), 'b20002000102');
  assert.deepEqual(commands, [0x19, 0x1a, 0x1b, 4, 0x1e]);
  assert.deepEqual(progress, ['frequency', 'packet']);
});

test('learning is cancellable and an IR-only device rejects RF before sending', async t => {
  const { device } = fixture(t, 0x520c);
  await assert.rejects(device.learnRFData(), /not supported/);
  device.isAuthenticated = true;
  device.sendPacket = async () => inner(3);
  const controller = new AbortController();
  const learning = device.learnData(30000, 1000, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(learning, /aborted/);
  assert.equal(device.learning, false);
});

test('Pronto conversion handles extended pulses, little-endian lengths and malformed input', () => {
  const short = convertProntoCode('0000 006d 0001 0000 0010 0100');
  assert.equal(short.slice(0, 8), '26000200');
  assert.equal((Buffer.from(short, 'hex').length + 4) % 16, 0);
  const long = convertProntoCode('0000 006d 0001 0000 0010 1000');
  assert.equal(long.slice(0, 8), '26000400');
  const many = convertProntoCode(`0000 006d 0080 0000 ${Array(256).fill('0010').join(' ')}`);
  assert.equal(many.slice(4, 8), '0001');
  assert.throws(() => convertProntoCode('0000 0000 0001 0000 0010 0010'), /frequency/);
  assert.throws(() => convertProntoCode('0100 006d 0001 0000 0010 0010'), /Only raw/);
  assert.throws(() => convertProntoCode('0000 006d 0002 0000 0010 0010'), /burst count/);
});

test('CLI rejects invalid commands and device IDs with nonzero status without opening a socket', () => {
  for (const args of [['unknown'], ['auth'], ['auth', remote.address, '01:02:03:04:05:06', 'nope'], ['convert-pronto', 'invalid']]) {
    const child = spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
    assert.equal(child.status, 1, child.stdout + child.stderr);
  }
});

test('malformed authentication and invalid input fail before state or commands are committed', async t => {
  const { socket, device } = fixture(t);
  socket.onSend = request => socket.emit('message', response(request, Buffer.alloc(4)), remote);
  await assert.rejects(device.auth(), /Truncated/);
  assert.equal(device.isAuthenticated, false);
  const count = socket.packets.length;
  for (const code of ['', 'abc', '26zz00']) await assert.rejects(device.sendData(code), /hexadecimal|empty/);
  assert.equal(socket.packets.length, count);
});

test('timeouts, packet aborts and socket errors clean up listeners and recover the queue', async t => {
  const { socket, device } = fixture(t);
  await device.auth();
  socket.onSend = () => {};
  let timeout;
  t.mock.method(global, 'setTimeout', callback => { timeout = callback; return {}; });
  t.mock.method(global, 'clearTimeout', () => {});
  const request = device.sendPacket(0x6a, inner(2));
  await new Promise(resolve => setImmediate(resolve));
  timeout();
  await assert.rejects(request, /Timeout/);
  assert.equal(socket.listenerCount('message'), 0);
  const controller = new AbortController();
  const aborting = device.sendPacket(0x6a, inner(2), 5000, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(aborting, /aborted/);
  const failing = device.sendPacket(0x6a, inner(2));
  await new Promise(resolve => setImmediate(resolve));
  socket.emit('error', new Error('socket failure'));
  await assert.rejects(failing, /socket failure/);
  assert.equal(socket.listenerCount('message'), 0);
});

test('RF sweep timeout and abort cancel sweep without hiding the original error', async t => {
  const { device } = fixture(t);
  device.isAuthenticated = true;
  const commands = [];
  let time = 0;
  const { performance } = require('node:perf_hooks');
  t.mock.method(performance, 'now', () => time);
  device.pause = async ms => { time += ms; };
  device.sendPacket = async (packetType, payload) => {
    const command = payload.readUInt32LE(2); commands.push(command);
    return inner(command, command === 0x1a ? Buffer.from([0]) : undefined);
  };
  await assert.rejects(device.learnRFData({ timeoutMs: 100, intervalMs: 50 }), /sweep timed out/);
  assert.equal(commands.at(-1), 0x1e);
  const controller = new AbortController();
  device.pause = async () => { controller.abort(); throw new Error('Learning aborted'); };
  await assert.rejects(device.learnRFData({ signal: controller.signal }), /aborted/);
  assert.equal(commands.at(-1), 0x1e);
  assert.equal(device.learning, false);
});

test('discovery fills endpoint/checksum fields and rejects socket errors without timers leaking', async t => {
  const { buildDiscoveryPacket, discoverDevices } = require('../../dist/broadlink/discovery');
  const packet = buildDiscoveryPacket('192.0.2.10', 12345, new Date('2026-11-05T00:00:00Z'));
  assert.equal(packet.subarray(0x18, 0x1c).toString('hex'), '0a0200c0');
  assert.equal(packet.readUInt16LE(0x1c), 12345);
  const stored = packet.readUInt16LE(0x20); packet.writeUInt16LE(0, 0x20);
  assert.equal(checksum(packet), stored);
  const { socket } = fixture(t);
  let closed = false;
  socket.bind = () => { queueMicrotask(() => socket.emit('error', new Error('bind failed'))); };
  socket.close = () => { closed = true; };
  t.mock.method(dgram, 'createSocket', () => socket);
  await assert.rejects(discoverDevices(), /bind failed/);
  assert.equal(closed, true);
});

test('device manager closes duplicate sockets, refreshes addresses and accepts exact static IDs', async t => {
  const { DeviceManager } = require('../../dist/deviceManager');
  const manager = new DeviceManager({ info() {}, warn() {} });
  const make = (host, devType = 0x520c) => ({ host, devType, port: 80, macAddress: '01:02:03:04:05:06', closed: false,
    close() { this.closed = true; } });
  const first = make('192.0.2.10'); const duplicate = make(first.host); const moved = make('192.0.2.11', 0x520b);
  manager.registerDevice(first); manager.registerDevice(duplicate); manager.registerDevice(moved);
  assert.equal(first.closed, true); assert.equal(duplicate.closed, true);
  assert.equal(manager.getDevice('192.0.2.10'), undefined);
  assert.equal(manager.getDevice('010203040506'), moved);
  manager.closeAll(); assert.equal(moved.closed, true);
  fixture(t);
  const nextManager = new DeviceManager({ info() {}, warn() {} });
  t.after(() => nextManager.closeAll());
  await nextManager.initHosts([{ address: remote.address, mac: '01:02:03:04:05:06', devType: '0x2712' }]);
  assert.equal(nextManager.getDevice().devType, 0x2712);
  assert.equal(nextManager.getDevice().typeInfo.isRM4, false);
});

test('discovery deduplicates valid responses and returns canonical MACs with owned sockets', async t => {
  const os = require('node:os');
  const { discoverDevices } = require('../../dist/broadlink/discovery');
  t.mock.method(os, 'networkInterfaces', () => ({ eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.5', netmask: '255.255.255.0' }] }));
  let finish;
  t.mock.method(global, 'setTimeout', callback => { finish = callback; return {}; });
  t.mock.method(global, 'clearTimeout', () => {});
  const sockets = [];
  class Socket extends EventEmitter {
    closed = false;
    bind(port, callback) { queueMicrotask(() => { this.emit('listening'); callback?.(); }); }
    address() { return { address: '0.0.0.0', port: 12345 }; }
    setBroadcast() {}
    send(packet, offset, length, port, host, callback) {
      assert.equal(packet.readUInt16LE(0x1c), 12345);
      const reply = Buffer.alloc(64); reply.writeUInt16LE(0x520b, 0x34);
      Buffer.from('060504030201', 'hex').copy(reply, 0x3a);
      this.emit('message', Buffer.alloc(1), remote);
      this.emit('message', reply, remote);
      this.emit('message', reply, remote);
      callback?.(null);
    }
    close() { this.closed = true; this.emit('close'); }
  }
  t.mock.method(dgram, 'createSocket', () => { const socket = new Socket(); sockets.push(socket); return socket; });
  const discovering = discoverDevices();
  await new Promise(resolve => setImmediate(resolve));
  finish();
  const devices = await discovering;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].macAddress, '01:02:03:04:05:06');
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].closed, true);
  devices[0].device.close();
  assert.equal(sockets[1].closed, true);
});

test('learning accessory acknowledges On promptly and aborts on Off and shutdown', async t => {
  const { fixture: accessoryFixture } = require('./helpers/timedFixture');
  const f = accessoryFixture(t, 'learn-rf');
  let signal;
  let calls = 0;
  f.device.learnRFData = async options => {
    calls++;
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  };
  await f.set('On', true);
  assert.equal(f.get('On'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  await f.set('On', false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true);
  assert.equal(f.get('On'), false);
  await f.set('On', true);
  f.instance.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('payload checksum failures and malformed ciphertext fail instead of returning bad data', async t => {
  const { socket, device } = fixture(t);
  await device.auth();
  socket.onSend = request => {
    const packet = response(request, inner(2), sessionKey);
    packet.writeUInt16LE(0, 0x34); packet.writeUInt16LE(0, 0x20); packet.writeUInt16LE(checksum(packet), 0x20);
    socket.emit('message', packet, remote);
  };
  await assert.rejects(device.sendData('260002000102'), /payload checksum mismatch/);
  socket.onSend = request => {
    const packet = response(request, inner(2), sessionKey).subarray(0, 57);
    packet.writeUInt16LE(0, 0x20); packet.writeUInt16LE(checksum(packet), 0x20);
    socket.emit('message', packet, remote);
  };
  await assert.rejects(device.sendData('260002000102'), /encrypted Broadlink response length/);
});
