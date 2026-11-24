const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const dgram = require('node:dgram');
const discovery = require('../../dist/broadlink/discovery');
const { DeviceManager } = require('../../dist/deviceManager');
const { BroadlinkRMPlatform } = require('../../dist/platform');
const { createHomebridgeAPI } = require('./helpers/homebridgeRuntime');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(t) {
  const timers = new Map(), messages = [];
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    const handle = { unref() {} }; timers.set(handle, { callback, delay }); return handle;
  });
  t.mock.method(global, 'clearTimeout', handle => timers.delete(handle));
  const manager = new DeviceManager({ info() {}, debug(message) { messages.push(message); }, warn(message) { messages.push(message); }, error(message) { messages.push(message); } });
  t.after(() => manager.closeAll());
  const fire = async () => {
    const [handle, timer] = [...timers][0]; timers.delete(handle); timer.callback(); await flush();
  };
  return { manager, timers, messages, fire };
}
const device = (host, macAddress = '01:02:03:04:05:06') => ({ host, macAddress, devType: 0x520b, port: 80,
  close() { this.closed = true; } });

test('scheduled discovery finds late devices and refreshes MAC routing without restarting', async t => {
  const f = setup(t), first = device('192.0.2.10'), moved = device('192.0.2.11');
  let next = first;
  t.mock.method(discovery, 'discoverDevices', async () => [{ device: next }]);
  f.manager.startRediscovery();
  assert.equal([...f.timers.values()][0].delay, 3600000);
  assert.equal(f.manager.getDevice('010203040506'), undefined);
  await f.fire();
  assert.equal(f.manager.getDevice('01-02-03-04-05-06'), first);
  assert.ok(f.messages.some(message => /Discovery received 1 device response/.test(message)));
  next = moved; await f.fire();
  assert.equal(first.closed, true);
  assert.equal(f.manager.getDevice('192.0.2.10'), undefined);
  assert.equal(f.manager.getDevice('010203040506'), moved);
  assert.equal(f.timers.size, 1);
  f.manager.closeAll(); assert.equal(f.timers.size, 0);
});

test('discovery requests coalesce and disabling the schedule during a sweep prevents rescheduling', async t => {
  const f = setup(t); let release, calls = 0;
  t.mock.method(discovery, 'discoverDevices', () => { calls++; return new Promise(resolve => { release = resolve; }); });
  f.manager.startRediscovery(1);
  await f.fire();
  const pending = f.manager.discover();
  assert.equal(f.manager.discover(), pending);
  assert.equal(calls, 1); assert.equal(f.timers.size, 0);
  f.manager.startRediscovery(0);
  release([]); await pending; await flush();
  assert.equal(f.timers.size, 0);
});

test('shutdown aborts discovery, closes late results and prevents new scans or registration', async t => {
  const f = setup(t); let release, signal;
  t.mock.method(discovery, 'discoverDevices', (timeout, nextSignal) => {
    signal = nextSignal; return new Promise(resolve => { release = resolve; });
  });
  const pending = f.manager.discover();
  f.manager.closeAll(); assert.equal(signal.aborted, true);
  const late = device('192.0.2.10'); release([{ device: late }]); await pending;
  assert.equal(late.closed, true); assert.equal(f.manager.getDevice(), undefined);
  f.manager.startRediscovery(); await f.manager.discover(); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.messages, []);
});

test('invalid intervals are rejected and link-local replies cannot replace a known address', t => {
  const f = setup(t), good = device('192.0.2.10'), bad = device('169.254.1.2');
  f.manager.registerDevice(good); f.manager.registerDevice(bad);
  assert.equal(bad.closed, true); assert.equal(f.manager.getDevice(), good);
  assert.ok(f.messages.some(message => /link-local.*DHCP/.test(message)));
  for (const value of [-1, NaN, Infinity, '60', null, 40000]) {
    f.manager.startRediscovery(value); assert.equal(f.timers.size, 0);
  }
  f.manager.startRediscovery(0); assert.equal(f.timers.size, 0);
});

test('rediscovery replaces an unusable socket even when its address has not changed', t => {
  const f = setup(t), broken = device('192.0.2.10'), replacement = device('192.0.2.10');
  broken.isUsable = false;
  f.manager.registerDevice(broken); f.manager.registerDevice(replacement);
  assert.equal(broken.closed, true); assert.equal(f.manager.getDevice(), replacement);
});

test('discovery cancellation closes its UDP socket and does not wait for the sweep timeout', async t => {
  let socket;
  t.mock.method(dgram, 'createSocket', () => {
    socket = new EventEmitter(); socket.bind = () => {}; socket.close = () => { socket.closed = true; };
    return socket;
  });
  const abort = new AbortController();
  const pending = assert.rejects(discovery.discoverDevices(30000, abort.signal), /aborted/);
  abort.abort(); await pending;
  assert.equal(socket.closed, true);
  await assert.rejects(discovery.discoverDevices(30000, abort.signal), /aborted/);
});

test('platform respects disableDiscovery and interval zero even with configured hosts', async t => {
  for (const disabled of [true, false]) await t.test(`disableDiscovery=${disabled}`, async t => {
    const api = createHomebridgeAPI();
    const platform = new BroadlinkRMPlatform({ info() {}, warn() {}, error() {}, debug() {} }, {
      platform: 'BroadlinkRM', disableDiscovery: disabled, rediscoveryInterval: 0,
      hosts: [{ address: '192.0.2.10', mac: '01:02:03:04:05:06' }], accessories: [],
    }, api);
    t.after(() => api.emit('shutdown'));
    const init = t.mock.method(platform.deviceManager, 'initHosts', async () => {});
    const scan = t.mock.method(platform.deviceManager, 'discover', async () => {});
    const schedule = t.mock.method(platform.deviceManager, 'startRediscovery', () => {});
    await platform.initDevicesAndAccessories();
    assert.equal(init.mock.callCount(), 1);
    assert.equal(scan.mock.callCount(), disabled ? 0 : 1);
    assert.equal(schedule.mock.callCount(), disabled ? 0 : 1);
    if (!disabled) assert.equal(schedule.mock.calls[0].arguments[0], 0);
  });
});

test('shutdown during startup discovery never registers accessories or starts a schedule', async t => {
  const api = createHomebridgeAPI(); let release;
  const platform = new BroadlinkRMPlatform({ info() {}, warn() {}, error() {}, debug() {} }, {
    platform: 'BroadlinkRM', accessories: [{ name: 'Gate', type: 'switch', virtual: true }],
  }, api);
  t.mock.method(platform.deviceManager, 'discover', () => new Promise(resolve => { release = resolve; }));
  const schedule = t.mock.method(platform.deviceManager, 'startRediscovery', () => {});
  const pending = platform.initDevicesAndAccessories();
  api.emit('shutdown'); release(); await pending;
  assert.equal(platform.instances.size, 0); assert.equal(schedule.mock.callCount(), 0);
});
