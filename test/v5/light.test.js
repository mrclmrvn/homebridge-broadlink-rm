const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LightAccessory } = require('../../dist/accessories/light');
const { createAccessoryInstance } = require('../../dist/accessories');

function setup(options = {}) {
  const controls = new Map();
  const service = {
    getCharacteristic(key) {
      if (!controls.has(key)) controls.set(key, {
        onGet(fn) { this.get = fn; return this; }, onSet(fn) { this.set = fn; return this; },
      });
      return controls.get(key);
    },
    setCharacteristic() { return this; },
    updateCharacteristic(key, value) { this.getCharacteristic(key).value = value; },
    testCharacteristic(key) { return controls.has(key); },
    removeCharacteristic(characteristic) {
      for (const [key, value] of controls) if (value === characteristic) controls.delete(key);
    },
  };
  const C = Object.fromEntries(['Manufacturer', 'Model', 'SerialNumber', 'FirmwareRevision', 'On', 'Brightness', 'Hue', 'Saturation', 'ColorTemperature'].map(key => [key, key]));
  const sent = [];
  const device = { async sendData(code) { sent.push(code); } };
  const platform = { updateAccessoryContext() {}, Service: { AccessoryInformation: 'info', Lightbulb: 'light' }, Characteristic: C, log: { debug() {}, error() {}, warn() {} }, deviceManager: { getDevice: () => device } };
  const config = { type: 'light', onDelay: 0, data: { on: 'on', off: 'off', brightness25: 'dim', brightness75: 'bright', hue0: 'red', hue120: 'green', white: 'white', colorTemperature200: 'cool', colorTemperature400: 'warm' }, ...options };
  const accessory = { UUID: 'light', context: { config }, getService: () => service };
  const instance = createAccessoryInstance(platform, accessory);
  assert.ok(instance instanceof LightAccessory);
  return { controls, sent, device, config, platform, accessory };
}

test('light maps brightness, powers off at zero and restores last brightness', async () => {
  const { controls: c, sent } = setup({ useLastKnownBrightness: true });
  await c.get('Brightness').set(40);
  assert.equal(c.get('Brightness').get(), 25);
  await c.get('Brightness').set(30);
  assert.deepEqual(sent, ['on', 'dim']);
  await c.get('Brightness').set(0);
  assert.equal(c.get('On').get(), false);
  await c.get('On').set(true);
  assert.deepEqual(sent, ['on', 'dim', 'off', 'on', 'dim']);
  assert.equal(c.get('Brightness').get(), 25);
});

test('light handles default brightness, circular hue, white and color temperature', async () => {
  const { controls: c, sent } = setup({ defaultBrightness: 75 });
  await c.get('On').set(true);
  await c.get('Hue').set(359);
  assert.equal(c.get('Hue').get(), 0);
  await c.get('Saturation').set(0);
  assert.equal(c.get('Saturation').get(), 0);
  await c.get('Saturation').set(100);
  await c.get('ColorTemperature').set(390);
  assert.equal(c.get('ColorTemperature').get(), 400);
  assert.deepEqual(sent, ['on', 'bright', 'red', 'white', 'red', 'warm']);
  await assert.rejects(c.get('Saturation').set(50), /supports 100%/);
});

test('partial failures preserve successful power state and queue recovers', async () => {
  const { controls: c, device, sent } = setup();
  device.sendData = async code => {
    if (code === 'dim') throw new Error('offline');
    sent.push(code);
  };
  await assert.rejects(c.get('Brightness').set(25), /offline/);
  assert.equal(c.get('Brightness').get(), 0);
  assert.equal(c.get('On').get(), true);
  await c.get('Brightness').set(75);
  assert.equal(c.get('Brightness').get(), 75);
  device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(c.get('On').set(false), /offline/);
  assert.equal(c.get('On').get(), true);
  assert.equal(c.get('Brightness').get(), 75);
});

test('optional controls are removed on reconfiguration; on/off-only lights work', async () => {
  const f = setup();
  f.config.data = { on: 'on', off: 'off' };
  new LightAccessory(f.platform, f.accessory);
  for (const key of ['Brightness', 'Hue', 'Saturation', 'ColorTemperature']) assert.equal(f.controls.has(key), false);
  await f.controls.get('On').set(true);
  await f.controls.get('On').set(false);
  assert.deepEqual(f.sent, ['on', 'off']);
});

