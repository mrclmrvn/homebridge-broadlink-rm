const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/timedFixture');
const { createAccessoryInstance } = require('../../dist/accessories');

function restore(t, f, config = {}) {
  // Capture before disposing: persistence must not depend on shutdown hooks.
  const saved = JSON.parse(JSON.stringify(f.accessory.context));
  f.instance.dispose();
  const accessory = new f.Accessory('Restored', f.accessory.UUID);
  accessory.context = saved;
  Object.assign(accessory.context.config, config);
  const before = f.sent.length;
  const instance = createAccessoryInstance(f.platform, accessory);
  t.after(() => instance.dispose());
  assert.equal(f.sent.length, before, 'restoration must not transmit');
  const service = accessory.services.find(s => s.UUID !== f.S.AccessoryInformation.UUID);
  return { accessory, instance, service,
    get: name => service.getCharacteristic(f.C[name]).get(),
    set: (name, value) => service.getCharacteristic(f.C[name]).set(value),
  };
}

test('switch variants and virtual gates restore their latch without resuming commands or timers', async t => {
  for (const type of ['switch', 'outlet', 'switch-multi', 'switch-repeat', 'switch-multi-repeat']) {
    await t.test(type, async t => {
      const f = fixture(t, type, { data: { on: 'on', off: 'off' }, enableAutoOff: true, onDuration: 1 });
      await f.set('On', true);
      const restored = restore(t, f);
      assert.equal(restored.get('On'), true);
      if (type === 'outlet') assert.equal(restored.get('OutletInUse'), true);
      const before = f.sent.length;
      await f.clock.tick(2000);
      assert.equal(f.sent.length, before);
      await restored.set('On', false);
      assert.equal(restored.accessory.context.broadlinkRMState.values.state, false);
    });
  }
  await t.test('virtual switch', async t => {
    const f = fixture(t, 'switch', { virtual: true, data: undefined });
    await f.set('On', true);
    const restored = restore(t, f);
    assert.equal(restored.instance.automationState('Test'), true);
    assert.deepEqual(f.sent, []);
  });
});

test('fans restore power, speed, direction and swing without recalibrating a relative speed cycle', async t => {
  for (const type of ['fan', 'fanv1']) await t.test(type, async t => {
    const f = fixture(t, type, { data: { on: 'on', off: 'off', fanSpeed33: 'low', fanSpeed66: 'medium',
      clockwise: 'cw', counterClockwise: 'ccw', swingOn: 'swing', swingOff: 'fixed' } });
    await f.set('RotationSpeed', 66);
    await f.set('RotationDirection', 1);
    if (type === 'fan') await f.set('SwingMode', 1);
    const restored = restore(t, f);
    assert.equal(restored.get(type === 'fanv1' ? 'On' : 'Active'), type === 'fanv1' ? true : 1);
    assert.equal(restored.get('RotationSpeed'), 66);
    assert.equal(restored.get('RotationDirection'), 1);
    if (type === 'fan') assert.equal(restored.get('SwingMode'), 1);
  });
  await t.test('relative cycle remains uncalibrated', async t => {
    const f = fixture(t, 'fan', { speedCycle: true, speedSteps: 3, speedCycleInterval: 0,
      data: { on: 'on', off: 'off', fanSpeed: 'step' } });
    await f.set('RotationSpeed', 66);
    const restored = restore(t, f);
    const before = f.sent.length;
    await assert.rejects(restored.set('RotationSpeed', 99), /cycle position is unknown/);
    assert.equal(f.sent.length, before);
  });
});

test('lights restore selected presets and last brightness while stateless lights stay Off', async t => {
  const f = fixture(t, 'light', { onDelay: 0, useLastKnownBrightness: true,
    data: { on: 'on', off: 'off', brightness25: 'dim', brightness75: 'bright', hue120: 'green', white: 'white', colorTemperature400: 'warm' } });
  await f.set('Brightness', 75); await f.set('Hue', 120); await f.set('ColorTemperature', 400);
  let restored = restore(t, f);
  assert.equal(restored.get('On'), true);
  assert.equal(restored.get('Brightness'), 75);
  assert.equal(restored.get('Hue'), 120);
  assert.equal(restored.get('ColorTemperature'), 400);
  await restored.set('On', false);
  const stopped = { ...f, accessory: restored.accessory, instance: restored.instance };
  restored = restore(t, stopped);
  assert.equal(restored.get('On'), false);
  await restored.set('On', true);
  assert.equal(f.sent.at(-1), 'bright');
  const stateless = restore(t, { ...f, accessory: restored.accessory, instance: restored.instance }, { stateless: true });
  assert.equal(stateless.get('On'), false);
  assert.equal(stateless.get('Brightness'), 0);
});

