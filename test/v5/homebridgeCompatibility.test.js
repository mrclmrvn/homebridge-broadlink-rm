const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hap, homebridge, createHomebridgeAPI } = require('./helpers/homebridgeRuntime');
const { BroadlinkRMPlatform } = require('../../dist/platform');

test('the selected Homebridge API provides the same HAP classes used by the tests', () => {
  const api = createHomebridgeAPI();
  assert.equal(api.serverVersion, homebridge.version);
  assert.equal(api.hap.Service, hap.Service);
  assert.equal(api.hap.Characteristic, hap.Characteristic);
  const registrations = [];
  api.on('registerPlatform', (...args) => registrations.push(args));
  require('../../dist')(api);
  assert.equal(registrations[0][0], 'BroadlinkRM');
  assert.equal(registrations[0][1], BroadlinkRMPlatform);
  const accessory = new api.platformAccessory('Runtime Check', hap.uuid.generate('runtime-check'));
  assert.ok(accessory.addService(hap.Service.Switch, 'Runtime Check') instanceof hap.Service);
  api.registerPlatformAccessories('@mrclmrvn/homebridge-broadlink-rm', 'BroadlinkRM', [accessory]);
  assert.equal(api.platformAccessory.serialize(accessory).plugin, '@mrclmrvn/homebridge-broadlink-rm');
});

test('real Homebridge registration, external TV publication and serialized target cache restoration work without starting a bridge', async t => {
  const config = { platform: 'BroadlinkRM', disableDiscovery: true, accessories: [
    { name: 'AC', type: 'air-conditioner', coolOnly: true, sensorPollInterval: 0, noHumidity: true,
      data: { temperature18: '18', temperature25: '25', off: 'off' }, defaultCoolTemperature: 25 },
    { name: 'Automation', type: 'switch', virtual: true },
    { name: 'TV', type: 'tv', data: { on: 'on', off: 'off' } },
  ] };
  const warnings = [];
  const log = { debug() {}, info() {}, warn(message) { warnings.push(message); }, error(message) { warnings.push(message); } };
  function setup() {
    const api = createHomebridgeAPI();
    const calls = { registered: [], external: [], updated: [] };
    api.on('registerPlatformAccessories', accessories => calls.registered.push(...accessories));
    api.on('publishExternalAccessories', accessories => calls.external.push(...accessories));
    api.on('updatePlatformAccessories', accessories => calls.updated.push(...accessories));
    const platform = new BroadlinkRMPlatform(log, structuredClone(config), api);
    t.after(() => api.emit('shutdown'));
    return { api, calls, platform };
  }
  const first = setup();
  await first.platform.initDevicesAndAccessories();
  assert.equal(first.calls.registered.length, 2);
  assert.equal(first.calls.external.length, 1);
  assert.ok(first.calls.external[0] instanceof first.api.platformAccessory);
  const ac = first.calls.registered.find(accessory => accessory.displayName === 'AC');
  await ac.getService(hap.Service.Thermostat).getCharacteristic(hap.Characteristic.TargetTemperature).handleSetRequest(18);
  assert.equal(first.calls.updated.at(-1), ac);
  const serialized = JSON.parse(JSON.stringify(first.api.platformAccessory.serialize(ac)));
  assert.equal(serialized.context.broadlinkRMState.targetTemperature, 18);
  first.api.emit('shutdown');

  const second = setup();
  const cached = second.api.platformAccessory.deserialize(serialized);
  second.platform.configureAccessory(cached);
  await second.platform.initDevicesAndAccessories();
  assert.equal(second.platform.accessories.get(ac.UUID), cached);
  assert.equal(second.calls.registered.length, 1); // Only the virtual switch is newly bridged.
  assert.equal(second.calls.external.length, 1);
  assert.equal(second.calls.external[0].UUID, first.calls.external[0].UUID);
  assert.equal(second.calls.external[0].category, hap.Categories.TELEVISION);
  const thermostat = cached.getService(hap.Service.Thermostat);
  assert.equal(await thermostat.getCharacteristic(hap.Characteristic.TargetTemperature).handleGetRequest(), 18);
  assert.equal(await thermostat.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleGetRequest(), 0);
  assert.deepEqual(warnings, []);
});

test('duplicate TV identities are skipped before Homebridge can publish colliding external accessories', async t => {
  const api = createHomebridgeAPI();
  const published = [], registered = [], warnings = [];
  api.on('publishExternalAccessories', accessories => published.push(...accessories));
  api.on('registerPlatformAccessories', accessories => registered.push(...accessories));
  const log = { info() {}, debug() {}, error() {}, warn(message) { warnings.push(message); } };
  const platform = new BroadlinkRMPlatform(log, { platform: 'BroadlinkRM', disableDiscovery: true, accessories: [
    { name: 'TV', type: 'tv', data: {} }, { name: 'TV', type: 'television', data: {} },
    { name: 'Gate', type: 'switch', virtual: true },
  ] }, api);
  t.after(() => api.emit('shutdown'));
  await platform.initDevicesAndAccessories();
  assert.equal(published.length, 1);
  assert.equal(registered.length, 1);
  assert.equal(platform.instances.size, 2);
  assert.ok(warnings.some(message => /duplicate.*TV/i.test(message)));
});

test('MAC-selected accessories follow rediscovery, while stale IP errors leave other accessories usable', async t => {
  const api = createHomebridgeAPI();
  const platform = new BroadlinkRMPlatform({ info() {}, warn() {}, error() {}, debug() {} }, {
    platform: 'BroadlinkRM', disableDiscovery: true, accessories: [
      { name: 'By MAC', type: 'switch', host: 'AA-BB-CC-DD-EE-FF', data: { on: '260002000102' } },
      { name: 'Old IP', type: 'switch', host: '192.0.2.10', data: { on: '260002000102' } },
    ],
  }, api);
  const sent = [];
  const device = host => ({ host, devType: 0x520b, port: 80, macAddress: 'aa:bb:cc:dd:ee:ff',
    close() { this.closed = true; }, async sendData() { sent.push(host); } });
  const first = device('192.0.2.10');
  platform.deviceManager.registerDevice(first);
  t.after(() => api.emit('shutdown'));
  await platform.initDevicesAndAccessories();
  platform.deviceManager.registerDevice(device('192.0.2.11'));
  const byName = name => [...platform.accessories.values()].find(accessory => accessory.displayName === name)
    .getService(hap.Service.Switch).getCharacteristic(hap.Characteristic.On);
  await assert.rejects(byName('Old IP').handleSetRequest(true));
  await byName('By MAC').handleSetRequest(true);
  assert.equal(first.closed, true);
  assert.deepEqual(sent, ['192.0.2.11']);
  assert.equal(platform.instances.size, 2);
});
