const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TelevisionAccessory } = require('../../dist/accessories/tv');
const { BroadlinkRMPlatform } = require('../../dist/platform');

function fixture() {
  class Service {
    constructor(type, name, subtype) { this.UUID = type.UUID; this.subtype = subtype; this.controls = new Map(); this.links = new Set(); }
    getCharacteristic(key) {
      if (!this.controls.has(key)) this.controls.set(key, {
        onGet(fn) { this.get = fn; return this; }, onSet(fn) { this.set = fn; return this; },
      });
      return this.controls.get(key);
    }
    setCharacteristic(key, value) { this.getCharacteristic(key).value = value; return this; }
    setPrimaryService() { this.primary = true; }
    addLinkedService(service) { this.links.add(service); }
    removeLinkedService(service) { this.links.delete(service); }
  }
  class Accessory {
    constructor(name, uuid, category) { this.displayName = name; this.UUID = uuid; this.category = category; this.context = {}; this.services = []; }
    getService(type) { return this.services.find(s => s.UUID === type.UUID); }
    getServiceById(type, subtype) { return this.services.find(s => s.UUID === type.UUID && s.subtype === subtype); }
    addService(type, name, subtype) { const s = new Service(type, name, subtype); this.services.push(s); return s; }
    removeService(service) { this.services.splice(this.services.indexOf(service), 1); }
  }
  const S = Object.fromEntries(['AccessoryInformation', 'Television', 'TelevisionSpeaker', 'InputSource', 'Switch'].map(key => [key, { UUID: key }]));
  const C = Object.fromEntries(['Manufacturer', 'Model', 'SerialNumber', 'FirmwareRevision', 'ConfiguredName', 'ActiveIdentifier', 'Identifier', 'InputSourceType', 'Mute'].map(key => [key, key]));
  Object.assign(C, { Active: { ACTIVE: 1 }, RemoteKey: { INFORMATION: 15 }, PowerModeSelection: { SHOW: 0 }, VolumeSelector: { INCREMENT: 0 }, VolumeControlType: { RELATIVE: 1 }, SleepDiscoveryMode: { ALWAYS_DISCOVERABLE: 1 }, IsConfigured: { CONFIGURED: 1 } });
  const sent = [];
  const device = { async sendData(code) { sent.push(code); } };
  const platform = { Service: S, Characteristic: C, log: { debug() {}, error() {}, warn() {}, info() {} }, deviceManager: { getDevice: () => device } };
  const config = { name: 'TV', type: 'tv', data: { on: 'on', off: 'off', inputs: [{ name: 'HDMI', type: 'hdmi', data: 'hdmi' }], remote: { arrowUp: 'up', info: 'info' }, volume: { up: 'louder', down: 'quieter', mute: 'mute' } } };
  const accessory = new Accessory('TV', 'id'); accessory.context.config = config;
  return { platform, accessory, config, sent, device, S, C, Accessory };
}

test('TV power, input, remote, relative volume and mute send legacy codes', async () => {
  const f = fixture(); new TelevisionAccessory(f.platform, f.accessory);
  const tv = f.accessory.getService(f.S.Television);
  const speaker = f.accessory.getService(f.S.TelevisionSpeaker);
  await tv.getCharacteristic(f.C.Active).set(1);
  await tv.getCharacteristic(f.C.ActiveIdentifier).set(0);
  await tv.getCharacteristic(f.C.RemoteKey).set(4);
  await tv.getCharacteristic(f.C.RemoteKey).set(15);
  await speaker.getCharacteristic(f.C.VolumeSelector).set(0);
  await speaker.getCharacteristic(f.C.VolumeSelector).set(1);
  await speaker.getCharacteristic(f.C.Mute).set(true);
  await speaker.getCharacteristic(f.C.Mute).set(true);
  assert.deepEqual(f.sent, ['on', 'hdmi', 'up', 'info', 'louder', 'quieter', 'mute']);
  assert.equal(tv.primary, true);
  assert.equal(tv.links.size, 2);
  assert.equal(f.accessory.getService(f.S.InputSource).getCharacteristic(f.C.Identifier).value, 0);
  await assert.rejects(tv.getCharacteristic(f.C.ActiveIdentifier).set(9), /Unknown TV input/);
  await assert.rejects(tv.getCharacteristic(f.C.RemoteKey).set(3), /No IR\/RF code/);
});

test('failed TV transmissions preserve state and stale input services are removed', async () => {
  const f = fixture(); new TelevisionAccessory(f.platform, f.accessory);
  const tv = f.accessory.getService(f.S.Television);
  f.device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(tv.getCharacteristic(f.C.Active).set(1), /offline/);
  assert.equal(tv.getCharacteristic(f.C.Active).get(), 0);
  f.config.data.inputs = [];
  new TelevisionAccessory(f.platform, f.accessory);
  assert.equal(f.accessory.getService(f.S.InputSource), undefined);
});

test('platform publishes TVs externally, migrates bridged cache, and keeps switches bridged', async () => {
  const f = fixture();
  const calls = { published: [], registered: [], removed: [] };
  const api = {
    hap: { Service: f.S, Characteristic: f.C, Categories: { TELEVISION: 31 }, uuid: { generate: key => key } },
    platformAccessory: f.Accessory, on() {},
    publishExternalAccessories(plugin, accessories) { calls.published.push(...accessories); },
    registerPlatformAccessories(plugin, platform, accessories) { calls.registered.push(...accessories); },
    unregisterPlatformAccessories(plugin, platform, accessories) { calls.removed.push(...accessories); },
    updatePlatformAccessories() {},
  };
  const platform = new BroadlinkRMPlatform(f.platform.log, { platform: 'BroadlinkRM', disableDiscovery: true, accessories: [f.config, { name: 'Switch', type: 'switch' }] }, api);
  const cached = new f.Accessory('TV', 'TV:default');
  platform.configureAccessory(cached);
  await platform.initDevicesAndAccessories();
  assert.deepEqual(calls.removed, [cached]);
  assert.equal(calls.published.length, 1);
  assert.equal(calls.published[0].category, 31);
  assert.equal(calls.registered.length, 1);
  assert.equal(calls.registered[0].displayName, 'Switch');
  assert.equal(platform.instances.size, 2);
});
