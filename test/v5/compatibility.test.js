const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { probePower } = require('../../dist/sensors/power');
const { FeedbackSource } = require('../../dist/sensors/feedback');
const { MQTTSensor } = require('../../dist/sensors/mqtt');
const { createAccessoryInstance } = require('../../dist/accessories');
const { fixture } = require('./helpers/timedFixture');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('power probes distinguish reachability, missing utilities and platform output', async () => {
  const signal = new AbortController().signal;
  const calls = [];
  let result = { code: 0, stdout: '' };
  const runner = async (...args) => { calls.push(args); return result; };
  const probe = (platform, arp = false) => probePower('192.0.2.1', arp, 1500, signal, platform, runner);
  assert.equal(await probe('linux'), true);
  assert.deepEqual(calls[0].slice(0, 3), ['ping', ['-n', '-c', '1', '-W', '2', '192.0.2.1'], 2500]);
  result = { code: 1, stdout: '' };
  assert.equal(await probe('linux'), false);
  result = { stdout: '' };
  assert.equal(await probe('linux'), undefined);
  result = { code: 2, stdout: '1 packets transmitted, 0 packets received' };
  assert.equal(await probe('darwin'), false);
  assert.equal(calls.at(-1)[1][4], '1500');
  result = { code: 0, stdout: 'Reply from 192.0.2.1: bytes=32 time<1ms TTL=64' };
  assert.equal(await probe('win32'), true);
  result = { code: 0, stdout: 'Destination host unreachable.' };
  assert.equal(await probe('win32'), undefined);
  result = { code: 0, stdout: '192.0.2.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff STALE' };
  assert.equal(await probe('linux', true), true); // Cache presence, not a fresh reply.
  result = { code: 0, stdout: '192.0.2.1 dev eth0 FAILED' };
  assert.equal(await probe('linux', true), false);
  result = { code: 0, stdout: '? (192.0.2.1) at a:b:c:d:e:f on en0' };
  assert.equal(await probe('darwin', true), true);
  result = { code: 2, stdout: '' };
  assert.equal(await probe('darwin', true), undefined);
  await assert.rejects(probePower('192.0.2.1; command', false, 1, signal, 'linux', runner), /IPv4/);
  const aborted = new AbortController(); aborted.abort();
  const count = calls.length;
  assert.equal(await probePower('192.0.2.1', false, 1, aborted.signal, 'linux', runner), undefined);
  assert.equal(calls.length, count);
});

function interceptProbe(t) {
  const state = { code: 0, calls: 0, signals: [] };
  t.mock.method(require('node:child_process'), 'execFile', (file, args, options, callback) => {
    state.calls++; state.signals.push(options.signal);
    setImmediate(() => callback(state.code === 0 ? null : { code: state.code }, 'TTL=64'));
  });
  return state;
}

test('power observations never transmit; guarded toggles use fresh state and grace', async t => {
  const probe = interceptProbe(t);
  const f = fixture(t, 'switch', { pingIPAddress: '192.0.2.1', pingGrace: 2, data: { on: 'toggle', off: 'toggle' } });
  await f.clock.tick(0);
  assert.equal(f.get('On'), true);
  assert.deepEqual(f.sent, []);
  await f.set('On', true);
  assert.deepEqual(f.sent, []);
  await f.set('On', false);
  assert.deepEqual(f.sent, ['toggle']);
  const calls = probe.calls;
  await f.set('On', false);
  assert.equal(probe.calls, calls);
  assert.deepEqual(f.sent, ['toggle']);
  await f.clock.tick(2100);
  probe.code = 'ENOENT';
  await assert.rejects(f.set('On', false), /indeterminate/);
  assert.deepEqual(f.sent, ['toggle']);
  f.instance.dispose();
  assert.ok(probe.signals.every(signal => signal.aborted));
  assert.equal(f.clock.timers.size, 0);
});

