const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fixture } = require('./helpers/timedFixture');
const { createAccessoryInstance } = require('../../dist/accessories');
const { FeedbackSource } = require('../../dist/sensors/feedback');
const { MQTTSensor } = require('../../dist/sensors/mqtt');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('AC mode-specific temperature codes and mode commands preserve the saved setpoint by default', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, modeChangeDelay: 0,
    data: { cool: 'cool-mode', heat: 'heat-mode', off: 'off', cool18: 'cool18', heat18: 'heat18', temperature18: 'generic' } });
  await f.set('TargetTemperature', 18);
  await f.set('TargetHeatingCoolingState', 2);
  await f.set('TargetHeatingCoolingState', 1);
  assert.deepEqual(f.sent, ['cool-mode', 'cool18', 'heat-mode', 'heat18']);
  assert.equal(f.get('TargetTemperature'), 18);
  assert.deepEqual(f.accessory.context.broadlinkRMState, { targetTemperature: 18 });
});

test('AC legacy default reset and missing-code fallback are opt-in and report the actual selected target', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, defaultCoolTemperature: 25, defaultHeatTemperature: 28,
    resetTemperatureOnModeChange: true, fallbackToDefaultTemperature: true,
    data: { cool25: 'cool25', heat28: 'heat28', off: 'off' } });
  await f.set('TargetTemperature', 18);
  await f.set('TargetHeatingCoolingState', 2);
  assert.equal(f.get('TargetTemperature'), 25);
  await f.set('TargetHeatingCoolingState', 1);
  assert.equal(f.get('TargetTemperature'), 28);
  await f.set('TargetTemperature', 20);
  assert.equal(f.get('TargetTemperature'), 28);
  assert.deepEqual(f.sent, ['cool25', 'heat28', 'heat28']);
  assert.equal(f.accessory.context.broadlinkRMState.targetTemperature, 28);
});

test('AC on/mode delays keep order and validate the full plan before any send', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, turnOnWhenOff: true,
    data: { on: 'on', cool: 'mode', cool24: { data: '24', sendCount: 0 } } });
  await assert.rejects(f.set('TargetHeatingCoolingState', 2), /sendCount/);
  assert.deepEqual(f.sent, []);
  f.config.data.cool24.sendCount = 1;
  const command = f.set('TargetHeatingCoolingState', 2);
  await flush(); assert.deepEqual(f.sent, ['on']);
  await f.clock.tick(300); assert.deepEqual(f.sent, ['on', 'mode']);
  await f.clock.tick(250); await command;
  assert.deepEqual(f.sent, ['on', 'mode', '24']);
});

test('shutdown during an AC startup sequence cancels remaining sends without committing the requested mode', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, sendOnWhenOff: true,
    data: { on: 'on', cool24: '24' } });
  const cancelled = assert.rejects(f.set('TargetHeatingCoolingState', 2), /shut down/);
  await flush(); f.instance.dispose(); await cancelled;
  assert.deepEqual(f.sent, ['on']); assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.equal(f.clock.timers.size, 0);
});

test('AC explicit off-state activation, dry-off and automatic power timers send configured commands', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, ignoreTemperatureWhenOff: false,
    enableAutoOff: true, onDuration: 1,
    data: { on: 'on', off: 'off', offDryMode: 'dry-off', cool18: '18' } });
  await f.set('TargetTemperature', 18);
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  await f.clock.tick(1000);
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.deepEqual(f.sent, ['18', 'dry-off']);
  assert.equal(f.accessory.context.broadlinkRMState.targetTemperature, 18);
});

test('AC heatOnly, Auto replacement and pseudo-mode metadata reject unsupported physical modes', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, heatOnly: true,
    defaultHeatTemperature: 28, replaceAutoMode: 'heat', data: { heat28: { data: '28', 'pseudo-mode': 'cool' } } });
  assert.equal(f.get('TargetTemperature'), 28);
  assert.deepEqual(f.control('TargetHeatingCoolingState').props.validValues, [0, 1, 3]);
  await assert.rejects(f.set('TargetHeatingCoolingState', 3), /pseudo-mode/);
  assert.deepEqual(f.sent, []);
  f.config.data.heat28['pseudo-mode'] = 'heat';
  await f.set('TargetHeatingCoolingState', 3);
  assert.equal(f.get('TargetHeatingCoolingState'), 1);
  assert.equal(f.get('CurrentHeatingCoolingState'), 1);
  await assert.rejects(f.set('TargetHeatingCoolingState', 2), /Unsupported/);
  assert.deepEqual(f.sent, ['28']);
});

