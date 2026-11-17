const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectTemperatureCode } = require('../../dist/helpers/thermostatCodes');
const { createAccessoryInstance } = require('../../dist/accessories');
const { fixture } = require('./helpers/timedFixture');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('automatic cool-only tile compatibility accepts a real client Heat write and sends only retained Cool codes', async t => {
  const hap = require('./helpers/homebridgeRuntime').hap;
  const timers = new Map();
  t.mock.method(global, 'setTimeout', (callback, delay) => { const handle = { unref() { return this; } }; timers.set(handle, callback); return handle; });
  t.mock.method(global, 'clearTimeout', handle => timers.delete(handle));
  const accessory = new hap.Accessory('AC', hap.uuid.generate('cool-only-tile-write'));
  accessory.context = { config: { name: 'AC', type: 'air-conditioner', coolOnly: true,
    sensorPollInterval: 0, noHumidity: true, defaultCoolTemperature: 25,
    turnOnWhenOff: true, onDelay: 0,
    data: { on: 'on', off: 'off', cool23: 'cool23', cool25: 'cool25', heat23: 'must-not-send' } } };
  const sent = [], logs = [], warnings = [];
  accessory.on('characteristic-warning', warning => warnings.push(warning.message));
  const platform = { Service: hap.Service, Characteristic: hap.Characteristic,
    log: { info: m => logs.push(m), debug() {}, warn() {}, error() {} }, updateAccessoryContext() {},
    deviceManager: { getDevice: () => ({ async sendData(code) { sent.push(code); } }) } };
  const controller = createAccessoryInstance(platform, accessory); t.after(() => controller.dispose());
  const service = accessory.getService(hap.Service.Thermostat);
  const mode = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
  const temperature = service.getCharacteristic(hap.Characteristic.TargetTemperature);
  assert.deepEqual(mode.props.validValues, [0, 1, 2]);
  assert.equal(mode.props.maxValue, 2);
  // The actual iOS request from the field: value 1 with real client validation.
  await mode.handleSetRequest(1, {});
  assert.deepEqual(sent, ['on', 'cool25']);
  for (const [timer, callback] of [...timers]) { timers.delete(timer); callback(); }
  await flush();
  assert.equal(mode.value, 2, 'normalization must overwrite the incoming Heat value after HAP caches it');
  assert.equal(await mode.handleGetRequest(), 2);
  await temperature.handleSetRequest(23, {});
  await mode.handleSetRequest(0, {});
  const before = sent.length;
  await mode.handleSetRequest(1, {});
  assert.deepEqual(sent.slice(before), ['on', 'cool23']);
  assert.equal(accessory.context.broadlinkRMState.targetHeatingCoolingState, 2);
  assert.equal(accessory.context.broadlinkRMState.targetTemperature, 23);
  assert.equal(await service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).handleGetRequest(), 2);
  assert.ok(logs.some(message => message.includes('routing Heat request to Cool')));
  assert.ok(!sent.includes('must-not-send'));
  assert.deepEqual(warnings, []);
});

test('Heat remains a real Heat request for heat-only and combined-mode ACs', async t => {
  for (const options of [{ heatOnly: true }, {}]) await t.test(JSON.stringify(options), async t => {
    const f = fixture(t, 'air-conditioner', { ...options, sensorPollInterval: 0,
      data: { heat24: 'heat24', heat23: 'heat23', cool24: 'must-not-send', off: 'off' } });
    await f.set('TargetHeatingCoolingState', 1);
    assert.deepEqual(f.sent, ['heat24']);
    assert.equal(f.get('TargetHeatingCoolingState'), 1);
    await f.set('TargetTemperature', 23);
    await f.set('TargetHeatingCoolingState', 0);
    assert.equal(f.get('TargetHeatingCoolingState'), 0);
    await f.set('TargetHeatingCoolingState', 1);
    assert.deepEqual(f.sent, ['heat24', 'heat23', 'off', 'heat23']);
    assert.equal(f.get('TargetHeatingCoolingState'), 1);
    assert.equal(f.get('TargetTemperature'), 23);
  });
});

