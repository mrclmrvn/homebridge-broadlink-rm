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
  const thermostat = cached.getService(hap.Service.Thermostat);
  assert.equal(await thermostat.getCharacteristic(hap.Characteristic.TargetTemperature).handleGetRequest(), 18);
  assert.equal(await thermostat.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).handleGetRequest(), 0);
  assert.deepEqual(warnings, []);
});
