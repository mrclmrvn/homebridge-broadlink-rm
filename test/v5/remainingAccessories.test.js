const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fixture } = require('./helpers/timedFixture');
const { SensorSource } = require('../../dist/accessories/sensorSource');
const { createAccessoryInstance } = require('../../dist/accessories');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('outlet uses an Outlet service and failed sends preserve inferred power/use', async t => {
  const f = fixture(t, 'outlet', { data: { on: 'on', off: 'off' } });
  assert.ok(f.accessory.getService(f.S.Outlet));
  await f.set('On', true);
  assert.equal(f.get('OutletInUse'), true);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('On', false), /offline/);
  assert.equal(f.get('On'), true);
  assert.equal(f.get('OutletInUse'), true);
});

test('window and fanv1 expose their own HomeKit service and power characteristics', async t => {
  const f = fixture(t, 'fanv1', { data: { on: 'on', off: 'off', fanSpeed50: 'half', fanSpeed100: 'full' } });
  assert.ok(f.accessory.getService(f.S.Fan));
  await f.set('RotationSpeed', 60);
  assert.equal(f.get('On'), true);
  assert.deepEqual(f.sent, ['on', 'half']);
  await f.set('On', false);
  assert.equal(f.get('RotationSpeed'), 0);
  f.accessory.context.config = { type: 'window', totalDurationOpen: 1, totalDurationClose: 1, initialDelay: 0, data: { open: 'open' } };
  const window = createAccessoryInstance(f.platform, f.accessory);
  t.after(() => window.dispose());
  assert.ok(f.accessory.getService(f.S.Window));
  await f.accessory.getService(f.S.Window).getCharacteristic(f.C.TargetPosition).set(100);
  await f.clock.tick(1000);
  assert.equal(f.accessory.getService(f.S.Window).getCharacteristic(f.C.CurrentPosition).get(), 100);
});

test('switch variants execute multi/repeat sequences and cancel delays on disposal', async t => {
  const f = fixture(t, 'switch-multi-repeat', { interval: 0, data: [
    { data: 'a', sendCount: 2, interval: 0.1, pause: 0.2 }, { data: 'b', sendCount: 1 },
  ] });
  const on = f.set('On', true);
  await flush();
  assert.deepEqual(f.sent, ['a']);
  await f.clock.tick(100);
  assert.deepEqual(f.sent, ['a', 'a']);
  await f.clock.tick(200);
  await on;
  assert.deepEqual(f.sent, ['a', 'a', 'b']);
  await f.set('On', false);
  assert.equal(f.get('On'), false);
  const again = f.set('On', true);
  await flush();
  f.instance.dispose();
  await assert.rejects(again, /shut down/);
  assert.equal(f.clock.timers.size, 0);
});

test('switch-repeat honors per-state counts and validates a whole sequence before sending', async t => {
  const f = fixture(t, 'switch-repeat', { interval: 0, onSendCount: 3, offSendCount: 2, data: { on: 'on', off: 'off' } });
  await f.set('On', true);
  await f.set('On', false);
  assert.deepEqual(f.sent, ['on', 'on', 'on', 'off', 'off']);
  f.config.data.on = ['valid', { data: 'invalid', sendCount: -1 }];
  await assert.rejects(f.set('On', true), /sendCount/);
  assert.equal(f.sent.length, 5);
  assert.equal(f.get('On'), false);
});

test('switch auto-off transmits off, while stateless buttons reset locally', async t => {
  const f = fixture(t, 'switch', { enableAutoOff: true, onDuration: 1, data: { on: 'on', off: 'off' } });
  await f.set('On', true);
  await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['on', 'off']);
  assert.equal(f.get('On'), false);
  f.config.enableAutoOff = false;
  f.config.stateless = true;
  await f.set('On', true);
  await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['on', 'off', 'on']);
  assert.equal(f.get('On'), false);
});

test('purifier supports manual/auto, speed, swing and control lock with inferred current state', async t => {
  const f = fixture(t, 'air-purifier', { data: { on: 'on', off: 'off', targetStateManual: 'manual',
    targetStateAuto: 'auto', fanSpeed50: 'half', swingToggle: 'swing', lockControls: 'lock', unlockControls: 'unlock' } });
  await f.set('Active', 1);
  assert.equal(f.get('CurrentAirPurifierState'), 2);
  await f.set('TargetAirPurifierState', 1);
  await f.set('RotationSpeed', 60);
  await f.set('SwingMode', 1);
  await f.set('LockPhysicalControls', 1);
  await f.set('Active', 0);
  assert.equal(f.get('CurrentAirPurifierState'), 0);
  assert.deepEqual(f.sent, ['on', 'auto', 'half', 'swing', 'lock', 'off']);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('TargetAirPurifierState', 0), /offline/);
  assert.equal(f.get('TargetAirPurifierState'), 1);
});

