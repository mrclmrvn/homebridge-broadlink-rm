const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { MQTTSensor, matchesTopic } = require('../../dist/sensors/mqtt');
const { SensorSource } = require('../../dist/accessories/sensorSource');
const { fixture } = require('./helpers/timedFixture');
const flush = () => new Promise(resolve => setImmediate(resolve));

class Client extends EventEmitter {
  connected = false;
  subscriptions = [];
  autoAck = true;
  ended = false;
  subscribe(filters, options, callback) {
    this.subscriptions.push(filters);
    this.ack = callback;
    if (this.autoAck) callback(null, filters.map(topic => ({ topic, qos: 0 })));
  }
  up() { this.connected = true; this.emit('connect'); }
  down() { this.connected = false; this.emit('close'); }
  message(topic, payload) { this.emit('message', topic, Buffer.from(payload)); }
  end(force, options, callback) { this.ended = true; this.connected = false; callback?.(); }
}
function sensor(t, config = {}) {
  const client = new Client();
  const connections = [];
  const source = new MQTTSensor({ mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0, ...config }, (url, options) => {
    connections.push({ url, options }); return client;
  });
  const updates = [];
  source.onUpdate(quantity => updates.push(quantity));
  t.after(() => source.dispose());
  return { source, client, connections, updates };
}
function interceptClient(t) {
  const client = new Client();
  t.mock.method(require('mqtt').default, 'connect', () => client);
  return client;
}

test('MQTT legacy topics support combined JSON, nested aliases, zero and partial messages', t => {
  const { source, client } = sensor(t);
  assert.throws(() => source.read('temperature'), /not connected/);
  client.up();
  assert.throws(() => source.read('temperature'), /No MQTT/);
  client.message('room', '{"temperature":21.5,"humidity":0}');
  assert.equal(source.read('temperature'), 21.5);
  assert.equal(source.read('humidity'), 0);
  client.message('room', '{"sensor":{"Temp":22,"RelativeHumidity":42}}');
  assert.equal(source.read('temperature'), 22);
  assert.equal(source.read('humidity'), 42);
  client.message('room', '{"temperature":23}');
  assert.equal(source.read('humidity'), 42);
  client.message('room', '{"battery":75}');
  assert.equal(source.read('temperature'), 23);
  client.message('unrelated', '10');
  assert.equal(source.read('temperature'), 23);
});

test('MQTT uses explicit identifiers and safe paths on shared topics and wildcard filters', t => {
  const { source, client } = sensor(t, { mqttTopic: [
    { identifier: 'temperature', topic: 'rooms/+/state', path: 'data.t' },
    { identifier: 'humidity', topic: 'rooms/+/state', path: 'data.h' },
  ] });
  client.up();
  assert.deepEqual(client.subscriptions[0], ['rooms/+/state']);
  client.message('rooms/bedroom/state', '{"data":{"t":"24.1","h":58}}');
  assert.equal(source.read('temperature'), 24.1);
  assert.equal(source.read('humidity'), 58);
  client.message('rooms/bedroom/state', '25');
  assert.throws(() => source.read('temperature'), /Invalid/);
  assert.equal(matchesTopic('room/#', 'room'), true);
  assert.equal(matchesTopic('room/+', 'room'), false);
  assert.equal(matchesTopic('#', '$SYS/status'), false);
});

test('malformed messages invalidate old values rather than becoming zero', t => {
  const { source, client } = sensor(t, { mqttTopic: [{ identifier: 'humidity', topic: 'humidity' }] });
  client.up();
  for (const invalid of ['', 'false', 'null', 'NaN', '12oops', '{}', '[]', '{"humidity":null}']) {
    client.message('humidity', '50');
    assert.equal(source.read('humidity'), 50);
    client.message('humidity', invalid);
    assert.throws(() => source.read('humidity'), /Invalid|No MQTT/);
  }
  client.message('humidity', '0');
  assert.equal(source.read('humidity'), 0);
});

