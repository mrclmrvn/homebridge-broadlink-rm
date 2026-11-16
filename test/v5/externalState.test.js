const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ExternalStateStore } = require('../../dist/helpers/externalState');
const { BroadlinkRMPlatform } = require('../../dist/platform');
const { createHomebridgeAPI, hap } = require('./helpers/homebridgeRuntime');

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broadlink-external-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('external state is scoped, atomically replaced, private and validates its record identity', t => {
  const root = directory(t);
  const first = new ExternalStateStore(root, 'bridge-one');
  const second = new ExternalStateStore(root, 'bridge-two');
  assert.equal(first.read('tv'), undefined);
  first.write('tv', { version: 1, values: { active: 1 } });
  assert.equal(second.read('tv'), undefined);
  first.write('tv', { version: 1, values: { active: 0 } });
  assert.equal(first.read('tv').values.active, 0);
  const scope = path.join(root, 'broadlink-rm-state', fs.readdirSync(path.join(root, 'broadlink-rm-state'))[0]);
  const files = fs.readdirSync(scope);
  assert.equal(files.length, 1); assert.ok(files[0].endsWith('.json'));
  const file = path.join(scope, files[0]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
  fs.writeFileSync(file, JSON.stringify({ version: 1, uuid: 'other', state: {} }));
  assert.throws(() => first.read('tv'), /Invalid external/);
});

test('real Homebridge external TV restores its sidecar without bridged cache registration or startup sends', async t => {
  const root = directory(t), sent = [], warnings = [];
  const settings = { platform: 'BroadlinkRM', disableDiscovery: true, name: 'TV Bridge',
    accessories: [{ name: 'TV', type: 'tv', data: { on: 'on', off: 'off',
      inputs: [{ name: 'One', data: 'one' }, { name: 'Two', data: 'two' }],
      volume: { mute: 'mute' }, pictureMode: { game: 'game' } } }] };
  async function start(config = settings) {
    const api = createHomebridgeAPI();
    t.mock.method(api.user, 'storagePath', () => root);
    const published = [], cached = [];
    api.on('publishExternalAccessories', accessories => published.push(...accessories));
    api.on('updatePlatformAccessories', accessories => cached.push(...accessories));
    const log = { info() {}, debug() {}, warn(message) { warnings.push(message); }, error(message) { warnings.push(message); } };
    const platform = new BroadlinkRMPlatform(log, structuredClone(config), api);
    platform.deviceManager.getDevice = () => ({ async sendData(code) { sent.push(code); } });
    t.after(() => api.emit('shutdown'));
    await platform.initDevicesAndAccessories();
    return { api, platform, accessory: published[0], cached };
  }
  const first = await start();
  const service = first.accessory.getService(hap.Service.Television);
  await service.getCharacteristic(hap.Characteristic.Active).handleSetRequest(1);
  await service.getCharacteristic(hap.Characteristic.ActiveIdentifier).handleSetRequest(1);
  await service.getCharacteristic(hap.Characteristic.PictureMode).handleSetRequest(5);
  await first.accessory.getService(hap.Service.TelevisionSpeaker).getCharacteristic(hap.Characteristic.Mute).handleSetRequest(true);
  assert.deepEqual(first.cached, [], 'external TVs must not enter the bridged accessory cache');
  const before = sent.length;
  // Simulate loss of the first process by restoring only the already-written file.
  const second = await start();
  const restored = second.accessory.getService(hap.Service.Television);
  assert.equal(second.accessory.UUID, first.accessory.UUID);
  assert.equal(await restored.getCharacteristic(hap.Characteristic.Active).handleGetRequest(), 1);
  assert.equal(await restored.getCharacteristic(hap.Characteristic.ActiveIdentifier).handleGetRequest(), 1);
  assert.equal(await restored.getCharacteristic(hap.Characteristic.PictureMode).handleGetRequest(), 5);
  assert.equal(await second.accessory.getService(hap.Service.TelevisionSpeaker).getCharacteristic(hap.Characteristic.Mute).handleGetRequest(), true);
  assert.equal(sent.length, before);
  const thirdConfig = structuredClone(settings); thirdConfig.accessories[0].persistState = false;
  const third = await start(thirdConfig);
  assert.equal(await third.accessory.getService(hap.Service.Television).getCharacteristic(hap.Characteristic.Active).handleGetRequest(), 0);
  assert.deepEqual(warnings, []);
});

test('a failed TV state write warns but does not fail control; an identical later write retries persistence', async t => {
  const root = directory(t), warnings = [], published = [];
  const api = createHomebridgeAPI(); t.mock.method(api.user, 'storagePath', () => root);
  api.on('publishExternalAccessories', accessories => published.push(...accessories));
  const platform = new BroadlinkRMPlatform({ info() {}, debug() {}, warn(m) { warnings.push(m); }, error() {} },
    { platform: 'BroadlinkRM', disableDiscovery: true, accessories: [{ name: 'TV', type: 'tv', data: { on: 'on', off: 'off' } }] }, api);
  platform.deviceManager.getDevice = () => ({ async sendData() {} });
  t.after(() => api.emit('shutdown'));
  await platform.initDevicesAndAccessories();
  const original = ExternalStateStore.prototype.write;
  let attempts = 0;
  t.mock.method(ExternalStateStore.prototype, 'write', function (...args) {
    if (++attempts === 1) throw new Error('disk unavailable');
    return original.apply(this, args);
  });
  const active = published[0].getService(hap.Service.Television).getCharacteristic(hap.Characteristic.Active);
  await active.handleSetRequest(1);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /Could not persist/);
  await active.handleSetRequest(1);
  assert.equal(attempts, 2);
  assert.equal(await active.handleGetRequest(), 1);
});

test('malformed TV state falls back to defaults without publishing cached data as physical state', async t => {
  const root = directory(t), warnings = [], published = [];
  const api = createHomebridgeAPI(); t.mock.method(api.user, 'storagePath', () => root);
  const uuid = hap.uuid.generate('TV:default');
  const store = new ExternalStateStore(root, '@mrclmrvn/homebridge-broadlink-rm:BroadlinkRM');
  store.write(uuid, { version: 1, kind: 'tv', values: { active: 1 } });
  const stateDirectory = path.join(root, 'broadlink-rm-state', fs.readdirSync(path.join(root, 'broadlink-rm-state'))[0]);
  fs.writeFileSync(path.join(stateDirectory, fs.readdirSync(stateDirectory)[0]), '{bad json');
  api.on('publishExternalAccessories', accessories => published.push(...accessories));
  const platform = new BroadlinkRMPlatform({ info() {}, debug() {}, warn(m) { warnings.push(m); }, error() {} },
    { platform: 'BroadlinkRM', disableDiscovery: true, accessories: [{ name: 'TV', type: 'tv', data: {} }] }, api);
  t.after(() => api.emit('shutdown'));
  await platform.initDevicesAndAccessories();
  assert.equal(await published[0].getService(hap.Service.Television).getCharacteristic(hap.Characteristic.Active).handleGetRequest(), 0);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /Could not load saved TV state/);
});