test('power polling requires consecutive missed pings and reports recovery immediately', async t => {
  const probe = interceptProbe(t);
  const f = fixture(t, 'switch', { pingIPAddress: '192.0.2.1', minimumPingFailures: 2 });
  await f.clock.tick(0);
  assert.equal(f.get('On'), true);
  for (const [code, on] of [[1, true], [0, true], [1, true], ['ENOENT', true], [1, true], [1, false], [0, true]]) {
    probe.code = code;
    await f.clock.tick(1000);
    assert.equal(f.get('On'), on);
  }
  assert.deepEqual(f.sent, []);
});

test('outlet state-only detection reports use independently of commanded power', async t => {
  const probe = interceptProbe(t);
  const f = fixture(t, 'outlet', { pingIPAddress: '192.0.2.1', pingIPAddressStateOnly: true, data: { on: 'on', off: 'off' } });
  await f.clock.tick(0);
  assert.equal(f.get('On'), false);
  assert.equal(f.get('OutletInUse'), true);
  probe.code = 'ENOENT';
  await f.set('On', true);
  await f.set('On', false);
  assert.deepEqual(f.sent, ['on', 'off']);
  assert.equal(f.get('OutletInUse'), true);
});

test('fan cycles wrap, suppress repeats, and lose cycle position after failed pulses', async t => {
  const f = fixture(t, 'fan', { speedCycle: true, speedSteps: 3, speedCycleInterval: 0,
    data: { on: 'on', off: 'off', fanSpeed: 'next' } });
  await f.set('RotationSpeed', 99);
  assert.deepEqual(f.sent, ['on', 'next', 'next']);
  await f.set('RotationSpeed', 33);
  await f.set('RotationSpeed', 33);
  assert.deepEqual(f.sent, ['on', 'next', 'next', 'next']);
  f.device.sendData = async () => { throw new Error('lost packet'); };
  await assert.rejects(f.set('RotationSpeed', 66), /lost packet/);
  await assert.rejects(f.set('RotationSpeed', 99), /position is unknown/);
  f.device.sendData = async code => f.sent.push(code);
  await f.set('Active', 0); await f.set('Active', 1);
  assert.equal(f.get('RotationSpeed'), 33);
  await f.set('RotationSpeed', 66);
  assert.equal(f.get('RotationSpeed'), 66);
});

test('fan defaults send the configured speed and automatic off is cancelled by shutdown', async t => {
  const f = fixture(t, 'fan', { alwaysResetToDefaults: true, defaultFanSpeed: 50,
    enableAutoOff: true, onDuration: 1, data: { on: 'on', off: 'off', fanSpeed50: 'half' } });
  await f.set('Active', 1);
  assert.deepEqual(f.sent, ['on', 'half']);
  await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['on', 'half', 'off']);
  await f.set('Active', 1);
  f.instance.dispose();
  await f.clock.tick(2000);
  assert.deepEqual(f.sent, ['on', 'half', 'off', 'on', 'half']);
});

test('structured commands on a lock validate before sending and cancel owned delays', async t => {
  const f = fixture(t, 'lock', { data: { unlock: ['first', { data: 'second', sendCount: 0 }] } });
  await assert.rejects(f.set('LockTargetState', 0), /sendCount/);
  assert.deepEqual(f.sent, []);
  f.config.data.unlock = { data: ['first', { data: 'second', sendCount: 2, interval: 0 }], interval: 0 };
  const change = f.set('LockTargetState', 0);
  await flush();
  assert.deepEqual(f.sent, ['first']);
  await f.clock.tick(100);
  await change;
  assert.deepEqual(f.sent, ['first', 'second', 'second']);
  f.config.data.lock = ['lock', 'later'];
  const cancelled = assert.rejects(f.set('LockTargetState', 1), /shut down/);
  await flush(); f.instance.dispose(); await cancelled;
  assert.deepEqual(f.sent, ['first', 'second', 'second', 'lock']);
  assert.equal(f.clock.timers.size, 0);
});