test('Thermostat advertises bounds matching supported modes and accepts a real client Cool write', async t => {
  const hap = require('./helpers/homebridgeRuntime').hap;
  const cases = [
    [{ coolOnly: true }, [0, 1, 2], 2],
    [{ heatOnly: true }, [0, 1], 1],
    [{}, [0, 1, 2], 2],
    [{ data: { auto24: 'auto24' } }, [0, 1, 2, 3], 3],
    [{ coolOnly: true, replaceAutoMode: 'cool' }, [0, 1, 2, 3], 3],
  ];
  for (const [options, modes, maximum] of cases) {
    const accessory = new hap.Accessory('AC', hap.uuid.generate(JSON.stringify(options)));
    accessory.context = { config: { name: 'AC', type: 'air-conditioner', sensorPollInterval: 0,
      noHumidity: true, turnOnWhenOff: true, onDelay: 0,
      data: { on: 'on', cool24: 'cool24', off: 'off' }, ...options } };
    const sent = [], logs = [];
    const platform = { Service: hap.Service, Characteristic: hap.Characteristic,
      log: { info: message => logs.push(message), debug() {}, warn() {}, error() {} }, updateAccessoryContext() {},
      deviceManager: { getDevice: () => ({ async sendData(code) { sent.push(code); } }) } };
    const controller = createAccessoryInstance(platform, accessory); t.after(() => controller.dispose());
    const mode = accessory.getService(hap.Service.Thermostat).getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
    assert.deepEqual(mode.props.validValues, modes);
    assert.equal(mode.props.minValue, 0);
    assert.equal(mode.props.maxValue, maximum);
    if (options.coolOnly && !options.replaceAutoMode) {
      // A client write is validated before onSet, unlike Homebridge's setValue.
      await assert.rejects(mode.handleSetRequest(3, {}), error => error === hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
      assert.deepEqual(logs, []);
      assert.deepEqual(sent, []);
      await mode.handleSetRequest(2, {});
      assert.deepEqual(sent, ['on', 'cool24']);
      assert.equal(await mode.handleGetRequest(), 2);
    }
  }
});

test('legacy sparse-map fallback follows the requested-temperature threshold rather than active mode', () => {
  const config = { fallbackToDefaultTemperature: 'legacy', data: {
    temperature16: 'low', temperature30: 'high', cool30: 'mode-default-is-not-legacy-fallback',
  } };
  for (const [mode, request, expected, code] of [
    ['cool', 21, 16, 'low'], ['cool', 22, 30, 'high'],
    ['heat', 21, 16, 'low'], ['heat', 24, 30, 'high'], ['auto', 25, 30, 'high'],
  ]) assert.deepEqual(selectTemperatureCode(config, mode, request, 24), { temperature: expected, code });
  config.heatTemperature = 25;
  assert.deepEqual(selectTemperatureCode(config, 'heat', 24, 24), { temperature: 16, code: 'low' });
  assert.deepEqual(selectTemperatureCode(config, 'cool', 25, 24), { temperature: 30, code: 'high' });
});

test('exact mode and generic entries precede fallback and retain structured metadata', () => {
  const exact = { data: 'exact', 'pseudo-mode': 'cool', sendCount: 2 };
  const config = { fallbackToDefaultTemperature: 'legacy', data: {
    cool23: exact, temperature23: 'generic23', temperature16: 'low', temperature30: 'high',
  } };
  assert.equal(selectTemperatureCode(config, 'cool', 23, 24).code, exact);
  assert.deepEqual(selectTemperatureCode(config, 'heat', 23, 24), { temperature: 23, code: 'generic23' });
  config.fallbackToDefaultTemperature = false;
  assert.equal(selectTemperatureCode(config, 'heat', 24, 24), undefined);
});

test('legacy fallback commits the temperature and pseudo-mode actually encoded and persists the accepted target', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, fallbackToDefaultTemperature: 'legacy',
    defaultCoolTemperature: 16, defaultHeatTemperature: 30,
    data: { temperature16: { data: '16', 'pseudo-mode': 'cool' },
      temperature30: { data: '30', 'pseudo-mode': 'heat' }, cool30: 'not-the-generic-fallback' } });
  await f.set('TargetTemperature', 21); await f.set('TargetHeatingCoolingState', 2);
  assert.equal(f.get('TargetTemperature'), 16); assert.equal(f.get('TargetHeatingCoolingState'), 2);
  await f.set('TargetTemperature', 22);
  assert.equal(f.get('TargetTemperature'), 30); assert.equal(f.get('TargetHeatingCoolingState'), 1);
  assert.deepEqual(f.sent, ['16', '30']);
  assert.deepEqual(f.accessory.context.broadlinkRMState, { targetTemperature: 30, targetHeatingCoolingState: 1, lastMode: 1 });
});

