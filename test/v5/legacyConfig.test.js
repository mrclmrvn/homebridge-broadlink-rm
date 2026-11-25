const { test } = require('node:test');
const assert = require('node:assert/strict');
const hap = require('./helpers/homebridgeRuntime').hap;
const { BroadlinkRMPlatform } = require('../../dist/platform');
const { createAccessoryInstance } = require('../../dist/accessories');
const template = require('./fixtures/legacy-cooling-platform.json');

// This fixture preserves a contributed configuration's structure and code sizes.
// Names, addresses, bridge identity and every learned code have been replaced.
// Synthetic code bytes are test data, not appliance commands or hardware fixtures.
async function setup(t, restored = []) {
  const config = structuredClone(template);
  const handlers = {};
  const registered = [], removed = [], sent = [], warnings = [];
  class Accessory extends hap.Accessory {
    constructor(name, uuid) {
      super(name, uuid); this.context = {};
      this.on('characteristic-warning', warning => warnings.push(warning.message));
    }
  }
  const api = {
    hap, platformAccessory: Accessory,
    on(event, handler) { handlers[event] = handler; },
    registerPlatformAccessories(plugin, platform, accessories) { registered.push(...accessories); },
    unregisterPlatformAccessories(plugin, platform, accessories) { removed.push(...accessories); },
    updatePlatformAccessories() {},
  };
  const log = { info() {}, debug() {}, warn() {}, error(message) { warnings.push(message); } };
  const platform = new BroadlinkRMPlatform(log, config, api);
  t.mock.method(platform.deviceManager, 'initHosts', async hosts => {
    assert.deepEqual(hosts, config.hosts);
    for (const host of hosts) platform.deviceManager.registerDevice({
      host: host.address, macAddress: host.mac, devType: 0x520c, port: 80,
      async sendData(code) { sent.push({ host: host.address, code }); },
      async checkSensors() { return { temperature: 24, humidity: 50 }; },
      close() {},
    });
  });
  const discovery = t.mock.method(platform.deviceManager, 'discover', async () => {});
  const disabled = config.accessories.find(accessory => accessory.disabled);
  const cached = new Accessory(disabled.name, hap.uuid.generate(`${disabled.name}:${disabled.host}`));
  platform.configureAccessory(cached);
  for (const record of restored) {
    const accessory = new Accessory(record.name, record.UUID);
    accessory.context = structuredClone(record.context);
    platform.configureAccessory(accessory);
  }
  t.after(() => handlers.shutdown());
  await handlers.didFinishLaunching();
  return { config, platform, api, handlers, registered, removed, cached, sent, warnings, discovery, Accessory };
}

test('legacy cooling platform restores its supported types and removes the disabled fan without network access', async t => {
  const f = await setup(t);
  assert.equal(f.registered.length, 3);
  assert.equal(f.platform.instances.size, 3);
  assert.deepEqual(f.removed, [f.cached]);
  assert.equal(f.discovery.mock.callCount(), 1);
  assert.equal(f.registered.filter(a => a.getService(hap.Service.Thermostat)).length, 2);
  assert.equal(f.registered.filter(a => a.getService(hap.Service.Switch)).length, 1);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.warnings, []);
});

test('both legacy cooling maps retain default 25, nested metadata, all 16–30 codes and host routing', async t => {
  const f = await setup(t);
  for (const config of f.config.accessories.filter(a => a.type === 'air-conditioner')) {
    const accessory = f.registered.find(a => a.displayName === config.name);
    const service = accessory.getService(hap.Service.Thermostat);
    const mode = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
    const temp = service.getCharacteristic(hap.Characteristic.TargetTemperature);
    assert.deepEqual(mode.props.validValues, [0, 2]);
    assert.equal(await temp.handleGetRequest(), 25);
    const start = f.sent.length;
    await mode.handleSetRequest(2);
    const expectedHost = f.platform.deviceManager.getDevice(config.host).host;
    assert.deepEqual(f.sent.at(-1), { host: expectedHost, code: config.data.temperature25.data });
    for (let value = 16; value <= 30; value++) {
      assert.equal(config.data[`temperature${value}`]['pseudo-mode'], 'cool');
      await temp.handleSetRequest(value);
      assert.deepEqual(f.sent.at(-1), { host: expectedHost, code: config.data[`temperature${value}`].data });
    }
    await mode.handleSetRequest(0);
    assert.equal(f.sent.length - start, 17);
    assert.deepEqual(f.sent.at(-1), { host: expectedHost, code: config.data.off });
  }
  assert.deepEqual(f.warnings, []);
});