test('humidifier Auto selects humidify/idle/dehumidify from measured humidity and thresholds', async t => {
  const f = fixture(t, 'humidifier-dehumidifier', { humidityUpdateFrequency: 1,
    data: { on: 'on', off: 'off', targetStateHumidifier: 'humidify', targetStateDehumidifier: 'dry', fanOnly: 'idle' } });
  f.readings.humidity = 30;
  await f.set('Active', 1);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 2);
  await f.clock.tick(0);
  f.readings.humidity = 50;
  await f.clock.tick(1000);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 1);
  f.readings.humidity = 70;
  await f.clock.tick(1000);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 3);
  await f.set('TargetHumidifierDehumidifierState', 1);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 1);
  await assert.rejects(f.set('RelativeHumidityHumidifierThreshold', 90), /must not exceed/);
  await f.set('Active', 0);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 0);
  assert.deepEqual(f.sent, ['on', 'humidify', 'idle', 'dry', 'idle', 'off']);
});

test('manual humidity mode needs no sensor, restricts Auto and retains mode after a failed send', async t => {
  const f = fixture(t, 'humidifier-dehumidifier', { noHumidity: true, data: {
    on: 'on', off: 'off', targetStateHumidifier: 'humidify', targetStateDehumidifier: 'dry',
  } });
  assert.deepEqual(f.control('TargetHumidifierDehumidifierState').props.validValues, [1, 2]);
  await f.set('Active', 1);
  assert.deepEqual(f.sent, ['on', 'humidify']);
  await assert.rejects(f.set('TargetHumidifierDehumidifierState', 0), /Unsupported/);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('TargetHumidifierDehumidifierState', 2), /offline/);
  assert.equal(f.get('TargetHumidifierDehumidifierState'), 1);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 2);
  assert.equal(f.clock.timers.size, 0);
});

test('sensor types poll native readings, apply adjustment and expose errors instead of zero', async t => {
  const f = fixture(t, 'temperatureSensor', { temperatureAdjustment: 1, humidityAdjustment: -2, sensorPollInterval: 1 });
  assert.equal(await f.get('CurrentTemperature'), 25);
  const humidity = f.accessory.getService(f.S.HumiditySensor);
  assert.equal(await humidity.getCharacteristic(f.C.CurrentRelativeHumidity).get(), 48);
  await f.clock.tick(0);
  assert.equal(f.control('CurrentTemperature').value, 25);
  f.readings.temperature = undefined;
  await assert.rejects(f.get('CurrentTemperature'), /No valid temperature/);
  await f.clock.tick(1000);
  assert.ok(f.control('CurrentTemperature').value instanceof Error);
  f.instance.dispose();
  assert.equal(f.clock.timers.size, 0);
});

test('sensor files support JSON, line values, plain numbers and Fahrenheit conversion', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'broadlink-sensors-'));
  t.after(() => rm(dir, { recursive: true }));
  const path = join(dir, 'reading.txt');
  const source = new SensorSource({ temperatureFilePath: path, tempSourceUnits: 'f' }, () => undefined);
  await writeFile(path, '{"temperature":77,"humidity":45}');
  assert.equal(await source.read('temperature'), 25);
  assert.equal(await source.read('humidity'), 45);
  await writeFile(path, 'temperature: 68\nhumidity: 55');
  assert.equal(await source.read('temperature'), 20);
  assert.equal(await source.read('humidity'), 55);
  await writeFile(path, '77');
  assert.equal(await source.read('temperature'), 25);
  await assert.rejects(source.read('humidity'), /No valid humidity/);
  await writeFile(path, '');
  await assert.rejects(source.read('temperature'), /Empty/);
  await writeFile(path, '{"humidity":120}');
  await assert.rejects(source.read('humidity'), /outside/);
});

test('HeaterCooler uses mode/temperature/fan/swing codes and does not fall back to Thermostat', async t => {
  const f = fixture(t, 'heater-cooler', { sensorPollInterval: 0, data: {
    heat: { on: 'heat-on', off: 'heat-off', temperatureCodes: { 18: {
      rotationSpeed50: { swingOff: 'low', swingOn: 'low-swing' },
      rotationSpeed100: { swingOff: 'high', swingOn: 'high-swing' },
    } } }, cool: { on: 'cool-on', off: 'cool-off', temperatureCodes: { 24: 'cool24' } },
  } });
  assert.ok(f.accessory.getService(f.S.HeaterCooler));
  assert.equal(f.accessory.getService(f.S.Thermostat), undefined);
  await f.set('TargetHeaterCoolerState', 1);
  await f.set('Active', 1);
  await f.set('RotationSpeed', 40);
  assert.equal(f.get('RotationSpeed'), 50);
  await f.set('SwingMode', 1);
  await assert.rejects(f.set('HeatingThresholdTemperature', 19), /No HeaterCooler temperature code/);
  assert.equal(f.get('HeatingThresholdTemperature'), 18);
  await f.set('TargetHeaterCoolerState', 2);
  await f.set('Active', 0);
  assert.deepEqual(f.sent, ['heat-on', 'high', 'low', 'low-swing', 'cool-on', 'cool24', 'cool-off']);
  assert.equal(f.get('CurrentHeaterCoolerState'), 0);
  await assert.rejects(f.set('TargetHeaterCoolerState', 0), /Unsupported/);
});

