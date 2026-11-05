const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fixture } = require('./helpers/timedFixture');
const { createAccessoryInstance } = require('../../dist/accessories');

test('device Auto sends auto mode/temperature codes and never invents compressor activity', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, modeChangeDelay: 0,
    data: { auto: 'auto-mode', auto24: 'auto24', auto18: 'auto18', off: 'off' } });
  assert.deepEqual(f.control('TargetHeatingCoolingState').props.validValues, [0, 1, 2, 3]);
  assert.deepEqual(f.sent, []);
  await f.set('TargetHeatingCoolingState', 3);
  assert.deepEqual(f.sent, ['auto-mode', 'auto24']);
  assert.equal(f.get('TargetHeatingCoolingState'), 3);
  assert.throws(() => f.get('CurrentHeatingCoolingState'), /activity is unavailable/);
  await f.set('TargetTemperature', 18);
  assert.deepEqual(f.sent, ['auto-mode', 'auto24', 'auto18']);
  assert.equal(f.accessory.context.broadlinkRMState.targetTemperature, 18);
  await f.set('TargetHeatingCoolingState', 0);
  assert.equal(f.get('CurrentHeatingCoolingState'), 0);
  assert.equal(f.sent.at(-1), 'off');
});

test('Auto metadata is accepted with supporting mappings and fixed Auto replacement takes precedence', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0,
    data: { temperature24: { data: 'auto24', 'pseudo-mode': 'auto' } } });
  await f.set('TargetHeatingCoolingState', 2);
  assert.equal(f.get('TargetHeatingCoolingState'), 3);
  assert.throws(() => f.get('CurrentHeatingCoolingState'), /unavailable/);
  f.instance.dispose();
  f.config.data = { auto: 'auto', auto24: 'auto24', cool24: 'cool24' };
  f.config.replaceAutoMode = 'cool';
  const replacement = createAccessoryInstance(f.platform, f.accessory); t.after(() => replacement.dispose());
  assert.deepEqual(f.control('TargetHeatingCoolingState').props.validValues, [0, 1, 2, 3]);
  await f.set('TargetHeatingCoolingState', 3);
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  assert.equal(f.sent.at(-1), 'cool24');
});

test('ambient thresholds use strict boundaries, zero values and automatic ownership for return-to-band Off', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoHeatTemperature: 0,
    autoCoolTemperature: 26, minimumAutoOnOffDuration: 0,
    data: { heat24: 'heat24', cool24: 'cool24', off: 'off' } });
  f.readings.temperature = -1; await f.clock.tick(0);
  assert.deepEqual(f.sent, ['heat24']);
  f.readings.temperature = 0; await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['heat24', 'off']);
  f.readings.temperature = 26; await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['heat24', 'off']);
  f.readings.temperature = 27; await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['heat24', 'off', 'cool24']);
  f.readings.temperature = 25; await f.clock.tick(1000);
  assert.equal(f.sent.at(-1), 'off');
});

test('manual AC changes revoke ambient ownership and delay automatic reactivation', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    minimumAutoOnOffDuration: 2,
    data: { cool24: '24', cool18: '18', off: 'off' } });
  f.readings.temperature = 30; await f.clock.tick(0);
  assert.deepEqual(f.sent, ['24']);
  await f.set('TargetTemperature', 18);
  f.readings.temperature = 24; await f.clock.tick(2000);
  assert.deepEqual(f.sent, ['24', '18']); // A manual takeover is not turned off at the boundary.
  await f.set('TargetHeatingCoolingState', 0);
  f.readings.temperature = 30; await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['24', '18', 'off']);
  await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['24', '18', 'off', '18']);
});

function addSwitch(t, f, name, key) {
  const accessory = new f.Accessory(name, key);
  accessory.context.config = { type: 'switch', name, data: { on: `${key}-on`, off: `${key}-off` } };
  const instance = createAccessoryInstance(f.platform, accessory); t.after(() => instance.dispose());
  f.platform.instances.set(key, instance);
  return accessory.getService(f.S.Switch).getCharacteristic(f.C.On);
}

