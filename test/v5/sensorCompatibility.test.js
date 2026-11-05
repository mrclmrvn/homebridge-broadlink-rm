const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { SensorSource } = require('../../dist/accessories/sensorSource');
const { SensorAccessory } = require('../../dist/accessories/sensor');
const { fixture } = require('./helpers/timedFixture');
const flush = () => new Promise(resolve => setImmediate(resolve));
const w1 = (temperature, crc = 'YES') => `aa bb cc dd ee ff 00 11 22 : crc=22 ${crc}\naa bb cc dd ee ff 00 11 22 t=${temperature}\n`;

test('1-wire validates CRC, signed millidegrees and source units without falling back to the RM', async t => {
  let contents = w1(-12500);
  const paths = [];
  t.mock.method(fs, 'readFile', async (path, options) => { paths.push(path); assert.ok(options.signal); return contents; });
  const source = new SensorSource({ w1DeviceID: '28-000005e2fdc3', tempSourceUnits: 'f', temperatureAdjustment: 1 }, () => {
    throw new Error('Native fallback must not be called');
  });
  t.after(() => source.dispose());
  assert.equal(await source.read('temperature'), -11.5);
  assert.equal(paths[0], '/sys/bus/w1/devices/28-000005e2fdc3/w1_slave');
  assert.equal(source.temperatureOnly, true);
  contents = w1(25000, 'NO'); await assert.rejects(source.read('temperature'), /CRC/);
  contents = 'crc=22 YES\nno temperature'; await assert.rejects(source.read('temperature'), /Invalid 1-wire/);
  contents = w1(100001); await assert.rejects(source.read('temperature'), /range/);
  await assert.rejects(source.read('humidity'), /No humidity source/);
  await assert.rejects(source.read('battery'), /No battery source/);
});

test('1-wire aliases and IDs are validated before any file access', async t => {
  t.mock.method(fs, 'readFile', async () => w1(0));
  for (const id of ['../../etc/passwd', '28-test', '', true, null]) {
    assert.throws(() => new SensorSource({ w1DeviceID: id }, () => undefined), /w1Device/);
  }
  assert.throws(() => new SensorSource({ w1Device: true }, () => undefined), /w1Device/);
  const source = new SensorSource({ w1Device: '28-000005e2fdc3' }, () => undefined);
  t.after(() => source.dispose()); assert.equal(await source.read('temperature'), 0);
});

test('explicit pseudo temperatures support zero, stay Celsius and do not invent humidity or battery', async () => {
  const source = new SensorSource({ pseudoDeviceTemperature: 0, tempSourceUnits: 'f', temperatureAdjustment: 0.5 }, () => {
    throw new Error('Native fallback must not be called');
  });
  assert.equal(await source.read('temperature'), 0.5);
  await assert.rejects(source.read('humidity'), /No humidity source/);
  await assert.rejects(source.read('battery'), /No battery source/);
  source.dispose(); await assert.rejects(source.read('temperature'), /closed/);
  for (const value of [NaN, Infinity, null, '25', -271, 101]) {
    assert.throws(() => new SensorSource({ pseudoDeviceTemperature: value }, () => undefined), /pseudoDeviceTemperature/);
  }
});