test('configured ignore-while-off defers writes and failed sends do not report successful AC state', async t => {
  const f = await setup(t);
  const config = f.config.accessories.find(a => a.type === 'air-conditioner');
  const service = f.registered.find(a => a.displayName === config.name).getService(hap.Service.Thermostat);
  const temp = service.getCharacteristic(hap.Characteristic.TargetTemperature);
  const mode = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
  assert.equal(config.ignoreTemperatureWhenOff, true);
  await temp.handleSetRequest(27);
  assert.deepEqual(f.sent, []);
  assert.equal(await temp.handleGetRequest(), 27);
  await mode.handleSetRequest(2);
  assert.equal(f.sent.at(-1).code, config.data.temperature27.data);
  const device = f.platform.deviceManager.getDevice(config.host);
  t.mock.method(device, 'sendData', async () => { throw new Error('offline'); });
  await assert.rejects(temp.handleSetRequest(28));
  assert.equal(await temp.handleGetRequest(), 27);
  await assert.rejects(mode.handleSetRequest(0));
  assert.equal(await mode.handleGetRequest(), 2);
  assert.equal(await service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).handleGetRequest(), 2);
});

test('the disabled fan configuration supports all three speeds when explicitly enabled', async t => {
  const f = await setup(t);
  const config = f.config.accessories.find(a => a.type === 'fan');
  const accessory = new f.Accessory(config.name, hap.uuid.generate('enabled-legacy-fan'));
  accessory.context.config = { ...config, disabled: false };
  const instance = createAccessoryInstance(f.platform, accessory); t.after(() => instance.dispose());
  const service = accessory.getService(hap.Service.Fanv2);
  const power = service.getCharacteristic(hap.Characteristic.Active);
  const speed = service.getCharacteristic(hap.Characteristic.RotationSpeed);
  await power.handleSetRequest(1);
  assert.equal(f.sent.at(-1).code, config.data.on);
  for (const value of [33, 66, 99]) {
    await speed.handleSetRequest(value);
    assert.equal(f.sent.at(-1).code, config.data[`fanSpeed${value}`]);
    assert.equal(await speed.handleGetRequest(), value);
  }
  await speed.handleSetRequest(0);
  assert.equal(f.sent.at(-1).code, config.data.off);
  assert.deepEqual(f.warnings, []);
});

test('AC target survives serialized cache restoration while power remains Off and startup sends nothing', async t => {
  const f = await setup(t);
  const accessory = f.registered.find(a => a.getService(hap.Service.Thermostat));
  const service = accessory.getService(hap.Service.Thermostat);
  const updates = t.mock.method(f.api, 'updatePlatformAccessories', () => {});
  await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleSetRequest(18);
  assert.deepEqual(updates.mock.calls[0].arguments[0], [accessory]);
  assert.deepEqual(accessory.context.broadlinkRMState, { targetTemperature: 18, targetHeatingCoolingState: 0, lastMode: 2 });
  await service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(2);
  await service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(0);
  const records = JSON.parse(JSON.stringify([{ name: accessory.displayName, UUID: accessory.UUID, context: accessory.context }]));
  f.handlers.shutdown();
  const restored = await setup(t, records);
  const current = restored.platform.accessories.get(accessory.UUID).getService(hap.Service.Thermostat);
  assert.equal(await current.getCharacteristic(hap.Characteristic.TargetTemperature).handleGetRequest(), 18);
  assert.equal(await current.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleGetRequest(), 0);
  assert.deepEqual(restored.sent, []);
  await current.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(2);
  assert.equal(restored.sent.at(-1).code, accessory.context.config.data.temperature18.data);
  assert.deepEqual(restored.warnings, []);
});

test('Off to Cool resends the retained 18-degree code for both HomeKit temperature/mode write orders', async t => {
  const f = await setup(t);
  const accessory = f.registered.find(a => a.getService(hap.Service.Thermostat));
  const service = accessory.getService(hap.Service.Thermostat);
  const temperature = service.getCharacteristic(hap.Characteristic.TargetTemperature);
  const mode = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
  await mode.handleSetRequest(2);
  await temperature.handleSetRequest(18);
  for (const temperatureFirst of [true, false]) {
    await mode.handleSetRequest(0);
    assert.equal(f.sent.at(-1).code, accessory.context.config.data.off);
    const before = f.sent.length;
    if (temperatureFirst) await temperature.handleSetRequest(18);
    await mode.handleSetRequest(2);
    if (!temperatureFirst) await temperature.handleSetRequest(18);
    assert.equal(f.sent.length, before + 1);
    assert.equal(f.sent.at(-1).code, accessory.context.config.data.temperature18.data);
    assert.equal(await temperature.handleGetRequest(), 18);
    assert.equal(await mode.handleGetRequest(), 2);
  }
  assert.deepEqual(f.warnings, []);
});

test('cache persistence failure warns without undoing a successful setpoint change', async t => {
  const f = await setup(t);
  const warnings = [];
  t.mock.method(f.platform.log, 'warn', message => warnings.push(message));
  t.mock.method(f.api, 'updatePlatformAccessories', () => { throw new Error('storage unavailable'); });
  const service = f.registered.find(a => a.getService(hap.Service.Thermostat)).getService(hap.Service.Thermostat);
  await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleSetRequest(18);
  assert.equal(await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleGetRequest(), 18);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Could not persist state/);
});