test('disconnect and reconnect require fresh measurements and ignore stale subscription acknowledgments', t => {
  const { source, client } = sensor(t);
  client.up(); client.message('room', '21');
  assert.equal(source.read('temperature'), 21);
  client.down();
  assert.throws(() => source.read('temperature'), /not connected/);
  client.autoAck = false;
  client.up(); const oldAck = client.ack;
  client.down(); client.up();
  oldAck(null, [{ topic: 'room', qos: 0 }]);
  assert.throws(() => source.read('temperature'), /not connected/);
  client.ack(null, [{ topic: 'room', qos: 0 }]);
  assert.throws(() => source.read('temperature'), /No MQTT/);
  client.message('room', '22');
  assert.equal(source.read('temperature'), 22);
  assert.equal(client.subscriptions.length, 3);
});

test('MQTT freshness expires by receipt time and shutdown removes timers and owned listeners', t => {
  let now = 0;
  let expiry;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(global, 'setTimeout', callback => { expiry = callback; return {}; });
  const clears = t.mock.method(global, 'clearTimeout', () => {});
  const { source, client, updates } = sensor(t, { mqttMaxAge: 1 });
  client.up(); client.message('room', '21');
  now = 999; assert.equal(source.read('temperature'), 21);
  now = 1000; expiry();
  assert.throws(() => source.read('temperature'), /stale/);
  assert.ok(updates.includes('temperature'));
  client.message('room', '22');
  assert.equal(source.read('temperature'), 22);
  source.dispose();
  assert.equal(client.ended, true);
  assert.equal(client.listenerCount('message'), 0);
  assert.ok(clears.mock.callCount() > 0);
  assert.throws(() => source.read('temperature'), /closed/);
});

