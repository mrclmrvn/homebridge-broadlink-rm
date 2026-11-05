const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectTemperatureCode } = require('../../dist/helpers/thermostatCodes');
const { createAccessoryInstance } = require('../../dist/accessories');
const { fixture } = require('./helpers/timedFixture');
const flush = () => new Promise(resolve => setImmediate(resolve));

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
  assert.deepEqual(f.accessory.context.broadlinkRMState, { targetTemperature: 30 });
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
  f.accessory.context.broadlinkRMState = { targetTemperature: 18 };
  const replacement = createAccessoryInstance(f.platform, f.accessory); t.after(() => replacement.dispose());
  assert.equal(f.get('TargetTemperature'), 25); assert.equal(f.get('TargetHeatingCoolingState'), 0);
  assert.equal(save.mock.callCount(), 0);
});