test('light exclusives update peer state without transmitting an off command; timers send off', async t => {
  const f = fixture(t, 'light', { name: 'One', exclusives: ['Two'], onDelay: 0,
    enableAutoOff: true, onDuration: 1, data: { on: 'on', off: 'off' } });
  const peer = new f.Accessory('Two', 'two');
  peer.context.config = { type: 'light', name: 'Two', data: { on: 'two-on', off: 'two-off' } };
  const instance = createAccessoryInstance(f.platform, peer);
  t.after(() => instance.dispose());
  f.platform.instances = new Map([['one', f.instance], ['two', instance]]);
  const power = peer.getService(f.S.Lightbulb).getCharacteristic(f.C.On);
  await power.set(true); await f.set('On', true);
  assert.equal(power.get(), false);
  assert.deepEqual(f.sent, ['two-on', 'on']);
  await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['two-on', 'on', 'off']);
});

test('file feedback accepts explicit binary values, rejects stale/invalid data and closes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'broadlink-feedback-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'bolt.json');
  const source = new FeedbackSource({ filePath, maxAge: 1 }, 'lock');
  await fs.writeFile(filePath, '{"locked":false}');
  assert.equal(await source.read(), false);
  await fs.writeFile(filePath, 'locked'); assert.equal(await source.read(), true);
  await fs.writeFile(filePath, 'closed'); await assert.rejects(source.read(), /Invalid/);
  await fs.writeFile(filePath, 'true');
  const old = new Date(Date.now() - 10000); await fs.utimes(filePath, old, old);
  await assert.rejects(source.read(), /stale/);
  source.dispose(); await assert.rejects(source.read(), /closed/);
  assert.throws(() => new FeedbackSource({ filePath, mqttURL: 'mqtt://invalid' }, 'lock'), /exactly one/);
});

function fakeFeedback(t, values) {
  t.mock.method(FeedbackSource.prototype, 'read', async function () {
    const value = values[this.config.filePath];
    if (value instanceof Error) throw value;
    return value;
  });
}

test('lock feedback confirms the bolt, delays auto-lock until confirmed, and blocks on source failure', async t => {
  const values = { bolt: true }; fakeFeedback(t, values);
  const f = fixture(t, 'lock', { lockSensor: { filePath: 'bolt' }, lockDuration: 1, unlockDuration: 2, autoLockDelay: 1 });
  assert.equal(await f.get('LockCurrentState'), 1);
  await f.set('LockTargetState', 1); assert.deepEqual(f.sent, []);
  await f.set('LockTargetState', 0);
  assert.equal(await f.get('LockCurrentState'), 1); // The command is not confirmation.
  await f.clock.tick(1000); assert.deepEqual(f.sent, ['unlock']);
  values.bolt = false; assert.equal(await f.get('LockCurrentState'), 0);
  await f.clock.tick(1000); assert.deepEqual(f.sent, ['unlock', 'lock']);
  values.bolt = new Error('stale');
  await assert.rejects(f.set('LockTargetState', 0), /stale/);
  assert.deepEqual(f.sent, ['unlock', 'lock']);
});

test('garage endpoint feedback requires confirmation and obstruction blocks closing', async t => {
  const values = { closed: true, open: false, obstruction: false }; fakeFeedback(t, values);
  const f = fixture(t, 'garage-door-opener', { closedSensor: { filePath: 'closed' }, openSensor: { filePath: 'open' },
    obstructionSensor: { filePath: 'obstruction' }, openDuration: 2, closeDuration: 2 });
  assert.equal(await f.get('CurrentDoorState'), 1);
  await f.set('TargetDoorState', 0);
  values.closed = false;
  assert.equal(await f.get('CurrentDoorState'), 2);
  await f.clock.tick(2000);
  assert.equal(await f.get('CurrentDoorState'), 4);
  assert.ok(f.errors.some(error => error.includes('did not reach')));
  values.open = true; assert.equal(await f.get('CurrentDoorState'), 0);
  values.obstruction = true;
  await assert.rejects(f.set('TargetDoorState', 1), /obstruction/);
  values.obstruction = new Error('offline');
  await assert.rejects(f.set('TargetDoorState', 1), /offline/);
  assert.deepEqual(f.sent, ['open']);
  values.obstruction = false; await f.set('TargetDoorState', 1);
  values.open = false; values.closed = true;
  assert.equal(await f.get('CurrentDoorState'), 1);
  values.open = true;
  await assert.rejects(f.get('CurrentDoorState'), /contradictory/);
});