test('an enabled but missing fallback cannot silently send On or a mode command', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, fallbackToDefaultTemperature: true,
    turnOnWhenOff: true, defaultCoolTemperature: 25, data: { on: 'on', cool: 'cool-mode' } });
  for (const policy of [true, 'legacy']) {
    f.config.fallbackToDefaultTemperature = policy;
    await assert.rejects(f.set('TargetHeatingCoolingState', 2), /No IR\/RF fallback code/);
    assert.deepEqual(f.sent, []); assert.equal(f.get('TargetHeatingCoolingState'), 0);
  }
});

test('legacy fallback rejects absent generic keys, invalid bounds and incompatible steps', () => {
  assert.throws(() => selectTemperatureCode({ fallbackToDefaultTemperature: 'legacy', data: { cool30: 'cool30' } }, 'cool', 24, 24), /fallback code/);
  assert.throws(() => selectTemperatureCode({ fallbackToDefaultTemperature: 'legacy', maxTemperature: 28, data: { temperature30: '30' } }, 'cool', 24, 24), /range or step/);
  assert.throws(() => selectTemperatureCode({ fallbackToDefaultTemperature: 'legacy', tempStepSize: 3, data: { temperature30: '30' } }, 'heat', 24, 24), /range or step/);
});

test('legacy fallback cannot override ambient mode restrictions or begin a wrong-mode command plan', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 1, fallbackToDefaultTemperature: 'legacy',
    autoCoolTemperature: 26, turnOnWhenOff: true,
    data: { on: 'on', temperature30: { data: 'heat30', 'pseudo-mode': 'heat' } } });
  f.readings.temperature = 30; await f.clock.tick(0);
  assert.deepEqual(f.sent, []); assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.ok(f.errors.some(error => error.includes('metadata conflicts')));
});

test('Fahrenheit display configuration keeps sensor values, target keys and stored targets in Celsius', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, units: 'F', data: { cool18: '18' } });
  assert.equal(f.get('TemperatureDisplayUnits'), f.C.TemperatureDisplayUnits.FAHRENHEIT);
  assert.equal(await f.get('CurrentTemperature'), 24);
  await f.set('TargetTemperature', 18); await f.set('TargetHeatingCoolingState', 2);
  assert.deepEqual(f.sent, ['18']); assert.equal(f.get('TargetTemperature'), 18);
  assert.equal(f.accessory.context.broadlinkRMState.targetTemperature, 18);
});

test('nested AC user sequences retain their default gaps even when controller stage delays are zero', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, turnOnWhenOff: true,
    onDelay: 0, modeChangeDelay: 0, data: { on: 'on', cool: 'mode', cool24: ['first', 'second'] } });
  const command = f.set('TargetHeatingCoolingState', 2);
  await flush(); assert.deepEqual(f.sent, ['on', 'mode', 'first']);
  await f.clock.tick(99); assert.deepEqual(f.sent, ['on', 'mode', 'first']);
  await f.clock.tick(1); await command;
  assert.deepEqual(f.sent, ['on', 'mode', 'first', 'second']);
});

test('the complete AC plan has one aggregate expansion limit before any stage sends', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, turnOnWhenOff: true, onDelay: 0,
    data: { on: { data: 'on', sendCount: 5000, interval: 0 }, cool24: { data: '24', sendCount: 5001, interval: 0 } } });
  await assert.rejects(f.set('TargetHeatingCoolingState', 2), /too long/);
  assert.deepEqual(f.sent, []); assert.equal(f.get('TargetHeatingCoolingState'), 0);
});