test('TV power timers run only after a request and shutdown cancels the next action', async t => {
  const f = fixture(t, 'tv', { enableAutoOff: true, onDuration: 1, enableAutoOn: true, offDuration: 1,
    data: { on: 'on', off: 'off' } });
  await f.clock.tick(2000); assert.deepEqual(f.sent, []);
  await f.set('Active', 1); await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['on', 'off']); assert.equal(f.get('Active'), 0);
  await f.clock.tick(1000); assert.deepEqual(f.sent, ['on', 'off', 'on']);
  f.instance.dispose(); await f.clock.tick(3000);
  assert.deepEqual(f.sent, ['on', 'off', 'on']);
});

test('TV picture modes require explicit codes, preserve successful state on failure, and remove stale controls', async t => {
  const f = fixture(t, 'tv', { data: { on: 'on', off: 'off', pictureMode: { standard: 'standard', game: { data: 'game', sendCount: 2, interval: 0 } } } });
  assert.throws(() => f.get('PictureMode'), /not been selected/);
  await f.set('PictureMode', 1); await f.set('PictureMode', 1);
  assert.deepEqual(f.sent, ['standard']);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('PictureMode', 5), /offline/);
  assert.equal(f.get('PictureMode'), 1);
  f.device.sendData = async code => f.sent.push(code);
  await f.set('PictureMode', 5); assert.deepEqual(f.sent, ['standard', 'game', 'game']);
  await assert.rejects(f.set('PictureMode', 3), /Unsupported/);
  f.instance.dispose(); delete f.config.data.pictureMode;
  const replacement = createAccessoryInstance(f.platform, f.accessory); t.after(() => replacement.dispose());
  assert.equal(f.control('PictureMode').set, undefined);
});

test('TV automatic off failure leaves the previous power state and logs the failure', async t => {
  const f = fixture(t, 'tv', { enableAutoOff: true, onDuration: 1, data: { on: 'on', off: 'off' } });
  await f.set('Active', 1);
  f.device.sendData = async () => { throw new Error('offline'); };
  await f.clock.tick(1000);
  assert.equal(f.get('Active'), 1); assert.ok(f.errors.some(error => error.includes('offline')));
});

test('light resend aliases and stateless reset preserve transmission and local-reset semantics', async t => {
  const f = fixture(t, 'light', { onDelay: 0, preventResendHex: false, stateless: true,
    data: { on: 'on', off: 'off', brightness50: 'half' } });
  await f.set('Brightness', 50); await f.set('Brightness', 50);
  assert.deepEqual(f.sent, ['on', 'half', 'half']);
  await f.clock.tick(500);
  assert.equal(f.get('On'), false); assert.equal(f.get('Brightness'), 0);
  assert.deepEqual(f.sent, ['on', 'half', 'half']);
  f.config.allowResend = false;
  await f.set('On', true); await f.set('Brightness', 50);
  assert.deepEqual(f.sent, ['on', 'half', 'half', 'on', 'half']);
});

function feedback(t, values) {
  t.mock.method(FeedbackSource.prototype, 'read', async function () {
    const value = values[this.config.filePath];
    if (value instanceof Error) throw value;
    return value;
  });
}

test('lock jam feedback cancels inferred completion and auto-lock until the source clears', async t => {
  const values = { jam: false }; feedback(t, values);
  const f = fixture(t, 'lock', { jamSensor: { filePath: 'jam' }, unlockDuration: 1, autoLockDelay: 1 });
  await f.set('LockTargetState', 0);
  values.jam = true; await f.clock.tick(0);
  assert.equal(await f.get('LockCurrentState'), 2);
  await assert.rejects(f.set('LockTargetState', 1), /jammed/);
  await f.clock.tick(3000); assert.deepEqual(f.sent, ['unlock']);
  values.jam = false; assert.equal(await f.get('LockCurrentState'), 3);
  values.jam = new Error('source unavailable');
  await assert.rejects(f.set('LockTargetState', 1), /unavailable/);
  assert.ok(f.control('LockCurrentState').value instanceof Error);
});