test('linked switch gates ambient actions without sending commands by observation or stopping an active AC', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    minimumAutoOnOffDuration: 0, autoSwitch: 'Automation', data: { cool24: '24', off: 'off' } });
  f.platform.instances = new Map([['ac', f.instance]]);
  const gate = addSwitch(t, f, 'Automation', 'gate');
  f.readings.temperature = 30; await f.clock.tick(0);
  assert.deepEqual(f.sent, []);
  await gate.set(true); await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['gate-on', '24']);
  await gate.set(false); f.readings.temperature = 24; await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['gate-on', '24', 'gate-off']);
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
  await gate.set(true); await f.clock.tick(1000);
  assert.equal(f.sent.at(-1), 'off');
});

test('missing and ambiguous linked switches block ambient control and warn without repeated log spam', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    minimumAutoOnOffDuration: 0, autoSwitchName: 'Gate', data: { cool24: '24', off: 'off' } });
  const warnings = []; t.mock.method(f.platform.log, 'warn', message => warnings.push(message));
  f.platform.instances = new Map([['ac', f.instance]]);
  f.readings.temperature = 30; await f.clock.tick(1000);
  assert.deepEqual(f.sent, []); assert.equal(warnings.length, 1);
  const one = addSwitch(t, f, 'Gate', 'one');
  const two = addSwitch(t, f, 'Gate', 'two');
  await one.set(true); await two.set(true); await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['one-on', 'two-on']);
  f.platform.instances.delete('two'); await f.clock.tick(1000);
  assert.equal(f.sent.at(-1), '24');
});

test('failed automatic sends preserve measurements/state and respect the minimum retry duration alias', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    autoMinimumDuration: 2, data: { cool24: '24', off: 'off' } });
  f.readings.temperature = 30;
  let attempts = 0;
  f.device.sendData = async code => { attempts++; if (attempts === 1) throw new Error('offline'); f.sent.push(code); };
  await f.clock.tick(0);
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.equal(f.control('CurrentTemperature').value, 30);
  assert.ok(f.errors.some(error => error.includes('Ambient command failed')));
  await f.clock.tick(1000); assert.equal(attempts, 1);
  await f.clock.tick(1000); assert.equal(attempts, 2); assert.deepEqual(f.sent, ['24']);
});

test('ambient control cannot transmit a temperature code declaring the opposite physical mode', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    data: { temperature24: { data: 'heat24', 'pseudo-mode': 'heat' } } });
  f.readings.temperature = 30; await f.clock.tick(0);
  assert.deepEqual(f.sent, []);
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.ok(f.errors.some(error => error.includes('metadata conflicts')));
});

test('selecting device Auto suspends plugin ambient regulation and startup/shutdown stay controlled', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    minimumAutoOnOffDuration: 0, defaultMode: 'auto', defaultAutoTemperature: 23,
    data: { auto23: 'auto23', cool23: 'cool23', off: 'off' } });
  assert.equal(f.get('TargetTemperature'), 23);
  assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.deepEqual(f.sent, []);
  await f.set('TargetHeatingCoolingState', 3);
  f.readings.temperature = 30; await f.clock.tick(2000);
  assert.deepEqual(f.sent, ['auto23']);
  assert.equal(f.get('TargetHeatingCoolingState'), 3);
  f.instance.dispose(); await f.clock.tick(5000);
  assert.deepEqual(f.sent, ['auto23']); assert.equal(f.clock.timers.size, 0);
});

test('MQTT expiry/invalid measurements never trigger ambient commands and manual Off remains available', async t => {
  class Client extends EventEmitter {
    subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
    end(force, options, callback) { callback?.(); }
  }
  const client = new Client(); t.mock.method(require('mqtt').default, 'connect', () => client);
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, autoCoolTemperature: 26,
    minimumAutoOnOffDuration: 0, mqttURL: 'mqtt://broker.invalid', mqttMaxAge: 1,
    mqttTopic: [{ identifier: 'temperature', topic: 'room' }], data: { cool24: '24', off: 'off' } });
  client.emit('connect'); client.emit('message', 'room', Buffer.from('30'));
  await f.clock.tick(0); assert.deepEqual(f.sent, ['24']);
  await f.clock.tick(1000);
  assert.ok(f.control('CurrentTemperature').value instanceof Error);
  client.emit('message', 'room', Buffer.from('not-a-temperature')); await f.clock.tick(0);
  assert.deepEqual(f.sent, ['24']);
  client.emit('close'); await f.set('TargetHeatingCoolingState', 0);
  assert.deepEqual(f.sent, ['24', 'off']);
  await f.clock.tick(5000); assert.deepEqual(f.sent, ['24', 'off']);
});