test('active AC reduced to 18 then turned Off restores 18 after restart, independently of another AC', async t => {
  const f = await setup(t);
  const cache = new Map();
  // Capture only what the plugin actually submits to Homebridge's cache API.
  // Copy at write time so later context mutations cannot change the snapshot.
  t.mock.method(f.api, 'updatePlatformAccessories', accessories => {
    for (const accessory of accessories) cache.set(accessory.UUID, JSON.stringify({
      name: accessory.displayName, UUID: accessory.UUID, context: accessory.context,
    }));
  });
  const units = f.registered.filter(accessory => accessory.getService(hap.Service.Thermostat));
  const targets = [18, 27];
  for (const [index, accessory] of units.entries()) {
    const service = accessory.getService(hap.Service.Thermostat);
    const power = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
    const temperature = service.getCharacteristic(hap.Characteristic.TargetTemperature);
    assert.equal(await temperature.handleGetRequest(), 25);
    await power.handleSetRequest(2);
    await temperature.handleSetRequest(targets[index]);
    await power.handleSetRequest(0);
    assert.equal(await power.handleGetRequest(), 0);
    assert.equal(await temperature.handleGetRequest(), targets[index]);
  }
  assert.equal(cache.size, 2);
  f.handlers.shutdown();

  const restarted = await setup(t, [...cache.values()].map(record => JSON.parse(record)));
  assert.deepEqual(restarted.sent, []);
  for (const [index, previous] of units.entries()) {
    const accessory = restarted.platform.accessories.get(previous.UUID);
    const service = accessory.getService(hap.Service.Thermostat);
    assert.equal(await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleGetRequest(), targets[index]);
    assert.equal(await service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleGetRequest(), 0);
    assert.equal(await service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).handleGetRequest(), 0);
  }
  for (const [index, previous] of units.entries()) {
    const accessory = restarted.platform.accessories.get(previous.UUID);
    await accessory.getService(hap.Service.Thermostat)
      .getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(2);
    assert.deepEqual(restarted.sent.at(-1), {
      host: restarted.platform.deviceManager.getDevice(accessory.context.config.host).host,
      code: accessory.context.config.data[`temperature${targets[index]}`].data,
    });
  }
  assert.equal(restarted.sent.length, 2);
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(restarted.warnings, []);
});

test('active AC mode and setpoint are persisted before shutdown and restored without replaying IR', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'broadlink-ac-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'cache.json');
  const f = await setup(t);
  t.mock.method(f.api, 'updatePlatformAccessories', () => {
    fs.writeFileSync(file, JSON.stringify(f.registered.map(a => ({ name: a.displayName, UUID: a.UUID, context: a.context }))));
  });
  const accessory = f.registered.find(a => a.getService(hap.Service.Thermostat));
  const service = accessory.getService(hap.Service.Thermostat);
  await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleSetRequest(23);
  await service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(2);
  // Load only the already-written cache: no shutdown hook or final flush occurs.
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(records.find(a => a.UUID === accessory.UUID).context.broadlinkRMState,
    { targetTemperature: 23, targetHeatingCoolingState: 2, lastMode: 2 });
  const restored = await setup(t, records);
  const current = restored.platform.accessories.get(accessory.UUID).getService(hap.Service.Thermostat);
  assert.equal(await current.getCharacteristic(hap.Characteristic.TargetTemperature).handleGetRequest(), 23);
  assert.equal(await current.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleGetRequest(), 2);
  assert.equal(await current.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).handleGetRequest(), 2);
  assert.deepEqual(restored.sent, []);
  assert.deepEqual(restored.warnings, []);
});

test('mode-only changes persist and failed Off/Cool sends leave the saved state unchanged', async t => {
  const f = await setup(t);
  const accessory = f.registered.find(a => a.getService(hap.Service.Thermostat));
  const mode = accessory.getService(hap.Service.Thermostat).getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
  const save = t.mock.method(f.api, 'updatePlatformAccessories', () => {});
  await mode.handleSetRequest(2); // Keep the default temperature: mode still needs saving.
  assert.equal(save.mock.callCount(), 1);
  assert.equal(accessory.context.broadlinkRMState.targetHeatingCoolingState, 2);
  const device = f.platform.deviceManager.getDevice(accessory.context.config.host);
  const send = device.sendData;
  device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(mode.handleSetRequest(0));
  assert.equal(accessory.context.broadlinkRMState.targetHeatingCoolingState, 2);
  assert.equal(save.mock.callCount(), 1);
  device.sendData = send;
  await mode.handleSetRequest(0);
  assert.equal(accessory.context.broadlinkRMState.targetHeatingCoolingState, 0);
  assert.equal(accessory.context.broadlinkRMState.lastMode, 2);
  device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(mode.handleSetRequest(2));
  assert.equal(accessory.context.broadlinkRMState.targetHeatingCoolingState, 0);
  assert.equal(save.mock.callCount(), 2);
});
