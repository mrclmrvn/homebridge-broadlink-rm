#!/usr/bin/env node
'use strict';

const { isIPv4 } = require('node:net');
const { performance } = require('node:perf_hooks');
const PLUGIN = '/var/lib/homebridge/node_modules/@mrclmrvn/homebridge-broadlink-rm/dist/broadlink';

// Deliberately never print raw packets, encrypted payloads, session IDs or keys.
function packetSummary(packet) {
  const result = { bytes: packet.length };
  if (packet.length < 0x38) return result;
  const checked = Buffer.from(packet);
  const expected = checked.readUInt16LE(0x20);
  checked.writeUInt16LE(0, 0x20);
  const checksum = [...checked].reduce((sum, byte) => (sum + byte) & 0xffff, 0xbeaf);
  return {
    ...result,
    magicValid: packet.subarray(0, 8).toString('hex') === '5aa5aa555aa5aa55',
    type: '0x' + packet.readUInt16LE(0x24).toString(16),
    command: '0x' + packet.readUInt16LE(0x26).toString(16),
    sequence: packet.readUInt16LE(0x28),
    error: '0x' + packet.readUInt16LE(0x22).toString(16),
    checksumValid: checksum === expected,
  };
}

async function diagnose(host, broadlink, log = console.log) {
  if (!isIPv4(host)) throw new Error('Supply the Main AC Broadlink IPv4 address.');
  const devices = await broadlink.discoverDevices(4000);
  try {
    const found = devices.find(item => item.host === host);
    if (!found) throw new Error('Requested Broadlink did not respond to discovery.');
    const device = found.device;
    log(`Discovered ${found.host}:${found.port}, type 0x${found.devType.toString(16)}`);
    const started = performance.now();
    const trace = (direction, packet, remote) => log(JSON.stringify({
      direction, elapsedMs: Math.round(performance.now() - started),
      ...(remote ? { sender: remote.address, port: remote.port } : {}),
      ...packetSummary(packet),
    }));
    // Observe the installed driver's socket without changing its packets or
    // response filters. This is an external diagnostic, not production code.
    const socket = device.socket;
    const originalSend = socket.send;
    const receive = (packet, remote) => trace('RX', packet, remote);
    socket.on('message', receive);
    socket.send = function (packet, ...args) {
      trace('TX', packet);
      return originalSend.call(this, packet, ...args);
    };
    try {
      log('Testing authentication (no IR commands)...');
      await device.auth();
      log('Authentication succeeded. Testing sensors...');
      log(JSON.stringify(await device.checkSensors()));
    } finally {
      socket.send = originalSend;
      socket.removeListener('message', receive);
    }
  } finally {
    for (const item of devices) item.device.close();
  }
}

module.exports = { packetSummary, diagnose };
if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv.length !== 3 || !isIPv4(process.argv[2])) {
      throw new Error('Usage: node v5-diagnose-auth.js <Broadlink-IP> (stop Homebridge first)');
    }
    return diagnose(process.argv[2], require(PLUGIN));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