test('HeaterCooler handles Fahrenheit config and defers off-state temperature changes', async t => {
  const f = fixture(t, 'heater-cooler', { sensorPollInterval: 0, temperatureUnits: 'f', minTemperature: 60, maxTemperature: 86,
    heatingThresholdTemperature: 68, turnOnWhenOff: false, data: { heat: { on: 'on', off: 'off', temperatureCodes: { 68: 'warm' } } } });
  assert.equal(f.get('HeatingThresholdTemperature'), 20);
  await f.set('HeatingThresholdTemperature', 20);
  assert.deepEqual(f.sent, []);
  await f.set('Active', 1);
  assert.deepEqual(f.sent, ['on', 'warm']);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(f.set('Active', 0), /offline/);
  assert.equal(f.get('Active'), 1);
});

test('humidifier activation within the target band sends idle and failed activation can retry', async t => {
  const f = fixture(t, 'humidifier-dehumidifier', { humidityUpdateFrequency: 0,
    data: { on: 'on', off: 'off', fanOnly: 'idle', targetStateHumidifier: 'humidify' } });
  await f.set('Active', 1);
  assert.deepEqual(f.sent, ['on', 'idle']);
  await f.set('Active', 0);
  f.readings.humidity = 30;
  f.device.sendData = async code => {
    if (code === 'humidify') throw new Error('offline');
    f.sent.push(code);
  };
  await assert.rejects(f.set('Active', 1), /offline/);
  assert.equal(f.get('Active'), 1);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 0);
  f.device.sendData = async code => { f.sent.push(code); };
  await f.set('Active', 1);
  assert.equal(f.get('CurrentHumidifierDehumidifierState'), 2);
  assert.equal(f.sent.at(-1), 'humidify');
});

test('remaining services construct with real HAP classes without characteristic warnings', () => {
  const hap = require('./helpers/homebridgeRuntime').hap;
  const warnings = [];
  const platform = { Service: hap.Service, Characteristic: hap.Characteristic,
    log: { debug() {}, warn() {}, error() {}, info() {} }, deviceManager: { getDevice() {} } };
  const types = ['outlet', 'window', 'fanv1', 'air-purifier', 'humidifier-dehumidifier', 'temperatureSensor',
    'humiditySensor', 'heater-cooler', 'switch-multi', 'switch-repeat', 'switch-multi-repeat'];
  for (const type of types) {
    const accessory = new hap.Accessory(type, hap.uuid.generate(type));
    accessory.context = { config: { name: type, type, totalDurationOpen: 10, totalDurationClose: 10,
      sensorPollInterval: 0, humidityUpdateFrequency: 0, noHumidity: true,
      data: { on: 'on', off: 'off', heat: { on: 'heat', off: 'off' } } } };
    accessory.on('characteristic-warning', warning => warnings.push(`${type}: ${warning.message}`));
    const instance = createAccessoryInstance(platform, accessory);
    assert.ok(instance, type);
    instance.dispose();
  }
  assert.deepEqual(warnings, []);
});

test('humidity-only sensor aliases read humidity and single-function appliance flags restrict modes', async t => {
  const f = fixture(t, 'humidity-sensor', { sensorPollInterval: 0 });
  assert.equal(await f.get('CurrentRelativeHumidity'), 50);
  assert.equal(f.accessory.getService(f.S.TemperatureSensor), undefined);
  f.accessory.context.config = { type: 'humidifier-dehumidifier', deHumidifierOnly: true, noHumidity: true,
    data: { on: 'on', off: 'off', targetStateDehumidifier: 'dry' } };
  const unit = createAccessoryInstance(f.platform, f.accessory);
  t.after(() => unit.dispose());
  const service = f.accessory.getService(f.S.HumidifierDehumidifier);
  assert.deepEqual(service.getCharacteristic(f.C.TargetHumidifierDehumidifierState).props.validValues, [2]);
  await service.getCharacteristic(f.C.Active).set(1);
  assert.deepEqual(f.sent, ['on', 'dry']);
  await assert.rejects(service.getCharacteristic(f.C.TargetHumidifierDehumidifierState).set(1), /Unsupported/);
});