test('ambient configuration rejects nonmeasurements, unsupported modes, invalid thresholds and missing Auto mappings', t => {
  const f = fixture(t, 'lock');
  for (const config of [
    { autoHeatTemperature: 26, autoCoolTemperature: 26 },
    { heatOnly: true, autoCoolTemperature: 26 },
    { coolOnly: true, autoHeatTemperature: 20 },
    { autoCoolTemperature: '26' },
    { autoCoolTemperature: 26, pseudoDeviceTemperature: 30 },
    { autoCoolTemperature: 26, minimumAutoOnOffDuration: -1 },
    { autoSwitchName: '' },
    { defaultMode: 'auto' },
  ]) {
    const accessory = new f.Accessory('Invalid', 'invalid');
    accessory.context.config = { type: 'air-conditioner', sensorPollInterval: 0, ...config };
    assert.throws(() => createAccessoryInstance(f.platform, accessory));
  }
  assert.equal(f.clock.timers.size, 0);
});

test('Auto default replacement also governs explicit activation by off-state temperature changes', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, defaultMode: 'auto',
    replaceAutoMode: 'cool', ignoreTemperatureWhenOff: false, data: { cool18: '18' } });
  await f.set('TargetTemperature', 18);
  assert.deepEqual(f.sent, ['18']); assert.equal(f.get('TargetHeatingCoolingState'), 2);
});

test('real HAP device Auto publishes the target without claiming heating or cooling activity', async t => {
  const f = fixture(t, 'lock');
  const hap = require('./helpers/homebridgeRuntime').hap;
  const accessory = new hap.Accessory('Auto AC', hap.uuid.generate('device-auto-ac'));
  accessory.context = { config: { type: 'air-conditioner', sensorPollInterval: 0, data: { auto24: '24' } } };
  const warnings = []; accessory.on('characteristic-warning', warning => warnings.push(warning.message));
  const platform = { ...f.platform, Service: hap.Service, Characteristic: hap.Characteristic };
  const instance = createAccessoryInstance(platform, accessory); t.after(() => instance.dispose());
  const service = accessory.getService(hap.Service.Thermostat);
  await service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(3);
  await f.clock.tick(0);
  assert.equal(service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).value, 3);
  assert.notEqual(service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).statusCode, 0);
  assert.deepEqual(warnings, []);
});

test('a virtual switch gates AC automation without transmitting an enable/disable command', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, autoCoolTemperature: 26,
    minimumAutoOnOffDuration: 0, autoSwitchName: 'Automation', data: { cool24: '24', off: 'off' } });
  const accessory = new f.Accessory('Automation', 'virtual-gate');
  accessory.context.config = { type: 'switch', name: 'Automation', virtual: true };
  const gate = createAccessoryInstance(f.platform, accessory); t.after(() => gate.dispose());
  f.platform.instances = new Map([['ac', f.instance], ['gate', gate]]);
  const power = accessory.getService(f.S.Switch).getCharacteristic(f.C.On);
  f.readings.temperature = 30; await f.clock.tick(0); assert.deepEqual(f.sent, []);
  await power.set(true); assert.deepEqual(f.sent, []);
  await f.clock.tick(1000); assert.deepEqual(f.sent, ['24']);
  await power.set(false); f.readings.temperature = 24; await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['24']);
  assert.equal(f.get('TargetHeatingCoolingState'), 2);
});

test('virtual gate configuration rejects real commands, power probes and unsupported switch variants', t => {
  const f = fixture(t, 'lock');
  for (const config of [{ type: 'switch', virtual: 'true' },
    { type: 'switch', virtual: true, data: { on: 'on' } },
    { type: 'outlet', virtual: true, pingIPAddress: '192.0.2.1' },
    { type: 'switch-repeat', virtual: true }]) {
    const accessory = new f.Accessory('Invalid', 'invalid'); accessory.context.config = config;
    assert.throws(() => createAccessoryInstance(f.platform, accessory));
  }
  assert.equal(f.clock.timers.size, 0);
});
