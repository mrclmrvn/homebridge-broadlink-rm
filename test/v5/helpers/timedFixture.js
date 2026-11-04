const { performance } = require('node:perf_hooks');
const { createAccessoryInstance } = require('../../../dist/accessories');

function fixture(t, type, options = {}) {
  const constants = {
    Active: { INACTIVE: 0, ACTIVE: 1 },
    RotationDirection: { CLOCKWISE: 0, COUNTER_CLOCKWISE: 1 },
    SwingMode: { SWING_DISABLED: 0, SWING_ENABLED: 1 },
    TargetAirPurifierState: { MANUAL: 0, AUTO: 1 },
    CurrentAirPurifierState: { INACTIVE: 0, IDLE: 1, PURIFYING_AIR: 2 },
    TargetHumidifierDehumidifierState: { HUMIDIFIER_OR_DEHUMIDIFIER: 0, HUMIDIFIER: 1, DEHUMIDIFIER: 2 },
    CurrentHumidifierDehumidifierState: { INACTIVE: 0, IDLE: 1, HUMIDIFYING: 2, DEHUMIDIFYING: 3 },
    TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2 },
    CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
    PositionState: { DECREASING: 0, INCREASING: 1, STOPPED: 2 },
    CurrentDoorState: { OPEN: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, STOPPED: 4 },
    TargetDoorState: { OPEN: 0, CLOSED: 1 },
    LockCurrentState: { UNSECURED: 0, SECURED: 1, UNKNOWN: 3 },
    LockTargetState: { UNSECURED: 0, SECURED: 1 },
  };
  const names = ['Manufacturer', 'Model', 'SerialNumber', 'FirmwareRevision', 'CurrentPosition',
    'TargetPosition', 'HoldPosition', 'ObstructionDetected', 'On', 'OutletInUse', 'RotationSpeed', 'LockPhysicalControls',
    'CurrentTemperature', 'CurrentRelativeHumidity', 'RelativeHumidityHumidifierThreshold', 'RelativeHumidityDehumidifierThreshold',
    'CoolingThresholdTemperature', 'HeatingThresholdTemperature', ...Object.keys(constants)];
  const C = Object.fromEntries(names.map(name => [name, { ...constants[name] }]));
  const S = Object.fromEntries(['AccessoryInformation', 'WindowCovering', 'Window', 'GarageDoorOpener', 'LockMechanism', 'Fan', 'Fanv2', 'AirPurifier', 'HumidifierDehumidifier', 'TemperatureSensor', 'HumiditySensor', 'Switch', 'Outlet', 'Thermostat', 'HeaterCooler'].map(name => [name, { UUID: name }]));
  class Accessory {
    constructor(name, uuid) { this.displayName = name; this.UUID = uuid; this.context = {}; this.services = []; }
    getService(type) { return this.services.find(service => service.UUID === type.UUID); }
    removeService(service) { this.services.splice(this.services.indexOf(service), 1); }
    addService(type) {
      const controls = new Map();
      const service = {
        UUID: type.UUID, controls,
        getCharacteristic(key) {
          if (!controls.has(key)) controls.set(key, {
            onGet(fn) { this.get = fn; return this; },
            onSet(fn) { this.set = fn; return this; },
            updateValue(value) { this.value = value; return this; },
            setProps(props) { this.props = props; return this; },
          });
          return controls.get(key);
        },
        updateCharacteristic(key, value) { this.getCharacteristic(key).value = value; return this; },
        setCharacteristic(key, value) { return this.updateCharacteristic(key, value); },
        testCharacteristic(key) { return controls.has(key); },
        removeCharacteristic(characteristic) {
          for (const [key, value] of controls) if (value === characteristic) controls.delete(key);
        },
      };
      this.services.push(service);
      return service;
    }
  }
  let now = 0;
  const timers = new Map();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    const handle = {};
    timers.set(handle, { callback, due: now + delay });
    return handle;
  });
  t.mock.method(global, 'clearTimeout', handle => timers.delete(handle));
  const clock = {
    timers,
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await new Promise(resolve => setImmediate(resolve));
      }
      now = end;
    },
  };
  const sent = [];
  const errors = [];
  const readings = { temperature: 24, humidity: 50 };
  const device = { async sendData(code) { sent.push(code); }, async checkSensors() { return { ...readings }; } };
  const log = { info() {}, debug() {}, warn() {}, error(message) { errors.push(message); } };
  const platform = { Service: S, Characteristic: C, log, deviceManager: { getDevice: () => device } };
  const config = { name: 'Test', type, data: { open: 'open', close: 'close', stop: 'stop', lock: 'lock', unlock: 'unlock' }, ...options };
  const accessory = new Accessory('Test', 'test');
  accessory.context.config = config;
  const instance = createAccessoryInstance(platform, accessory);
  t.after(() => instance.dispose());
  const service = accessory.services.find(service => service.UUID !== S.AccessoryInformation.UUID);
  const control = name => service.getCharacteristic(C[name]);
  return { instance, platform, accessory, config, sent, device, readings, clock, errors, C, S, Accessory,
    control, get: name => control(name).get(), set: (name, value) => control(name).set(value) };
}

module.exports = { fixture };