test('a closed-only garage contact never proves open or permits feedback-based auto-close', async t => {
  const values = { closed: false }; fakeFeedback(t, values);
  const f = fixture(t, 'garage-door-opener', { closedSensor: { filePath: 'closed' }, openDuration: 1 });
  assert.equal(await f.get('CurrentDoorState'), 4);
  await f.set('TargetDoorState', 0); await f.clock.tick(1000);
  assert.equal(await f.get('CurrentDoorState'), 4);
  const accessory = new f.Accessory('Bad', 'bad');
  accessory.context.config = { type: 'garage-door-opener', closedSensor: { filePath: 'closed' }, autoCloseDelay: 1 };
  assert.throws(() => createAccessoryInstance(f.platform, accessory), /requires an openSensor/);
});

test('MQTT binary feedback supports explicit paths and invalidates disconnects and malformed values', t => {
  class Client extends EventEmitter {
    subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
    end() {}
  }
  const client = new Client();
  const source = new MQTTSensor({ mqttURL: 'mqtt://broker.invalid', mqttMaxAge: 0,
    mqttTopic: [{ identifier: 'contact', topic: 'door', path: 'state.closed' },
      { identifier: 'lock', topic: 'bolt' }, { identifier: 'obstruction', topic: 'beam' }] }, () => client);
  source.onUpdate(() => {}); t.after(() => source.dispose()); client.emit('connect');
  const message = (topic, text) => client.emit('message', topic, Buffer.from(text));
  message('door', '{"state":{"closed":true}}'); assert.equal(source.read('contact'), 1);
  message('bolt', 'unlocked'); assert.equal(source.read('lock'), 0);
  message('beam', 'clear'); assert.equal(source.read('obstruction'), 0);
  message('door', '{"state":{"closed":2}}'); assert.throws(() => source.read('contact'), /Invalid/);
  client.emit('close'); assert.throws(() => source.read('lock'), /not connected/);
});

test('feedback loss at a transition deadline does not suppress retries after recovery', async t => {
  const values = { bolt: true }; fakeFeedback(t, values);
  const f = fixture(t, 'lock', { lockSensor: { filePath: 'bolt', pollInterval: 0 }, unlockDuration: 1 });
  await f.set('LockTargetState', 0);
  values.bolt = new Error('lost source'); await f.clock.tick(1000);
  assert.ok(f.control('LockCurrentState').value instanceof Error);
  values.bolt = true; await f.set('LockTargetState', 0);
  assert.deepEqual(f.sent, ['unlock', 'unlock']);
});

test('Thermostat validates modes and temperatures and commits state only after successful sends', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, coolOnly: true,
    tempStepSize: 0.5, data: { on: 'on', off: 'off', temperature24: { data: 'cool24', sendCount: 2, interval: 0 }, 'temperature24.5': 'cool245' } });
  await assert.rejects(f.set('TargetHeatingCoolingState', 1), /Unsupported/);
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  await assert.rejects(f.set('TargetHeatingCoolingState', 3), /Unsupported/);
  await f.set('TargetHeatingCoolingState', 2);
  assert.deepEqual(f.sent, ['cool24', 'cool24']);
  await f.set('TargetTemperature', 24.6);
  assert.equal(f.get('TargetTemperature'), 24.5);
  await assert.rejects(f.set('TargetTemperature', 25), /No IR/);
  assert.equal(f.get('TargetTemperature'), 24.5);
  await assert.rejects(f.set('TargetTemperature', NaN), /range/);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('TargetHeatingCoolingState', 0), /offline/);
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  assert.equal(f.get('CurrentHeatingCoolingState'), 2);
  await assert.rejects(f.set('TargetTemperature', 24), /offline/);
  assert.equal(f.get('TargetTemperature'), 24.5);
});