test('garage jam faults current state, cancels automatic actions and never claims obstruction or recovery motion', async t => {
  const values = { jam: false }; feedback(t, values);
  const f = fixture(t, 'garage-door-opener', { jamSensor: { filePath: 'jam' }, openDuration: 1, autoCloseDelay: 1 });
  await f.set('TargetDoorState', 0);
  values.jam = true; await assert.rejects(f.get('CurrentDoorState'), /jammed/);
  await assert.rejects(f.set('TargetDoorState', 1), /jammed/);
  assert.equal(f.get('ObstructionDetected'), false);
  await f.clock.tick(3000); assert.deepEqual(f.sent, ['open']);
  values.jam = false; assert.equal(await f.get('CurrentDoorState'), 4);
  values.jam = new Error('stale'); await assert.rejects(f.set('TargetDoorState', 0), /stale/);
  assert.deepEqual(f.sent, ['open']);
});

test('MQTT jam identifiers parse explicit states and reject invalid values/disconnects', t => {
  class Client extends EventEmitter {
    subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
    end() {}
  }
  const client = new Client();
  const source = new MQTTSensor({ type: 'jam', mqttURL: 'mqtt://broker.invalid', mqttTopic: [{ identifier: 'jam', topic: 'motor', path: 'state.jammed' }], mqttMaxAge: 0 }, () => client);
  source.onUpdate(() => {}); t.after(() => source.dispose()); client.emit('connect');
  const message = value => client.emit('message', 'motor', Buffer.from(JSON.stringify({ state: { jammed: value } })));
  message('jammed'); assert.equal(source.read('jam'), 1);
  message('clear'); assert.equal(source.read('jam'), 0);
  message(2); assert.throws(() => source.read('jam'), /Invalid/);
  client.emit('close'); assert.throws(() => source.read('jam'), /not connected/);
});

test('new TV picture and jam-configured services construct with real HAP without warnings', () => {
  const hap = require('./helpers/homebridgeRuntime').hap;
  const warnings = [];
  const platform = { Service: hap.Service, Characteristic: hap.Characteristic, log: {}, deviceManager: { getDevice() {} } };
  for (const config of [{ type: 'tv', data: { pictureMode: { standard: 'standard', game: 'game' } } },
    { type: 'lock', jamSensor: { filePath: 'jam', pollInterval: 0 } },
    { type: 'garage-door-opener', jamSensor: { filePath: 'jam', pollInterval: 0 } }]) {
    const accessory = new hap.Accessory(config.type, hap.uuid.generate(`legacy-${config.type}`));
    accessory.context = { config };
    accessory.on('characteristic-warning', warning => warnings.push(warning.message));
    const instance = createAccessoryInstance(platform, accessory); instance.dispose();
  }
  assert.deepEqual(warnings, []);
});

test('AC reports accepted pseudo-mode overrides and failed mode commands preserve the prior state', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, modeChangeDelay: 0,
    data: { cool24: { data: 'cool24', 'pseudo-mode': 'heat' }, heat: 'mode', heat24: 'heat24' } });
  await f.set('TargetHeatingCoolingState', 2);
  assert.equal(f.get('TargetHeatingCoolingState'), 1);
  f.device.sendData = async () => { throw new Error('offline'); };
  f.config.data.cool24['pseudo-mode'] = 'cool';
  await assert.rejects(f.set('TargetHeatingCoolingState', 2), /offline/);
  assert.equal(f.get('TargetHeatingCoolingState'), 1);
});