test('source precedence is explicit and higher-priority failures never fall back', async t => {
  const calls = [];
  t.mock.method(fs, 'readFile', async path => { calls.push(path); return path === 'temperature' ? '70' : w1(99999); });
  const source = new SensorSource({ temperatureFilePath: 'temperature', w1DeviceID: '28-000005e2fdc3', tempSourceUnits: 'f' }, () => undefined);
  assert.ok(Math.abs(await source.read('temperature') - 21.111111) < 0.00001);
  assert.deepEqual(calls, ['temperature']); source.dispose();
  const pseudo = new SensorSource({ pseudoDeviceTemperature: 23, temperatureFilePath: 'temperature' }, () => undefined);
  assert.equal(await pseudo.read('temperature'), 23); assert.deepEqual(calls, ['temperature']); pseudo.dispose();
  const mqtt = new SensorSource({ mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', temperatureFilePath: 'temperature' }, () => undefined);
  t.mock.method(require('mqtt').default, 'connect', () => new Client());
  await assert.rejects(mqtt.read('temperature'), /not connected/);
  assert.deepEqual(calls, ['temperature']); mqtt.dispose();
});

test('shutdown aborts an in-flight 1-wire read and blocks a late result', async t => {
  let signal, release;
  t.mock.method(fs, 'readFile', (path, options) => {
    signal = options.signal; return new Promise(resolve => { release = resolve; });
  });
  const source = new SensorSource({ w1DeviceID: '28-000005e2fdc3' }, () => undefined);
  const pending = assert.rejects(source.read('temperature'), /closed/);
  source.dispose(); assert.equal(signal.aborted, true);
  release(w1(25000)); await pending;
});

test('battery file data is independent, bounded and never inferred from a temperature scalar', async t => {
  let contents = '{"temperature":25,"humidity":50,"battery":0}';
  t.mock.method(fs, 'readFile', async () => contents);
  const source = new SensorSource({ temperatureFilePath: 'combined', temperatureAdjustment: 2, batteryAdjustment: 50 }, () => undefined);
  t.after(() => source.dispose());
  assert.equal(await source.read('battery'), 0);
  contents = 'temperature: 24\nbattery: 20.4'; assert.equal(await source.read('battery'), 20);
  contents = '25'; await assert.rejects(source.read('battery'), /No valid battery/);
  for (const value of [null, true, '50', -1, 101]) {
    contents = JSON.stringify({ battery: value }); await assert.rejects(source.read('battery'), /valid|range/);
  }
  const explicit = new SensorSource({ batteryFilePath: 'battery' }, () => undefined);
  contents = '100'; assert.equal(await explicit.read('battery'), 100); explicit.dispose();
});

class Client extends EventEmitter {
  subscribe(filters, options, callback) { callback(null, filters.map(topic => ({ topic, qos: 0 }))); }
  end(force, options, callback) { this.ended = true; callback?.(); }
  message(topic, value) { this.emit('message', topic, Buffer.from(value)); }
}

test('battery MQTT pushes low status with polling disabled, expires independently and reconnects fresh', async t => {
  const client = new Client(); t.mock.method(require('mqtt').default, 'connect', () => client);
  const f = fixture(t, 'temperatureSensor', { noHumidity: true, batteryAlerts: true, sensorPollInterval: 0,
    mqttURL: 'mqtt://broker.invalid', mqttMaxAge: 1, mqttTopic: [
      { identifier: 'temperature', topic: 'temperature' }, { identifier: 'battery', topic: 'battery', path: 'data.percent' },
    ] });
  const battery = f.accessory.getService(f.S.Battery);
  const level = battery.getCharacteristic(f.C.BatteryLevel);
  const low = battery.getCharacteristic(f.C.StatusLowBattery);
  client.emit('connect'); client.message('temperature', '23'); client.message('battery', '{"data":{"percent":20}}');
  await f.clock.tick(0);
  assert.equal(level.value, 20); assert.equal(low.value, 1);
  await f.clock.tick(500); client.message('temperature', '24'); await f.clock.tick(500);
  assert.ok(level.value instanceof Error); assert.equal(await f.get('CurrentTemperature'), 24);
  client.message('battery', '{"data":{"percent":75}}'); await flush();
  assert.equal(await level.get(), 75); assert.equal(await low.get(), 0);
  for (const invalid of ['true', 'null', '200', '"bad"']) {
    client.message('battery', `{"data":{"percent":${invalid}}}`); await flush();
    assert.ok(level.value instanceof Error);
  }
  client.emit('close'); await assert.rejects(level.get(), /not connected/);
  client.emit('connect'); await assert.rejects(level.get(), /No MQTT/);
  client.message('battery', '{"data":{"percent":0}}'); await flush(); assert.equal(level.value, 0);
  assert.throws(() => battery.getCharacteristic(f.C.ChargingState).get(), /unavailable/);
  f.instance.dispose(); assert.equal(client.ended, true); assert.equal(f.clock.timers.size, 0);
});

test('combined MQTT battery aliases preserve climate values and clear malformed battery alone', async t => {
  const client = new Client(); t.mock.method(require('mqtt').default, 'connect', () => client);
  const source = new SensorSource({ mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0 }, () => undefined);
  source.onUpdate(() => {}); t.after(() => source.dispose()); client.emit('connect');
  client.message('room', '{"temperature":24,"humidity":50,"BatteryPercentage":15}');
  assert.equal(await source.read('battery'), 15);
  client.message('room', '{"battery":null}'); await assert.rejects(source.read('battery'), /Invalid/);
  assert.equal(await source.read('temperature'), 24); assert.equal(await source.read('humidity'), 50);
});

test('battery-only MQTT updates do not read humidity or transmit appliance commands', async t => {
  const client = new Client(); t.mock.method(require('mqtt').default, 'connect', () => client);
  const original = SensorSource.prototype.read;
  const reads = [];
  t.mock.method(SensorSource.prototype, 'read', function (quantity) { reads.push(quantity); return original.call(this, quantity); });
  const f = fixture(t, 'humidifier-dehumidifier', { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0,
    sensorPollInterval: 0, batteryAlerts: true, data: { on: 'on', off: 'off', targetStateHumidifier: 'humidify' } });
  client.emit('connect'); client.message('room', '{"humidity":30,"battery":50}'); await f.clock.tick(0);
  await f.set('Active', 1);
  const count = reads.filter(quantity => quantity === 'humidity').length;
  const sent = [...f.sent];
  client.message('room', '{"battery":20}'); await f.clock.tick(0); await flush();
  assert.equal(reads.filter(quantity => quantity === 'humidity').length, count);
  assert.deepEqual(f.sent, sent);
  assert.equal(f.accessory.getService(f.S.Battery).getCharacteristic(f.C.StatusLowBattery).value, 1);
});

test('standalone pseudo/1-wire sensors omit default humidity and remove optional battery on reconfiguration', async t => {
  const f = fixture(t, 'temperatureSensor', { pseudoDeviceTemperature: 22, batteryAlerts: true, sensorPollInterval: 0 });
  assert.equal(await f.get('CurrentTemperature'), 22);
  assert.equal(f.accessory.getService(f.S.HumiditySensor), undefined);
  const battery = f.accessory.getService(f.S.Battery);
  await assert.rejects(battery.getCharacteristic(f.C.BatteryLevel).get(), /No battery source/);
  f.instance.dispose(); f.config.batteryAlerts = false;
  const replacement = new SensorAccessory(f.platform, f.accessory); t.after(() => replacement.dispose());
  assert.equal(f.accessory.getService(f.S.Battery), undefined);
});

test('1-wire and battery sources work across Thermostat, HeaterCooler and humidity controllers', async t => {
  t.mock.method(fs, 'readFile', async path => path.endsWith('/w1_slave') ? w1(22500) : '{"humidity":30,"battery":10}');
  // One fixture supplies the clock and HAP mocks for all three controllers.
  const f = fixture(t, 'air-conditioner', { w1DeviceID: '28-000005e2fdc3', batteryFilePath: 'battery', batteryAlerts: true, sensorPollInterval: 1 });
  await f.clock.tick(0); await flush();
  assert.equal(await f.get('CurrentTemperature'), 22.5);
  assert.equal(f.accessory.getService(f.S.HumiditySensor), undefined);
  assert.equal(f.accessory.getService(f.S.Battery).getCharacteristic(f.C.BatteryLevel).value, 10);
  const { createAccessoryInstance } = require('../../dist/accessories');
  for (const type of ['heater-cooler', 'humidifier-dehumidifier']) {
    const accessory = new f.Accessory(type, type);
    accessory.context.config = { type, w1DeviceID: '28-000005e2fdc3', humidityFilePath: 'battery', batteryAlerts: true, sensorPollInterval: 0,
      data: { cool: { on: 'on', off: 'off' } } };
    const instance = createAccessoryInstance(f.platform, accessory); t.after(() => instance.dispose());
    const service = accessory.getService(type === 'heater-cooler' ? f.S.HeaterCooler : f.S.HumidifierDehumidifier);
    assert.equal(await service.getCharacteristic(type === 'heater-cooler' ? f.C.CurrentTemperature : f.C.CurrentRelativeHumidity).get(), type === 'heater-cooler' ? 22.5 : 30);
    assert.equal(await accessory.getService(f.S.Battery).getCharacteristic(f.C.BatteryLevel).get(), 10);
  }
});

test('real HAP battery service exposes valid levels and low status without warnings', async t => {
  const hap = require('@homebridge/hap-nodejs');
  const { createAccessoryInstance } = require('../../dist/accessories');
  t.mock.method(fs, 'readFile', async () => '{"battery":19.6}');
  const warnings = [];
  const accessory = new hap.Accessory('Room', hap.uuid.generate('sensor-battery-test'));
  accessory.context = { config: { type: 'temperatureSensor', pseudoDeviceTemperature: 22,
    batteryAlerts: true, batteryFilePath: 'battery', sensorPollInterval: 0 } };
  accessory.on('characteristic-warning', warning => warnings.push(warning.message));
  const platform = { Service: hap.Service, Characteristic: hap.Characteristic, log: {}, deviceManager: { getDevice() {} } };
  const instance = createAccessoryInstance(platform, accessory); t.after(() => instance.dispose());
  const battery = accessory.getService(hap.Service.Battery);
  assert.equal(await battery.getCharacteristic(hap.Characteristic.BatteryLevel).handleGetRequest(), 20);
  assert.equal(await battery.getCharacteristic(hap.Characteristic.StatusLowBattery).handleGetRequest(), 1);
  assert.equal(accessory.getService(hap.Service.HumiditySensor), undefined);
  assert.deepEqual(warnings, []);
});