test('invalid fallback policies, threshold values and display-unit settings fail before startup work', t => {
  const f = fixture(t, 'lock');
  for (const options of [{ fallbackToDefaultTemperature: 'guess' }, { heatTemperature: NaN },
    { heatTemperature: '22' }, { units: 'kelvin' }, { persistState: 'false' },
    { tempStepSize: 3 }, { tempStepSize: 3, defaultCoolTemperature: 25, defaultHeatTemperature: 29 }]) {
    const accessory = new f.Accessory('Invalid', 'invalid');
    accessory.context.config = { type: 'air-conditioner', sensorPollInterval: 0, ...options };
    assert.throws(() => createAccessoryInstance(f.platform, accessory));
  }
  assert.equal(f.clock.timers.size, 0);
});

test('legacy persistState false ignores saved targets and skips cache writes while preserving runtime control', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, persistState: false,
    defaultCoolTemperature: 25, data: { cool18: '18' } });
  const save = t.mock.method(f.platform, 'updateAccessoryContext', () => {});
  await f.set('TargetTemperature', 18); await f.set('TargetHeatingCoolingState', 2);
  assert.deepEqual(f.sent, ['18']); assert.equal(save.mock.callCount(), 0);
  assert.equal(f.accessory.context.broadlinkRMState, undefined);
  f.instance.dispose();
  f.accessory.context.broadlinkRMState = { targetTemperature: 18, targetHeatingCoolingState: 2, lastMode: 2 };
  const replacement = createAccessoryInstance(f.platform, f.accessory); t.after(() => replacement.dispose());
  assert.equal(f.get('TargetTemperature'), 25); assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.equal(save.mock.callCount(), 0);
});

test('AC cache validates modes against current configuration and accepts older target-only snapshots', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, coolOnly: true, defaultCoolTemperature: 25 });
  const cases = [
    [{ targetTemperature: 23, targetHeatingCoolingState: 2, lastMode: 2 }, 23, 2],
    [{ targetTemperature: 23 }, 23, 0],
    [{ targetTemperature: 23, targetHeatingCoolingState: 1, lastMode: 1 }, 23, 0],
    [{ targetTemperature: 23, targetHeatingCoolingState: '2', lastMode: '2' }, 23, 0],
    [{ targetTemperature: 99, targetHeatingCoolingState: 7 }, 25, 0],
    [null, 25, 0],
  ];
  f.instance.dispose();
  for (const [saved, target, mode] of cases) {
    f.accessory.context.broadlinkRMState = saved;
    const restored = createAccessoryInstance(f.platform, f.accessory);
    assert.equal(f.get('TargetTemperature'), target);
    assert.equal(f.get('TargetHeatingCoolingState'), mode);
    assert.equal(f.get('CurrentHeatingCoolingState'), mode);
    assert.deepEqual(f.sent, []);
    restored.dispose();
  }
});

test('restored Off remembers the last Heat mode for an explicit off-state activation policy', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0, ignoreTemperatureWhenOff: false,
    defaultMode: 'cool', data: { heat24: 'heat24', cool24: 'cool24', off: 'off' } });
  f.instance.dispose();
  f.accessory.context.broadlinkRMState = { targetTemperature: 23, targetHeatingCoolingState: 0, lastMode: 1 };
  const restored = createAccessoryInstance(f.platform, f.accessory); t.after(() => restored.dispose());
  assert.deepEqual(f.sent, []);
  await f.set('TargetTemperature', 24);
  assert.deepEqual(f.sent, ['heat24']);
  assert.equal(f.get('TargetHeatingCoolingState'), 1);
});

test('restored Auto retains unknown current activity, and restoration never arms power timers', async t => {
  const f = fixture(t, 'air-conditioner', { sensorPollInterval: 0,
    enableAutoOff: true, enableAutoOn: true, onDuration: 1, offDuration: 1,
    data: { auto24: 'auto24', cool24: 'cool24', off: 'off' } });
  f.instance.dispose();
  f.accessory.context.broadlinkRMState = { targetTemperature: 24, targetHeatingCoolingState: 3, lastMode: 3 };
  const restored = createAccessoryInstance(f.platform, f.accessory); t.after(() => restored.dispose());
  assert.equal(f.get('TargetHeatingCoolingState'), 3);
  assert.throws(() => f.get('CurrentHeatingCoolingState'), /Auto activity is unavailable/);
  await f.clock.tick(2000);
  assert.deepEqual(f.sent, []);
  assert.equal(f.clock.timers.size, 0);
});