test('binary MQTT feedback reaches a lock without polling and releases its connection', async t => {
  class Client extends EventEmitter {
    subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
    end(force, options, callback) { this.ended = true; callback(); }
  }
  const client = new Client();
  t.mock.method(require('mqtt').default, 'connect', () => client);
  const f = fixture(t, 'lock', { lockSensor: { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'bolt', pollInterval: 0, maxAge: 1 } });
  client.emit('connect'); client.emit('message', 'bolt', Buffer.from('locked'));
  await f.clock.tick(0);
  assert.equal(f.control('LockCurrentState').value, 1);
  assert.deepEqual(f.sent, []);
  await f.clock.tick(1000);
  await assert.rejects(f.get('LockCurrentState'), /stale/);
  f.instance.dispose();
  assert.equal(client.ended, true);
  assert.equal(f.clock.timers.size, 0);
});

test('MQTT wattage tracks appliance power and guards toggles using fresh live readings', async t => {
  class Client extends EventEmitter {
    subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
    end(force, options, callback) { this.ended = true; callback(); }
  }
  const client = new Client();
  t.mock.method(require('mqtt').default, 'connect', () => client);
  const f = fixture(t, 'switch', { pingFrequency: 0.5, pingGrace: 0,
    powerSensor: {
      mqttURL: 'mqtt://broker.invalid',
      mqttTopic: [{ identifier: 'power', topic: 'plug', path: 'meter.watts' }],
      mqttMaxAge: 1, onThresholdWatts: 5,
    },
    data: { on: 'toggle', off: 'toggle' },
  });
  await f.clock.tick(0);
  client.emit('connect');
  const watts = (value, retain = false) =>
    client.emit('message', 'plug', Buffer.from(JSON.stringify({ meter: { watts: value } })), { retain });

  watts(20, true);
  await assert.rejects(f.set('On', true), /indeterminate/);
  watts(5);
  await f.clock.tick(500);
  assert.equal(f.get('On'), true);
  await f.set('On', true);
  assert.deepEqual(f.sent, []);

  watts(-1);
  await assert.rejects(f.set('On', false), /indeterminate/);
  watts(6);
  await f.clock.tick(1000);
  await assert.rejects(f.set('On', false), /indeterminate/);
  assert.equal(f.get('On'), true);

  watts(0.5);
  await f.clock.tick(500);
  assert.equal(f.get('On'), false);
  await f.set('On', true);
  assert.deepEqual(f.sent, ['toggle']);
  client.emit('close');
  await assert.rejects(f.set('On', false), /indeterminate/);
  f.instance.dispose();
  assert.equal(client.ended, true);
  assert.equal(f.clock.timers.size, 0);
});

test('shutdown aborts an unfinished system probe and prevents late power updates', async t => {
  let signal;
  t.mock.method(require('node:child_process'), 'execFile', (file, args, options, callback) => {
    signal = options.signal;
    signal.addEventListener('abort', () => callback({ code: 'ABORT_ERR' }, ''), { once: true });
  });
  const f = fixture(t, 'fan', { pingIPAddress: '192.0.2.1', data: { on: 'on', off: 'off' } });
  await f.clock.tick(0); assert.equal(signal.aborted, false);
  f.instance.dispose(); await flush();
  assert.equal(signal.aborted, true);
  assert.equal(f.get('Active'), 0);
  assert.deepEqual(f.sent, []);
  assert.equal(f.clock.timers.size, 0);
});