test('AC Auto replacement and temperature fallback publish normalized values after the HAP write', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, replaceAutoMode: 'cool',
    fallbackToDefaultTemperature: true, defaultCoolTemperature: 25, data: { cool25: '25' } });
  const hap = require('./helpers/homebridgeRuntime').hap;
  const accessory = new hap.Accessory('AC', hap.uuid.generate('legacy-normalized-ac'));
  accessory.context = { config: f.config };
  const platform = { ...f.platform, Service: hap.Service, Characteristic: hap.Characteristic };
  const instance = createAccessoryInstance(platform, accessory); t.after(() => instance.dispose());
  const service = accessory.getService(hap.Service.Thermostat);
  const mode = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
  const temp = service.getCharacteristic(hap.Characteristic.TargetTemperature);
  await mode.handleSetRequest(3); await f.clock.tick(0);
  assert.equal(mode.value, 2);
  await temp.handleSetRequest(18); await f.clock.tick(0);
  assert.equal(temp.value, 25);
});

test('jam deadline failure cannot infer a secured lock and permits a fresh request after recovery', async t => {
  const values = { jam: false }; feedback(t, values);
  const f = fixture(t, 'lock', { jamSensor: { filePath: 'jam', pollInterval: 0 }, lockDuration: 1 });
  await f.clock.tick(0);
  await f.set('LockTargetState', 1);
  values.jam = new Error('stale'); await f.clock.tick(1000);
  assert.ok(f.control('LockCurrentState').value instanceof Error);
  values.jam = false; assert.equal(await f.get('LockCurrentState'), 3);
  await f.set('LockTargetState', 1); await f.clock.tick(1000);
  assert.equal(await f.get('LockCurrentState'), 1);
});

test('garage checks jam freshness at completion even when background polling is disabled', async t => {
  const values = { jam: false }; feedback(t, values);
  const f = fixture(t, 'garage-door-opener', { jamSensor: { filePath: 'jam', pollInterval: 0 }, openDuration: 1, autoCloseDelay: 1 });
  await f.clock.tick(0);
  await f.set('TargetDoorState', 0);
  values.jam = new Error('stale'); await f.clock.tick(1000);
  assert.ok(f.control('CurrentDoorState').value instanceof Error);
  values.jam = false; assert.equal(await f.get('CurrentDoorState'), 4);
  await f.clock.tick(2000); assert.deepEqual(f.sent, ['open']);
});

test('file jam feedback reads jammed aliases and never interprets an invalid value as clear', async t => {
  const fs = require('node:fs/promises');
  let contents = '{"jammed":true}';
  t.mock.method(fs, 'readFile', async () => contents);
  t.mock.method(fs, 'stat', async () => ({ mtimeMs: Date.now() }));
  const source = new FeedbackSource({ filePath: 'jam', maxAge: 30 }, 'jam'); t.after(() => source.dispose());
  assert.equal(await source.read(), true);
  contents = 'clear'; assert.equal(await source.read(), false);
  contents = '{"jam":2}'; await assert.rejects(source.read(), /Invalid/);
});

test('new configuration options reject invalid maps, contradictory modes and zero automatic durations', t => {
  const f = fixture(t, 'light');
  for (const config of [
    { type: 'air-conditioner', coolOnly: true, heatOnly: true },
    { type: 'air-conditioner', heatOnly: true, defaultMode: 'cool' },
    { type: 'air-conditioner', coolOnly: true, replaceAutoMode: 'heat' },
    { type: 'tv', data: { pictureMode: { cinema: 'code' } } },
    { type: 'tv', enableAutoOff: true, onDuration: 0 },
    { type: 'light', stateless: true, onDuration: 0 },
  ]) {
    const accessory = new f.Accessory('Invalid', 'invalid'); accessory.context.config = config;
    assert.throws(() => createAccessoryInstance(f.platform, accessory));
  }
  assert.equal(f.clock.timers.size, 0);
});

test('explicit legacy disable flags override automatic power enable flags', async t => {
  const f = fixture(t, 'tv', { enableAutoOff: true, disableAutomaticOff: true,
    onDuration: 0, data: { on: 'on', off: 'off' } });
  await f.set('Active', 1); await f.clock.tick(60000);
  assert.deepEqual(f.sent, ['on']); assert.equal(f.get('Active'), 1);
});
