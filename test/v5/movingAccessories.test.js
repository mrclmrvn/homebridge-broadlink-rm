const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/timedFixture');
const { BroadlinkRMPlatform } = require('../../dist/platform');

const covering = { totalDurationOpen: 10, totalDurationClose: 20, initialDelay: 0 };

test('covering estimates position and sends stop at a partial target', async t => {
  const f = fixture(t, 'window-covering', covering);
  await f.set('TargetPosition', 50);
  assert.deepEqual(f.sent, ['open']);
  assert.equal(f.get('PositionState'), f.C.PositionState.INCREASING);
  await f.clock.tick(2000);
  assert.equal(f.get('CurrentPosition'), 20);
  await f.clock.tick(3000);
  assert.deepEqual(f.sent, ['open', 'stop']);
  assert.equal(f.get('CurrentPosition'), 50);
  assert.equal(f.get('PositionState'), f.C.PositionState.STOPPED);
});

test('covering reverses from its estimated position and cancels the old completion', async t => {
  const f = fixture(t, 'window-covering', covering);
  await f.set('TargetPosition', 100);
  await f.clock.tick(3000);
  await f.set('TargetPosition', 0);
  assert.deepEqual(f.sent, ['open', 'stop', 'close']);
  assert.equal(f.get('CurrentPosition'), 30);
  assert.equal(f.get('PositionState'), f.C.PositionState.DECREASING);
  await f.clock.tick(3000);
  assert.equal(f.get('CurrentPosition'), 15);
  await f.clock.tick(4000);
  assert.equal(f.get('CurrentPosition'), 0);
  assert.equal(f.get('PositionState'), f.C.PositionState.STOPPED);
  assert.equal(f.clock.timers.size, 0);
});

test('covering hold stops motion; failed and missing codes do not claim success', async t => {
  const f = fixture(t, 'window-covering', covering);
  await f.set('TargetPosition', 100);
  await f.clock.tick(1000);
  await f.set('HoldPosition', true);
  assert.equal(f.get('TargetPosition'), 10);
  assert.equal(f.get('CurrentPosition'), 10);
  assert.equal(f.clock.timers.size, 0);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('TargetPosition', 100), /offline/);
  assert.equal(f.get('TargetPosition'), 10);
  assert.equal(f.get('PositionState'), f.C.PositionState.STOPPED);
  delete f.config.data.stop;
  await assert.rejects(f.set('TargetPosition', 50), /stop code/);
  await assert.rejects(f.set('TargetPosition', NaN), /between 0 and 100/);
});

test('covering endpoint codes honor stop flags and duplicate requests', async t => {
  const f = fixture(t, 'window-covering', { ...covering, sendStopAt100: true,
    data: { openCompletely: 'full', stop: 'stop' } });
  await f.set('TargetPosition', 100);
  await f.set('TargetPosition', 100);
  await f.clock.tick(10000);
  assert.deepEqual(f.sent, ['full', 'stop']);
});

test('failed automatic covering stop is logged without reporting a stopped covering', async t => {
  const f = fixture(t, 'window-covering', covering);
  await f.set('TargetPosition', 50);
  f.device.sendData = async () => { throw new Error('stop failed'); };
  await f.clock.tick(5000);
  assert.equal(f.get('PositionState'), f.C.PositionState.INCREASING);
  assert.ok(f.errors.some(message => message.includes('stop failed')));
});

test('lock starts unknown, honors transition durations and actually sends auto-lock', async t => {
  const f = fixture(t, 'lock', { lockDuration: 2, unlockDuration: 1, autoLockDelay: 3 });
  assert.equal(f.get('LockCurrentState'), f.C.LockCurrentState.UNKNOWN);
  assert.deepEqual(f.sent, []);
  await f.set('LockTargetState', 0);
  await f.set('LockTargetState', 0);
  await f.clock.tick(1000);
  assert.equal(f.get('LockCurrentState'), 0);
  await f.clock.tick(3000);
  assert.deepEqual(f.sent, ['unlock', 'lock']);
  assert.equal(f.get('LockTargetState'), 1);
  assert.equal(f.get('LockCurrentState'), f.C.LockCurrentState.UNKNOWN);
  await f.clock.tick(2000);
  assert.equal(f.get('LockCurrentState'), 1);
});

