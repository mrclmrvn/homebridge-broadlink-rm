const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
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

test('Plugin Config stages accessory edits without dropping command maps or other settings', async () => {
  assert.equal(schema.customUi, true);
  assert.ok(require('../../package.json').files.includes('homebridge-ui/public'));
  const script = readFileSync(require.resolve('../../homebridge-ui/public/plugin-config.js'), 'utf8');
  const elements = new Map();

  function element() {
    return {
      dataset: {}, validity: {}, options: [], classList: { toggle() {} },
      add(option) { this.options.push(option); },
      replaceChildren() { this.options.length = 0; },
      addEventListener(event, listener) { this[event] = listener; },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute() {},
      append(...children) {
        for (const child of children) {
          child.parentElement = this;
          if (child.id) elements.set(child.id, child);
        }
      }
    };
  }

  for (const id of ['accessory-tabs', 'settings-tab', 'data-tab', 'settings-panel', 'data-panel', 'accessory-settings', 'accessory-fields', 'config-status', 'command-data', 'field-disabled']) {
    elements.set(id, element());
  }
  const data = elements.get('command-data');
  data.name = 'data';
  data.dataset.kind = 'json';
  const original = [{
    platform: 'BroadlinkRM',
    hideWelcomeMessage: true,
    accessories: [
      { name: 'AC', type: 'air-conditioner', defaultCoolTemperature: 24, data: {
        temperature16: { 'pseudo-mode': 'cool', data: '2600' },
        temperature17: ['2601', { data: '2602', sendCount: 2 }]
      } },
      { name: 'Fan', type: 'fan', data: { fanSpeed33: '2603' } },
      { name: 'Switch', type: 'SWITCH', data: '2604' }
    ]
  }];
  const disabled = elements.get('field-disabled');
  disabled.name = 'disabled';
  disabled.type = 'checkbox';
  let staged;
  let canSave = false;
  await runInNewContext(script, {
    document: { getElementById: id => elements.get(id), createElement: element },
    Option: function Option(text, value) { this.text = text; this.value = String(value); },
    homebridge: {
      getPluginConfig: async () => structuredClone(original),
      getPluginConfigSchema: async () => schema,
      disableSaveButton: () => { canSave = false; },
      enableSaveButton: () => { canSave = true; },
      updatePluginConfig: async blocks => { staged = structuredClone(blocks); }
    }
  });

  const form = elements.get('accessory-settings');
  const temperature = elements.get('field-defaultCoolTemperature');
  const type = elements.get('field-type');
  assert.equal(type.value, 'air-conditioner');
  assert.deepEqual(type.options.slice(1).map(({ text, value }) => [text, value]),
    fields.type.oneOf.map(({ title, enum: [value] }) => [title, value]));
  assert.deepEqual(JSON.parse(data.value), original[0].accessories[0].data);
  assert.equal(elements.get('field-speedSteps').parentElement.hidden, true);
  assert.equal(elements.get('field-autoCoolTemperature').parentElement.hidden, false);
  assert.equal(elements.get('field-autoCoolTemperature').value, '');
  const temperatureGroup = temperature.parentElement.parentElement.parentElement;
  const mqttGroup = elements.get('field-mqttURL').parentElement.parentElement.parentElement;
  assert.equal(temperatureGroup.hidden, false);
  assert.equal(mqttGroup.hidden, false);
  temperature.value = '25';
  temperature.valueAsNumber = 25;
  form.input({ target: temperature });
  await new Promise(setImmediate);
  assert.equal(canSave, true);
  const edited = structuredClone(original);
  edited[0].accessories[0].defaultCoolTemperature = 25;
  assert.deepEqual(staged, edited);

  elements.get('data-tab').click();
  assert.equal(elements.get('settings-panel').hidden, true);
  assert.equal(elements.get('data-panel').hidden, false);
  data.value = '{';
  form.input({ target: data });
  assert.equal(canSave, false);
  assert.deepEqual(staged, edited);
  elements.get('accessory-tab-1').click();
  assert.equal(elements.get('accessory-tab-0')['aria-selected'], 'true');
  assert.equal(data.value, '{');

  edited[0].accessories[0].data.temperature16.data = '2605';
  data.value = JSON.stringify(edited[0].accessories[0].data);
  form.input({ target: data });
  await new Promise(setImmediate);
  assert.equal(canSave, true);
  assert.deepEqual(staged, edited);
  elements.get('accessory-tab-1').click();
  assert.equal(elements.get('accessory-tab-1')['aria-selected'], 'true');
  assert.equal(elements.get('settings-panel').hidden, false);
  assert.equal(temperature.parentElement.hidden, true);
  assert.equal(temperatureGroup.hidden, true);
  assert.equal(mqttGroup.hidden, true);
  const speedSteps = elements.get('field-speedSteps');
  assert.equal(speedSteps.parentElement.hidden, false);
  assert.equal(speedSteps.value, '');
  speedSteps.value = '3';
  speedSteps.valueAsNumber = 3;
  form.input({ target: speedSteps });
  await new Promise(setImmediate);
  edited[0].accessories[1].speedSteps = 3;
  assert.deepEqual(staged, edited);
  assert.deepEqual(JSON.parse(data.value), original[0].accessories[1].data);
  assert.equal(disabled.checked, false);
  disabled.checked = true;
  form.input({ target: disabled });
  await new Promise(setImmediate);
  edited[0].accessories[1].disabled = true;
  assert.deepEqual(staged, edited);

  elements.get('accessory-tab-0').click();
  assert.equal(disabled.checked, false);
  elements.get('accessory-tab-1').click();
  assert.equal(disabled.checked, true);
  disabled.checked = false;
  form.input({ target: disabled });
  await new Promise(setImmediate);
  edited[0].accessories[1].disabled = false;
  assert.deepEqual(staged, edited);

  elements.get('accessory-tab-2').click();
  assert.equal(type.value, 'SWITCH');
  assert.equal(type.options.at(-1).value, 'SWITCH');
  type.value = 'outlet';
  form.input({ target: type });
  await new Promise(setImmediate);
  edited[0].accessories[2].type = 'outlet';
  assert.deepEqual(staged, edited);

  type.value = 'garage-door-opener';
  form.input({ target: type });
  await new Promise(setImmediate);
  edited[0].accessories[2].type = 'garage-door-opener';
  const closedSensor = elements.get('field-closedSensor');
  assert.equal(closedSensor.parentElement.hidden, false);
  assert.equal(closedSensor.value, '');
  closedSensor.value = '[]';
  form.input({ target: closedSensor });
  assert.equal(canSave, false);
  assert.deepEqual(staged, edited);
  closedSensor.value = '{"filePath":"/tmp/closed"}';
  form.input({ target: closedSensor });
  await new Promise(setImmediate);
  edited[0].accessories[2].closedSensor = { filePath: '/tmp/closed' };
  assert.equal(canSave, true);
  assert.deepEqual(staged, edited);
});
