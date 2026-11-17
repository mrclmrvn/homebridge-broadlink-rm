const { test } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../config.schema.json');
const fields = schema.schema.properties.accessories.items.properties;

function visible(field, type, index = 0) {
  const condition = fields[field].condition;
  if (!condition) return true;
  const accessories = [{ type: 'garage-door-opener' }, { type: 'fan' }];
  accessories[index] = { type };
  return new Function('model', 'arrayIndices', condition.functionBody)({ accessories }, [index]);
}

test('configuration hides unrelated settings for each accessory type', () => {
  const cases = [
    ['fan', ['speedSteps', 'speedCycle', 'enableAutoOff', 'pingIPAddress'], ['minTemperature', 'temperatureFilePath', 'closedSensor', 'lockSensor', 'defaultBrightness']],
    ['heater-cooler', ['minTemperature', 'temperatureUnits', 'heatingThresholdTemperature', 'mqttTopic'], ['closedSensor', 'lockSensor', 'speedCycle', 'coolOnly', 'humidifierThreshold']],
    ['air-conditioner', ['coolOnly', 'defaultCoolTemperature', 'autoCoolTemperature', 'humidityFilePath'], ['closedSensor', 'jamSensor', 'temperatureUnits', 'speedCycle']],
    ['garage-door-opener', ['closedSensor', 'openSensor', 'obstructionSensor', 'jamSensor', 'autoCloseDelay'], ['lockSensor', 'minTemperature', 'speedSteps', 'mqttTopic']],
    ['lock', ['lockSensor', 'jamSensor', 'autoLockDelay'], ['closedSensor', 'obstructionSensor', 'openDuration', 'minTemperature']],
    ['window-covering', ['totalDurationOpen', 'initialPosition', 'allowResend'], ['closedSensor', 'lockDuration', 'speedSteps']],
    ['light', ['defaultBrightness', 'onDelay', 'stateless', 'exclusives'], ['minTemperature', 'speedCycle', 'closedSensor']],
    ['air-purifier', ['speedSteps', 'speedCycle', 'showLockPhysicalControls'], ['minTemperature', 'closedSensor', 'humidifierThreshold']],
    ['humidifier-dehumidifier', ['humidifierThreshold', 'dehumidifierThreshold', 'humidityFilePath', 'batteryAlerts'], ['minTemperature', 'temperatureAdjustment', 'closedSensor']],
    ['temperature-sensor', ['temperatureFilePath', 'humidityFilePath', 'temperatureAdjustment', 'mqttTopic'], ['data', 'speedSteps', 'closedSensor']],
    ['humidity-sensor', ['humidityFilePath', 'humidityAdjustment', 'humidityUpdateFrequency'], ['temperatureAdjustment', 'w1DeviceID', 'minTemperature']],
    ['switch', ['virtual', 'stateless', 'onDuration', 'sendCount'], ['minTemperature', 'closedSensor', 'speedSteps']],
    ['tv', ['data', 'pingIPAddress', 'enableAutoOff'], ['virtual', 'speedSteps', 'temperatureFilePath']],
    ['learn-code', ['name', 'type', 'host', 'disabled'], ['data', 'persistState', 'minTemperature', 'closedSensor']],
  ];
  for (const [type, shown, hidden] of cases) {
    for (const index of [0, 1]) {
      for (const key of shown) assert.equal(visible(key, type, index), true, `${type}: show ${key} in tab ${index}`);
      for (const key of hidden) assert.equal(visible(key, type, index), false, `${type}: hide ${key} in tab ${index}`);
    }
  }
});

test('legacy accessory aliases have the same visible fields', () => {
  for (const [type, alias] of [
    ['air-conditioner', 'airconditioner'], ['fan', 'fanv1'], ['tv', 'television'],
    ['window-covering', 'window'], ['temperature-sensor', 'temperaturesensor'],
    ['humidity-sensor', 'humiditysensor'], ['learn-code', 'learn-ir'], ['learn-code', 'learn-rf'],
  ]) {
    for (const key of Object.keys(fields)) assert.equal(visible(key, alias), visible(key, type), `${alias}: ${key}`);
  }
  assert.equal(visible('speedSteps', 'FAN'), true);
});

test('visibility conditions tolerate an incomplete form and do not mutate saved values', () => {
  const model = { accessories: [{ type: 'fan', minTemperature: 16, closedSensor: { filePath: '/tmp/closed' } }] };
  const before = structuredClone(model);
  for (const field of Object.values(fields)) {
    if (!field.condition) continue;
    const evaluate = new Function('model', 'arrayIndices', field.condition.functionBody);
    evaluate(model, [0]);
    for (const incomplete of [{}, { accessories: [] }, { accessories: [{}] }]) {
      assert.equal(evaluate(incomplete, [0]), false);
    }
  }
  assert.deepEqual(model, before);
});