test('lock reversal cancels stale timers and failed commands retain previous state', async t => {
  const f = fixture(t, 'lock', { lockUnlockDuration: 2 });
  await f.set('LockTargetState', 0);
  await f.clock.tick(1000);
  await f.set('LockTargetState', 1);
  await f.clock.tick(1000);
  assert.equal(f.get('LockCurrentState'), 3);
  await f.clock.tick(1000);
  assert.equal(f.get('LockCurrentState'), 1);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('LockTargetState', 0), /offline/);
  assert.equal(f.get('LockTargetState'), 1);
  assert.equal(f.get('LockCurrentState'), 1);
  await assert.rejects(f.set('LockTargetState', 5), /Invalid lock/);
});

test('garage door changes direction, cancels stale travel and sends auto-close', async t => {
  const f = fixture(t, 'garage-door-opener', { openCloseDuration: 2, autoCloseDelay: 3 });
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.STOPPED);
  await f.set('TargetDoorState', 0);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.OPENING);
  await f.clock.tick(1000);
  await f.set('TargetDoorState', 1);
  await f.clock.tick(1000);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.CLOSING);
  await f.clock.tick(1000);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.CLOSED);
  await f.set('TargetDoorState', 0);
  await f.clock.tick(5000);
  assert.deepEqual(f.sent, ['open', 'close', 'open', 'close']);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.CLOSING);
  await f.clock.tick(2000);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.CLOSED);
});

test('garage optional lock sends codes and failed door commands preserve targets', async t => {
  const f = fixture(t, 'garage-door-opener');
  await f.set('LockTargetState', 1);
  await f.set('LockTargetState', 0);
  assert.deepEqual(f.sent, ['lock', 'unlock']);
  assert.equal(f.get('LockCurrentState'), 0);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('TargetDoorState', 0), /offline/);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.STOPPED);
  assert.equal(f.get('TargetDoorState'), 1);
  await assert.rejects(f.set('TargetDoorState', 9), /Invalid garage/);
});

test('shutdown cancels automatic actions and prevents queued writes', async t => {
  const f = fixture(t, 'lock', { autoLockDelay: 1 });
  await f.set('LockTargetState', 0);
  await f.clock.tick(1000);
  assert.equal(f.clock.timers.size, 1);
  f.instance.dispose();
  await f.clock.tick(10000);
  assert.deepEqual(f.sent, ['unlock']);
  await assert.rejects(f.set('LockTargetState', 1), /shut down/);
});

test('platform skips invalid movement configuration and disposes instances on shutdown', async t => {
  const f = fixture(t, 'lock');
  const handlers = {};
  const registered = [];
  const api = {
    hap: { Service: f.S, Characteristic: f.C, uuid: { generate: key => key } },
    platformAccessory: f.Accessory, on(event, handler) { handlers[event] = handler; },
    registerPlatformAccessories(plugin, platform, accessories) { registered.push(...accessories); },
    unregisterPlatformAccessories() {}, updatePlatformAccessories() {},
  };
  const platform = new BroadlinkRMPlatform(f.platform.log, { platform: 'BroadlinkRM', disableDiscovery: true,
    accessories: [{ name: 'Invalid', type: 'window-covering' }, { name: 'Lock', type: 'lock' }] }, api);
  await handlers.didFinishLaunching();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].displayName, 'Lock');
  assert.ok(f.errors.some(message => message.includes('Cannot configure')));
  handlers.shutdown();
  await assert.rejects(registered[0].getService(f.S.LockMechanism)
    .getCharacteristic(f.C.LockTargetState).set(1), /shut down/);
});