test('concurrent changes keep power and code order; invalid values do not transmit', async () => {
  const { controls: c, sent } = setup();
  await Promise.all([c.get('Brightness').set(75), c.get('Hue').set(120), c.get('On').set(false)]);
  assert.deepEqual(sent, ['on', 'bright', 'green', 'off']);
  await assert.rejects(c.get('Brightness').set(NaN), /between/);
  await assert.rejects(c.get('Hue').set(361), /between/);
  assert.equal(sent.length, 4);
});

test('discrete saturation codes map to the nearest configured preset', async () => {
  const { controls: c, sent } = setup({ data: { hue0: 'red', saturation25: 'pale', saturation100: 'full' } });
  await c.get('Saturation').set(30);
  assert.deepEqual(sent, ['red', 'pale']);
  assert.equal(c.get('Saturation').get(), 25);
  assert.equal(c.get('On').get(), true);
});

test('power-on delay holds subsequent writes until the first command finishes', async t => {
  const { controls: c, sent } = setup({ onDelay: 0.01 });
  let finishDelay;
  let delayMs;
  let timerScheduled;
  const scheduled = new Promise(resolve => { timerScheduled = resolve; });
  // Hold the actual power-on timer until assertions finish. Runner load and
  // event-loop ordering cannot expire it before we inspect the queued writes.
  t.mock.method(global, 'setTimeout', (callback, milliseconds) => {
    finishDelay = callback;
    delayMs = milliseconds;
    timerScheduled();
  });
  const first = c.get('Brightness').set(25);
  const second = c.get('On').set(false);
  await scheduled;
  assert.equal(delayMs, 10);
  assert.deepEqual(sent, ['on']);
  assert.equal(c.get('On').get(), true);
  assert.equal(c.get('Brightness').get(), 0);
  finishDelay();
  await Promise.all([first, second]);
  assert.deepEqual(sent, ['on', 'dim', 'off']);
  assert.equal(c.get('On').get(), false);
});

test('a failed saturation command retains the successfully sent hue', async () => {
  const { controls: c, device } = setup({ data: { hue120: 'green', saturation25: 'pale' } });
  device.sendData = async code => { if (code === 'pale') throw new Error('timeout'); };
  await assert.rejects(c.get('Saturation').set(25), /timeout/);
  assert.equal(c.get('Hue').get(), 120);
  assert.equal(c.get('Saturation').get(), 100);
  assert.equal(c.get('On').get(), true);
});

const relativeBrightness = {
  availableBrightnessSteps: 4,
  defaultBrightness: 50,
  data: { on: 'on', off: 'off', 'brightness+': 'up', 'brightness-': 'down' },
};

test('relative brightness starts from the configured level and sends only needed steps', async () => {
  const { controls, sent } = setup(relativeBrightness);
  const brightness = controls.get('Brightness');
  await brightness.set(90);
  assert.equal(brightness.get(), 100);
  await brightness.set(98);
  await brightness.set(60);
  assert.equal(brightness.get(), 50);
  await brightness.set(0);
  await controls.get('On').set(true);
  assert.equal(brightness.get(), 50);
  assert.deepEqual(sent, ['on', 'up', 'up', 'down', 'down', 'off', 'on']);
});

test('a relative light that resumes its level can restore it after power off', async () => {
  const { controls, sent } = setup({ ...relativeBrightness, useLastKnownBrightness: true });
  await controls.get('Brightness').set(25);
  await controls.get('On').set(false);
  await controls.get('On').set(true);
  assert.equal(controls.get('Brightness').get(), 25);
  assert.deepEqual(sent, ['on', 'down', 'off', 'on']);
});

test('relative brightness retains confirmed steps and recalibrates after a failed pulse', async () => {
  const { controls, sent, device } = setup(relativeBrightness);
  let physicalLevel = 2;
  let failed = false;
  device.sendData = async code => {
    sent.push(code);
    if (code === 'up') physicalLevel = Math.min(4, physicalLevel + 1);
    if (code === 'down') physicalLevel--;
    if (!failed && physicalLevel === 4) {
      failed = true;
      throw new Error('lost acknowledgement');
    }
  };
  const brightness = controls.get('Brightness');
  await assert.rejects(brightness.set(100), /lost acknowledgement/);
  assert.equal(brightness.get(), 75);
  await brightness.set(75);
  assert.equal(physicalLevel, 3);
  assert.equal(brightness.get(), 75);
  assert.deepEqual(sent, ['on', 'up', 'up', 'up', 'up', 'up', 'down']);
});