test('TV state retains input, mute and picture mode, and invalidates a reordered input map', async t => {
  const data = { on: 'on', off: 'off', inputs: [{ name: 'One', data: 'one' }, { name: 'Two', data: 'two' }],
    volume: { mute: 'mute' }, pictureMode: { standard: 'standard', game: 'game' } };
  const f = fixture(t, 'tv', { data });
  await f.set('Active', 1); await f.set('ActiveIdentifier', 1); await f.set('PictureMode', 5);
  await f.accessory.getService(f.S.TelevisionSpeaker).getCharacteristic(f.C.Mute).set(true);
  const restored = restore(t, f);
  assert.equal(restored.get('Active'), 1); assert.equal(restored.get('ActiveIdentifier'), 1);
  assert.equal(restored.get('PictureMode'), 5);
  assert.equal(restored.accessory.getService(f.S.TelevisionSpeaker).getCharacteristic(f.C.Mute).get(), true);
  const remapped = restore(t, { ...f, accessory: restored.accessory, instance: restored.instance },
    { data: { ...data, inputs: [...data.inputs].reverse(), pictureMode: { standard: 'standard' } } });
  assert.equal(remapped.get('ActiveIdentifier'), 0);
  assert.throws(() => remapped.get('PictureMode'), /not been selected/);
});

test('purifier and humidity controller retain modes, thresholds and optional control lock', async t => {
  await t.test('purifier', async t => {
    const f = fixture(t, 'air-purifier', { data: { on: 'on', off: 'off', targetStateAuto: 'auto',
      fanSpeed50: 'medium', lockControls: 'lock', unlockControls: 'unlock' } });
    await f.set('Active', 1); await f.set('TargetAirPurifierState', 1);
    await f.set('RotationSpeed', 50); await f.set('LockPhysicalControls', 1);
    const restored = restore(t, f);
    assert.equal(restored.get('Active'), 1); assert.equal(restored.get('TargetAirPurifierState'), 1);
    assert.equal(restored.get('RotationSpeed'), 50); assert.equal(restored.get('LockPhysicalControls'), 1);
    assert.equal(restored.get('CurrentAirPurifierState'), f.C.CurrentAirPurifierState.PURIFYING_AIR);
  });
  await t.test('humidity controller', async t => {
    const f = fixture(t, 'humidifier-dehumidifier', { sensorPollInterval: 0,
      data: { on: 'on', off: 'off', targetStateHumidifier: 'humidify', targetStateDehumidifier: 'dry' } });
    await f.set('RelativeHumidityHumidifierThreshold', 45);
    await f.set('RelativeHumidityDehumidifierThreshold', 65);
    await f.set('TargetHumidifierDehumidifierState', 1); await f.set('Active', 1);
    const restored = restore(t, f);
    assert.equal(restored.get('Active'), 1); assert.equal(restored.get('TargetHumidifierDehumidifierState'), 1);
    assert.equal(restored.get('RelativeHumidityHumidifierThreshold'), 45);
    assert.equal(restored.get('RelativeHumidityDehumidifierThreshold'), 65);
  });
});

test('HeaterCooler restores its mode and preset without treating a removed mode as active', async t => {
  const f = fixture(t, 'heater-cooler', { sensorPollInterval: 0, turnOnWhenOff: false,
    data: { heat: { on: 'heat', off: 'off' }, cool: { on: 'cool', off: 'off' } } });
  await f.set('HeatingThresholdTemperature', 20);
  await f.set('CoolingThresholdTemperature', 26);
  await f.set('TargetHeaterCoolerState', 1); await f.set('Active', 1);
  const restored = restore(t, f);
  assert.equal(restored.get('Active'), 1); assert.equal(restored.get('TargetHeaterCoolerState'), 1);
  assert.equal(restored.get('HeatingThresholdTemperature'), 20); assert.equal(restored.get('CoolingThresholdTemperature'), 26);
  const restricted = restore(t, { ...f, accessory: restored.accessory, instance: restored.instance },
    { data: { cool: { on: 'cool', off: 'off' } } });
  assert.equal(restricted.get('Active'), 0); assert.equal(restricted.get('TargetHeaterCoolerState'), 2);
});

test('lock/garage restore targets but never assert a physical locked/open state or resume transitions', async t => {
  for (const type of ['lock', 'garage-door-opener']) await t.test(type, async t => {
    const f = fixture(t, type, { lockDuration: 1, unlockDuration: 1, openDuration: 1, closeDuration: 1,
      autoLockDelay: 1, autoCloseDelay: 1 });
    await f.set(type === 'lock' ? 'LockTargetState' : 'TargetDoorState', 0);
    const restored = restore(t, f);
    assert.equal(restored.get(type === 'lock' ? 'LockTargetState' : 'TargetDoorState'), 0);
    assert.equal(restored.get(type === 'lock' ? 'LockCurrentState' : 'CurrentDoorState'),
      type === 'lock' ? f.C.LockCurrentState.UNKNOWN : f.C.CurrentDoorState.STOPPED);
    const before = f.sent.length; await f.clock.tick(5000);
    assert.equal(f.sent.length, before);
    assert.equal(f.clock.timers.size, 0);
  });
});

