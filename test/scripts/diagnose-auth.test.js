const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { packetSummary, diagnose } = require('../../scripts/v5-diagnose-auth');

test('packet summaries expose matching fields without authentication payload, session ID or keys', () => {
  const packet = Buffer.alloc(88);
  Buffer.from('5aa5aa555aa5aa55', 'hex').copy(packet);
  packet.writeUInt16LE(0xe9, 0x26);
  packet.writeUInt16LE(123, 0x28);
  packet.write('secret-session-and-key', 0x30);
  packet.writeUInt16LE([...packet].reduce((sum, byte) => (sum + byte) & 65535, 0xbeaf), 0x20);
  const result = packetSummary(packet);
  assert.equal(result.command, '0xe9');
  assert.equal(result.sequence, 123);
  assert.equal(result.checksumValid, true);
  assert.equal(result.magicValid, true);
  assert.deepEqual(Object.keys(result), ['bytes', 'magicValid', 'type', 'command', 'sequence', 'error', 'checksumValid']);
  assert.ok(!JSON.stringify(result).includes('secret'));
  packet[87] ^= 1;
  assert.equal(packetSummary(packet).checksumValid, false);
  assert.deepEqual(packetSummary(Buffer.alloc(2)), { bytes: 2 });
});

test('diagnostic observes received headers on auth failure, restores the socket and closes every device', async () => {
  const socket = new EventEmitter();
  const originalSend = () => {};
  socket.send = originalSend;
  let closed = 0, sensors = 0;
  const device = { socket, close() { closed++; },
    async auth() {
      socket.send(Buffer.alloc(56));
      socket.emit('message', Buffer.alloc(56), { address: '192.0.2.1', port: 80 });
      throw new Error('authentication timeout');
    },
    async checkSensors() { sensors++; },
  };
  const broadlink = { async discoverDevices() { return [
    { host: '192.0.2.1', port: 80, devType: 0x653a, device },
    { host: '192.0.2.2', device: { close() { closed++; } } },
  ]; } };
  const logs = [];
  await assert.rejects(diagnose('192.0.2.1', broadlink, message => logs.push(message)), /authentication timeout/);
  assert.equal(closed, 2);
  assert.equal(sensors, 0);
  assert.equal(socket.send, originalSend);
  assert.equal(socket.listenerCount('message'), 0);
  assert.ok(logs.some(message => message.includes('"direction":"TX"')));
  assert.ok(logs.some(message => message.includes('"direction":"RX"')));
});

test('successful authentication proceeds only to a sensor read and closes the device', async () => {
  const socket = new EventEmitter(); socket.send = () => {};
  const calls = [], logs = [];
  const device = { socket, async auth() { calls.push('auth'); },
    async checkSensors() { calls.push('sensors'); return { temperature: 24, humidity: 55 }; },
    close() { calls.push('close'); },
  };
  await diagnose('192.0.2.1', { async discoverDevices() {
    return [{ host: '192.0.2.1', port: 80, devType: 0x653a, device }];
  } }, message => logs.push(message));
  assert.deepEqual(calls, ['auth', 'sensors', 'close']);
  assert.ok(logs.includes('{"temperature":24,"humidity":55}'));
});