test('a timer already queued behind a new lock command cannot apply stale state', async t => {
  const f = fixture(t, 'lock', { lockDuration: 2, unlockDuration: 1 });
  await f.set('LockTargetState', 0);
  let release;
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  f.device.sendData = async () => {
    started();
    await new Promise(resolve => { release = resolve; });
  };
  const locking = f.set('LockTargetState', 1);
  await sending;
  await f.clock.tick(1000);
  release();
  await locking;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.get('LockCurrentState'), 3);
  await f.clock.tick(1000);
  assert.equal(f.get('LockCurrentState'), 3);
  await f.clock.tick(1000);
  assert.equal(f.get('LockCurrentState'), 1);
});

test('automatic lock transmission failures are logged and leave the lock unsecured', async t => {
  const f = fixture(t, 'lock', { autoLockDelay: 1 });
  await f.set('LockTargetState', 0);
  await f.clock.tick(1000);
  f.device.sendData = async () => { throw new Error('offline'); };
  await f.clock.tick(1000);
  assert.equal(f.get('LockCurrentState'), 0);
  assert.equal(f.get('LockTargetState'), 0);
  assert.ok(f.errors.some(message => message.includes('autoLock: offline')));
});

test('shutdown during a send does not arm a new travel timer', async t => {
  const f = fixture(t, 'garage-door-opener');
  let release;
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  f.device.sendData = async () => {
    started();
    await new Promise(resolve => { release = resolve; });
  };
  const opening = f.set('TargetDoorState', 0);
  await sending;
  f.instance.dispose();
  release();
  await assert.rejects(opening, /shut down/);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.STOPPED);
});

test('covering initial delay defers transmission and is cancelled on shutdown', async t => {
  const f = fixture(t, 'window-covering', { ...covering, initialDelay: 1 });
  const opening = f.set('TargetPosition', 100);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.sent, []);
  await f.clock.tick(999);
  assert.deepEqual(f.sent, []);
  await f.clock.tick(1);
  await opening;
  assert.deepEqual(f.sent, ['open']);
  await f.clock.tick(10000);
  const closing = f.set('TargetPosition', 0);
  await new Promise(resolve => setImmediate(resolve));
  f.instance.dispose();
  await assert.rejects(closing, /shut down/);
  assert.equal(f.clock.timers.size, 0);
  assert.deepEqual(f.sent, ['open']);
});

test('garage automatic close failure preserves the open state and is logged', async t => {
  const f = fixture(t, 'garage-door-opener', { openDuration: 1, autoCloseDelay: 1,
    data: { open: 'open', close: 'close' } });
  assert.equal(f.accessory.getService(f.S.GarageDoorOpener).testCharacteristic(f.C.LockTargetState), false);
  await f.set('TargetDoorState', 0);
  await f.clock.tick(1000);
  f.device.sendData = async () => { throw new Error('offline'); };
  await f.clock.tick(1000);
  assert.equal(f.get('CurrentDoorState'), f.C.CurrentDoorState.OPEN);
  assert.equal(f.get('TargetDoorState'), f.C.TargetDoorState.OPEN);
  assert.ok(f.errors.some(message => message.includes('autoClose: offline')));
});

test('invalid durations are rejected instead of overflowing or becoming immediate timers', t => {
  const f = fixture(t, 'lock');
  const { createAccessoryInstance } = require('../../dist/accessories');
  for (const duration of [-1, Infinity, NaN, '8', 2147484]) {
    f.accessory.context.config = { type: 'lock', lockDuration: duration };
    assert.throws(() => createAccessoryInstance(f.platform, f.accessory), /Duration must be/);
  }
  f.accessory.context.config = { type: 'window-covering', ...covering, totalDurationOpen: 0 };
  assert.throws(() => createAccessoryInstance(f.platform, f.accessory), /positive/);
  assert.equal(f.clock.timers.size, 0);
});
