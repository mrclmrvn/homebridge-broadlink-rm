const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FanAccessory } = require('../../dist/accessories/fan');

function setup(config = {}) {
  const controls = new Map();
  const service = {
    setCharacteristic() { return this; },
    getCharacteristic(key) {
      if (!controls.has(key)) controls.set(key, {
        onGet(fn) { this.get = fn; return this; },
        onSet(fn) { this.set = fn; return this; },
        setProps(props) { this.props = props; return this; },
      });
      return controls.get(key);
    },
    updateCharacteristic(key, value) { this.getCharacteristic(key).value = value; },
    testCharacteristic(key) { return controls.has(key); },
    removeCharacteristic(characteristic) {
      for (const [key, value] of controls) if (value === characteristic) controls.delete(key);
    },
  };
  const sent = [];
  const device = { host: 'test', macAddress: 'test', async sendData(code) { sent.push(code); } };
  const Characteristic = Object.fromEntries(['Manufacturer', 'Model', 'SerialNumber', 'FirmwareRevision', 'Active', 'RotationSpeed', 'RotationDirection', 'SwingMode'].map(key => [key, key]));
  Characteristic.RotationDirection = { CLOCKWISE: 0 };
  Characteristic.SwingMode = { SWING_ENABLED: 1 };
  const platform = { updateAccessoryContext() {},
    Service: { AccessoryInformation: 'info', Fanv2: 'fan' }, Characteristic,
    log: { debug() {}, warn() {}, error() {} },
    deviceManager: { getDevice: () => device },
  };
  const accessory = { UUID: 'test', context: { config: { type: 'fan', data: {
    on: 'on', off: 'off', fanSpeed33: 'low', fanSpeed66: 'medium', fanSpeed99: 'high',
    clockwise: 'cw', counterClockwise: 'ccw', swingToggle: 'swing',
  }, ...config } }, getService: () => service };
  new FanAccessory(platform, accessory);
  return { controls, sent, device, C: Characteristic };
}

test('three-speed fan selects nearest configured speed and switches off at zero', async () => {
  const { controls, sent } = setup({ speedSteps: 3 });
  const speed = controls.get('RotationSpeed');
  assert.equal(speed.props.minStep, 33);
  await speed.set(70);
  assert.deepEqual(sent, ['on', 'medium']);
  assert.equal(speed.get(), 66);
  await speed.set(65);
  assert.equal(sent.length, 2);
  await speed.set(100);
  await speed.set(0);
  assert.deepEqual(sent, ['on', 'medium', 'high', 'off']);
  assert.equal(speed.get(), 0);
  assert.equal(controls.get('Active').get(), 0);
});

test('failed power or speed transmission does not commit the failed state', async () => {
  const { controls, device } = setup();
  device.sendData = async () => { throw new Error('offline'); };
  await assert.rejects(controls.get('Active').set(1), /offline/);
  assert.equal(controls.get('Active').get(), 0);
  device.sendData = async code => { if (code === 'medium') throw new Error('timeout'); };
  await assert.rejects(controls.get('RotationSpeed').set(66), /timeout/);
  assert.equal(controls.get('RotationSpeed').get(), 0);
  assert.equal(controls.get('Active').get(), 1);
});

test('direction and swing preserve legacy code names and suppress duplicate toggles', async () => {
  const { controls, sent, C } = setup();
  await controls.get(C.RotationDirection).set(1);
  await controls.get(C.RotationDirection).set(0);
  await controls.get(C.SwingMode).set(1);
  await controls.get(C.SwingMode).set(1);
  await controls.get(C.SwingMode).set(0);
  assert.deepEqual(sent, ['ccw', 'cw', 'swing', 'swing']);
});

test('optional controls can be hidden and invalid speed configurations fail clearly', async () => {
  const { controls, C } = setup({ hideSwingMode: true, showRotationDirection: false, data: {} });
  assert.equal(controls.has(C.SwingMode), false);
  assert.equal(controls.has(C.RotationDirection), false);
  await assert.rejects(controls.get('RotationSpeed').set(50), /No fanSpeedXX/);
  await assert.rejects(controls.get('RotationSpeed').set(NaN), /between 0 and 100/);
});