test('HeaterCooler validates a structured preset before powering on', async t => {
  const f = fixture(t, 'heater-cooler', { sensorPollInterval: 0,
    data: { cool: { on: 'on', off: 'off', temperatureCodes: { 24: { data: 'cool', sendCount: 0 } } } } });
  await assert.rejects(f.set('Active', 1), /sendCount/);
  assert.deepEqual(f.sent, []);
  f.config.data.cool.temperatureCodes[24].sendCount = 2;
  f.config.data.cool.temperatureCodes[24].interval = 0;
  await f.set('Active', 1);
  assert.deepEqual(f.sent, ['on', 'cool', 'cool']);
});

test('invalid or reconfigured cached setpoints fall back to the configured default', async t => {
  const { AirConditionerAccessory } = require('../../dist/accessories/airConditioner');
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, defaultCoolTemperature: 25 });
  f.instance.dispose();
  for (const saved of [undefined, null, '18', NaN, Infinity, 15, 31, 18.5]) {
    f.accessory.context.broadlinkRMState = { targetTemperature: saved };
    const instance = new AirConditionerAccessory(f.platform, f.accessory);
    assert.equal(f.get('TargetTemperature'), 25);
    instance.dispose();
  }
  f.accessory.context.broadlinkRMState = { targetTemperature: 18 };
  const valid = new AirConditionerAccessory(f.platform, f.accessory);
  assert.equal(f.get('TargetTemperature'), 18); valid.dispose();
  f.config.minTemperature = 20;
  const changed = new AirConditionerAccessory(f.platform, f.accessory);
  assert.equal(f.get('TargetTemperature'), 25); changed.dispose();
  assert.deepEqual(f.sent, []);
});

test('only accepted AC temperature writes update persisted state', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0,
    data: { on: 'on', temperature18: '18', temperature24: '24', off: 'off' } });
  const save = t.mock.method(f.platform, 'updateAccessoryContext', () => {});
  await f.set('TargetTemperature', 18);
  assert.deepEqual(f.accessory.context.broadlinkRMState, { targetTemperature: 18, targetHeatingCoolingState: 0, lastMode: 2 });
  await f.set('TargetHeatingCoolingState', 2);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('TargetTemperature', 24), /offline/);
  await assert.rejects(f.set('TargetTemperature', 19), /No IR/);
  await assert.rejects(f.set('TargetTemperature', 31), /range/);
  assert.equal(save.mock.callCount(), 2);
  assert.deepEqual(f.accessory.context.broadlinkRMState, { targetTemperature: 18, targetHeatingCoolingState: 2, lastMode: 2 });
});

test('AC mode feedback follows the external remote without replaying IR or changing its setpoint', async t => {
  class Client extends EventEmitter {
    subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
    end(force, options, callback) { this.ended = true; callback(); }
  }
  const client = new Client();
  t.mock.method(require('mqtt').default, 'connect', () => client);
  const f = fixture(t, 'air-conditioner', {
    coolOnly: true, sensorPollInterval: 0, defaultCoolTemperature: 25,
    stateFeedback: { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'ac/status' },
    data: { cool25: 'cool', off: 'off' },
  });
  client.emit('connect');
  async function report(payload, retain = false) {
    client.emit('message', 'ac/status', Buffer.from(payload), { retain });
    await f.clock.tick(0);
  }
  await report('cool', true);
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  await report('{"mode":"cool"}');
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  assert.equal(f.get('CurrentHeatingCoolingState'), 2);
  await f.set('TargetHeatingCoolingState', 2);
  assert.deepEqual(f.sent, []);
  await report('heat');
  await report('invalid');
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  await report('off');
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.equal(f.get('TargetTemperature'), 25);
  assert.equal(f.accessory.context.broadlinkRMState.lastMode, 2);
  assert.deepEqual(f.sent, []);
  let acknowledge;
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  f.device.sendData = async code => { f.sent.push(code); await acknowledgement; };
  const turningOn = f.set('TargetHeatingCoolingState', 2);
  await flush();
  assert.deepEqual(f.sent, ['cool']);
  await report('off');
  acknowledge();
  await turningOn;
  await f.clock.tick(0);
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  await report('off');
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.deepEqual(f.sent, ['cool']);
  f.instance.dispose();
  assert.equal(client.ended, true);
});