test('coverings restore completed positions; interrupted travel needs endpoint recalibration without replay', async t => {
  for (const type of ['window', 'window-covering']) await t.test(type, async t => {
    const f = fixture(t, type, { totalDurationOpen: 1, totalDurationClose: 1, initialDelay: 0 });
    await f.set('TargetPosition', 100); await f.clock.tick(1000);
    const stable = restore(t, f);
    assert.equal(stable.get('CurrentPosition'), 100); assert.equal(stable.get('TargetPosition'), 100);
    await stable.set('TargetPosition', 50);
    const interrupted = restore(t, { ...f, accessory: stable.accessory, instance: stable.instance });
    assert.equal(interrupted.get('PositionState'), f.C.PositionState.STOPPED);
    assert.throws(() => interrupted.get('CurrentPosition'), error => error === -70402);
    await assert.rejects(interrupted.set('TargetPosition', 50), /Recalibrate/);
    const before = f.sent.length; await f.clock.tick(2000); assert.equal(f.sent.length, before);
    await interrupted.set('TargetPosition', 0); await f.clock.tick(1000);
    assert.equal(interrupted.get('CurrentPosition'), 0);
    const again = restore(t, { ...f, accessory: interrupted.accessory, instance: interrupted.instance });
    assert.equal(again.get('CurrentPosition'), 0);
  });
});

test('disabled persistence, invalid cache and failed sends never replace a good snapshot', async t => {
  const f = fixture(t, 'switch', { data: { on: 'on', off: 'off' } });
  await f.set('On', true);
  const good = structuredClone(f.accessory.context.broadlinkRMState);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('On', false), /offline/);
  assert.deepEqual(f.accessory.context.broadlinkRMState, good);
  const disabled = restore(t, f, { persistState: false });
  assert.equal(disabled.get('On'), false);
  f.device.sendData = async () => {};
  await disabled.set('On', true);
  assert.deepEqual(disabled.accessory.context.broadlinkRMState, good);
  disabled.accessory.context.broadlinkRMState = { version: 1, kind: 'switch', values: { state: 'true', injected: true } };
  const invalid = restore(t, { ...f, accessory: disabled.accessory, instance: disabled.instance }, { persistState: true });
  assert.equal(invalid.get('On'), false);
  await invalid.set('On', true);
  assert.deepEqual(invalid.accessory.context.broadlinkRMState.values, { state: true });
});

test('momentary actions, learning and live telemetry do not restore active actions or cached readings', async t => {
  await t.test('momentary switch', async t => {
    const f = fixture(t, 'switch', { stateless: true, data: { on: 'on' } });
    await f.set('On', true);
    const restored = restore(t, f);
    assert.equal(restored.get('On'), false);
    const before = f.sent.length; await f.clock.tick(5000); assert.equal(f.sent.length, before);
  });
  for (const type of ['temperatureSensor', 'humiditySensor', 'learn-ir', 'learn-rf', 'learn-code']) await t.test(type, async t => {
    const f = fixture(t, type, { sensorPollInterval: 0 });
    const restored = restore(t, f);
    if (type.toLowerCase().includes('sensor')) {
      f.readings.temperature = 31; f.readings.humidity = 61;
      assert.equal(await restored.get(type === 'humiditySensor' ? 'CurrentRelativeHumidity' : 'CurrentTemperature'), type === 'humiditySensor' ? 61 : 31);
    } else assert.equal(restored.get('On'), false);
    assert.equal(restored.accessory.context.broadlinkRMState, undefined);
    assert.deepEqual(f.sent, []);
  });
});

test('persistState false disables restoration and writes across stateful families', async t => {
  const cases = [
    ['switch', { virtual: true, data: undefined }, 'On', true, 'state'],
    ['fan', { data: { on: 'on', off: 'off' } }, 'Active', 1, 'active'],
    ['light', { data: { on: 'on', off: 'off' } }, 'On', true, 'on'],
    ['tv', { data: { on: 'on', off: 'off' } }, 'Active', 1, 'active'],
    ['air-purifier', { data: { on: 'on', off: 'off' } }, 'Active', 1, 'active'],
    ['humidifier-dehumidifier', { noHumidity: true, sensorPollInterval: 0,
      data: { on: 'on', off: 'off', targetStateHumidifier: 'humidify' } }, 'Active', 1, 'active'],
    ['heater-cooler', { sensorPollInterval: 0, data: { cool: { on: 'on', off: 'off' } } }, 'Active', 1, 'active'],
    ['lock', {}, 'LockTargetState', 0, 'target'],
    ['garage-door-opener', {}, 'TargetDoorState', 0, 'target'],
    ['window-covering', { totalDurationOpen: 1, totalDurationClose: 1, initialDelay: 0 }, 'TargetPosition', 100, 'target'],
  ];
  for (const [type, config, control, value, field] of cases) await t.test(type, async t => {
    const f = fixture(t, type, config);
    await f.set(control, value);
    const snapshot = structuredClone(f.accessory.context.broadlinkRMState);
    assert.equal(snapshot.values[field], value);
    const restored = restore(t, f, { persistState: false });
    assert.notEqual(restored.get(control), value);
    await restored.set(control, value);
    assert.deepEqual(restored.accessory.context.broadlinkRMState, snapshot);
  });
});