test('secure defaults and credential-safe errors; configuration and subscription failures are explicit', t => {
  const { source, client, connections } = sensor(t, { mqttURL: 'mqtts://broker.invalid', mqttUsername: 'user', mqttPassword: 'secret' });
  assert.equal(connections[0].options.rejectUnauthorized, true);
  assert.equal(connections[0].options.username, 'user');
  client.autoAck = false; client.up(); client.ack(null, [{ topic: 'room', qos: 128 }]);
  assert.throws(() => source.read('temperature'), /not connected/);
  client.emit('error', new Error('mqtt://user:secret@broker.invalid'));
  assert.throws(() => source.read('temperature'), error => !error.message.includes('secret'));
  for (const config of [{ mqttURL: 'https://bad' }, { mqttTopic: [] }, { mqttTopic: 'room/#/bad' }, { mqttMaxAge: NaN },
    { mqttTopic: [{ identifier: 'temperature', topic: 'room', path: '__proto__.x' }] }]) {
    assert.throws(() => new MQTTSensor({ mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', ...config }));
  }
});

test('SensorSource applies MQTT unit conversion and adjustment without falling back to native readings', async t => {
  const client = interceptClient(t);
  let nativeCalls = 0;
  const source = new SensorSource({ type: 'temperatureSensor', mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0,
    tempSourceUnits: 'f', temperatureAdjustment: 1, humidityAdjustment: -2 }, () => { nativeCalls++; return undefined; });
  t.after(() => source.dispose());
  source.onUpdate(() => {});
  client.up(); client.message('room', '{"temperature":77,"humidity":50}');
  assert.equal(await source.read('temperature'), 26);
  assert.equal(await source.read('humidity'), 48);
  client.down();
  await assert.rejects(source.read('temperature'), /not connected/);
  assert.equal(nativeCalls, 0);
});

test('MQTT updates standalone sensor characteristics with polling disabled and releases its connection', async t => {
  const client = interceptClient(t);
  const f = fixture(t, 'temperatureSensor', { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0, sensorPollInterval: 0 });
  client.up(); client.message('room', '{"temperature":24,"humidity":55}');
  await f.clock.tick(0);
  assert.equal(f.control('CurrentTemperature').value, 24);
  assert.equal(f.accessory.getService(f.S.HumiditySensor).getCharacteristic(f.C.CurrentRelativeHumidity).value, 55);
  client.down(); await f.clock.tick(0);
  assert.ok(f.control('CurrentTemperature').value instanceof Error);
  f.instance.dispose();
  assert.equal(client.ended, true);
  assert.equal(f.clock.timers.size, 0);
});

test('MQTT drives humidity automation; malformed/disconnected readings cannot issue commands', async t => {
  const client = interceptClient(t);
  const f = fixture(t, 'humidifier-dehumidifier', { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0, humidityUpdateFrequency: 0,
    data: { on: 'on', off: 'off', targetStateHumidifier: 'humidify', targetStateDehumidifier: 'dry', fanOnly: 'idle' } });
  client.up(); client.message('room', '{"humidity":30}');
  await f.clock.tick(0); await f.set('Active', 1);
  assert.deepEqual(f.sent, ['on', 'humidify']);
  client.message('room', '{"humidity":75}'); await f.clock.tick(0);
  assert.deepEqual(f.sent, ['on', 'humidify', 'dry']);
  client.message('room', '{"humidity":null}'); await f.clock.tick(0);
  client.down(); await f.clock.tick(0);
  assert.equal(f.sent.length, 3);
  await f.set('Active', 0);
  assert.equal(f.sent.at(-1), 'off');
});

test('MQTT updates HeaterCooler and AC/Thermostat without a native RM sensor', async t => {
  const client = interceptClient(t);
  const f = fixture(t, 'heater-cooler', { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0, sensorPollInterval: 0,
    data: { cool: { on: 'on', off: 'off' } } });
  client.up(); client.message('room', '{"temperature":23}'); await f.clock.tick(0);
  assert.equal(f.control('CurrentTemperature').value, 23);
  f.instance.dispose();
  const next = new Client();
  t.mock.method(require('mqtt').default, 'connect', () => next);
  f.accessory.context.config = { type: 'air-conditioner', mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 0, sensorPollInterval: 0, coolOnly: true };
  const { createAccessoryInstance } = require('../../dist/accessories');
  const ac = createAccessoryInstance(f.platform, f.accessory);
  t.after(() => ac.dispose());
  const thermostat = f.accessory.getService(f.S.Thermostat);
  assert.ok(thermostat.getCharacteristic(f.C.CurrentTemperature).value instanceof Error);
  next.up(); next.message('room', '{"temperature":25,"humidity":54}'); await f.clock.tick(0);
  assert.equal(thermostat.getCharacteristic(f.C.CurrentTemperature).value, 25);
  assert.equal(await thermostat.getCharacteristic(f.C.CurrentTemperature).get(), 25);
  next.down(); await f.clock.tick(0);
  assert.ok(thermostat.getCharacteristic(f.C.CurrentTemperature).value instanceof Error);
  ac.dispose(); assert.equal(next.ended, true);
});

test('real MQTT.js client subscribes and consumes retained packets over an in-process broker stream', { timeout: 5000 }, async t => {
  const { Duplex } = require('node:stream');
  const mqtt = require('mqtt');
  const codec = require('mqtt-packet');
  let clientWire;
  let brokerWire;
  clientWire = new Duplex({ read() {}, write(chunk, encoding, callback) { brokerWire.push(Buffer.from(chunk)); callback(); } });
  brokerWire = new Duplex({ read() {}, write(chunk, encoding, callback) { clientWire.push(Buffer.from(chunk)); callback(); } });
  const parser = codec.parser({ protocolVersion: 4 });
  const packets = [];
  brokerWire.on('data', data => parser.parse(data));
  parser.on('packet', packet => {
    packets.push(packet);
    if (packet.cmd === 'connect') brokerWire.write(codec.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
    if (packet.cmd === 'subscribe') {
      brokerWire.write(codec.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0) }));
      brokerWire.write(codec.generate({ cmd: 'publish', topic: 'zigbee2mqtt/room', payload: '{"temperature":20.5,"humidity":45}', qos: 0, retain: true }));
    }
  });
  const source = new MQTTSensor({ mqttURL: 'mqtt://broker.invalid', mqttTopic: 'zigbee2mqtt/room', mqttMaxAge: 0 },
    (url, options) => new mqtt.MqttClient(() => clientWire, options));
  t.after(() => { source.dispose(); clientWire.destroy(); brokerWire.destroy(); });
  await new Promise(resolve => source.onUpdate(() => {
    try { if (source.read('temperature') === 20.5) resolve(); } catch { /* Await initial measurements. */ }
  }));
  assert.equal(source.read('humidity'), 45);
  assert.equal(packets.find(packet => packet.cmd === 'connect').protocolVersion, 4);
  assert.equal(packets.find(packet => packet.cmd === 'subscribe').subscriptions[0].topic, 'zigbee2mqtt/room');
  assert.equal(packets.some(packet => packet.cmd === 'publish'), false);
});

test('URL credentials are decoded and removed from the connection URL, with explicit fields taking precedence', t => {
  const { connections } = sensor(t, { mqttURL: 'mqtt://urluser:url%40password@broker.invalid', mqttUsername: 'override' });
  assert.equal(connections[0].url, 'mqtt://broker.invalid');
  assert.equal(connections[0].options.username, 'override');
  assert.equal(connections[0].options.password, 'url@password');
});

test('stale MQTT humidity faults without issuing a new automatic command', async t => {
  const client = interceptClient(t);
  const f = fixture(t, 'humidifier-dehumidifier', { mqttURL: 'mqtt://broker.invalid', mqttTopic: 'room', mqttMaxAge: 1, humidityUpdateFrequency: 0,
    data: { on: 'on', off: 'off', targetStateHumidifier: 'humidify', fanOnly: 'idle' } });
  client.up(); client.message('room', '{"humidity":30}'); await f.clock.tick(0);
  await f.set('Active', 1);
  await f.clock.tick(1000);
  assert.deepEqual(f.sent, ['on', 'humidify']);
  assert.ok(f.control('CurrentRelativeHumidity').value instanceof Error);
  f.instance.dispose();
  assert.equal(f.clock.timers.size, 0);
});

test('native Thermostat readings use the shared reader and its poll timer is disposed', async t => {
  const connecting = t.mock.method(require('mqtt').default, 'connect', () => { throw new Error('Unexpected broker connection'); });
  const f = fixture(t, 'air-conditioner', { coolOnly: true, sensorPollInterval: 1, noHumidity: true });
  await f.clock.tick(0);
  assert.equal(f.control('CurrentTemperature').value, 24);
  f.readings.temperature = undefined;
  await f.clock.tick(1000);
  assert.ok(f.control('CurrentTemperature').value instanceof Error);
  assert.equal(connecting.mock.callCount(), 0);
  f.instance.dispose();
  assert.equal(f.clock.timers.size, 0);
});

test('real HAP Thermostat construction does not warn about temperature defaults', () => {
  const hap = require('./helpers/homebridgeRuntime').hap;
  const { createAccessoryInstance } = require('../../dist/accessories');
  const accessory = new hap.Accessory('AC', hap.uuid.generate('mqtt-ac-test'));
  accessory.context = { config: { type: 'air-conditioner', coolOnly: true, sensorPollInterval: 0 } };
  const warnings = [];
  accessory.on('characteristic-warning', warning => warnings.push(warning.message));
  const platform = { Service: hap.Service, Characteristic: hap.Characteristic, log: {}, deviceManager: { getDevice() {} } };
  const ac = createAccessoryInstance(platform, accessory);
  ac.dispose();
  assert.deepEqual(warnings, []);
});

test('invalid accessory startup logs do not dump MQTT credentials', async t => {
  const f = fixture(t, 'lock');
  const { BroadlinkRMPlatform } = require('../../dist/platform');
  const warnings = [];
  const handlers = {};
  const log = { info() {}, debug() {}, error() {}, warn(...args) { warnings.push(args); } };
  const api = { hap: { Service: f.S, Characteristic: f.C }, on(event, handler) { handlers[event] = handler; } };
  new BroadlinkRMPlatform(log, { platform: 'BroadlinkRM', disableDiscovery: true,
    accessories: [{ mqttURL: 'mqtt://user:secret@broker.invalid', mqttPassword: 'secret' }] }, api);
  await handlers.didFinishLaunching();
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes('secret'), false);
  handlers.shutdown();
});
