(async () => {
  const accessoryTabs = document.getElementById('accessory-tabs');
  const sectionTabs = ['settings-tab', 'data-tab'].map(id => document.getElementById(id));
  const sections = ['settings-panel', 'data-panel'].map(id => document.getElementById(id));
  const form = document.getElementById('accessory-settings');
  const deleteAccessoryButton = document.getElementById('delete-accessory');
  const cancelAccessoryButton = document.getElementById('cancel-accessory');
  const status = document.getElementById('config-status');
  const commandData = document.getElementById('command-data');
  const commandEditorHost = document.getElementById('command-editor');
  const commandWrapLines = document.getElementById('command-wrap-lines');
  const instructions = 'Use JSON Config for platform settings or editing options outside the accessory schema.';
  const addAccessoryTab = document.getElementById('add-accessory');
  const controls = new Map([
    ['data', commandData],
    ['disabled', document.getElementById('field-disabled')]
  ]);
  const settings = new Map();
  const groups = [];
  const groupDefinitions = [
    ['Temperature', [
      'coolOnly', 'heatOnly', 'minTemperature', 'maxTemperature', 'tempStepSize',
      'defaultMode', 'defaultCoolTemperature', 'defaultHeatTemperature', 'defaultAutoTemperature',
      'replaceAutoMode', 'resetTemperatureOnModeChange', 'fallbackToDefaultTemperature',
      'ignoreTemperatureWhenOff', 'modeChangeDelay', 'heatingThresholdTemperature',
      'coolingThresholdTemperature', 'autoHeatTemperature', 'autoCoolTemperature',
      'minimumAutoOnOffDuration', 'autoMinimumDuration', 'autoSwitchName', 'autoSwitch',
      'heatTemperature', 'units', 'temperatureUnits', 'tempSourceUnits', 'temperatureFilePath',
      'temperatureAdjustment', 'temperatureUpdateFrequency', 'pseudoDeviceTemperature',
      'w1DeviceID', 'w1Device'
    ]],
    ['Humidity', [
      'humidifierOnly', 'deHumidifierOnly', 'noHumidity', 'humidifierThreshold',
      'dehumidifierThreshold', 'humidityFilePath', 'humidityAdjustment', 'humidityUpdateFrequency'
    ]],
    ['MQTT', ['mqttURL', 'mqttUsername', 'mqttPassword', 'mqttTopic', 'mqttMaxAge']],
    ['Fan controls', [
      'fanSpeedByDirection', 'speedSteps', 'stepSize', 'hideRotationSpeed', 'hideSwingMode', 'hideRotationDirection', 'defaultRotationSpeed',
      'fanStepSize', 'speedCycle', 'speedCycleInterval', 'defaultSpeedStep', 'defaultFanSpeed',
      'alwaysResetToDefaults'
    ]],
    ['Brightness', ['availableBrightnessSteps', 'defaultBrightness', 'useLastKnownBrightness']],
    ['Power and timing', [
      'enableAutoOn', 'enableAutoOff', 'disableAutomaticOn', 'disableAutomaticOff', 'onDelay',
      'onDuration', 'offDuration', 'turnOnWhenOff', 'sendOnWhenOff', 'powerSensor', 'pingIPAddress',
      'pingUseArp', 'pingIPAddressStateOnly', 'pingFrequency', 'pingTimeout', 'pingGrace', 'minimumPingFailures',
      'irDeviceGroup', 'interval', 'sendCount', 'onSendCount', 'offSendCount'
    ]],
    ['Travel and position', [
      'totalDurationOpen', 'totalDurationClose', 'openDuration', 'closeDuration',
      'openCloseDuration', 'lockDuration', 'unlockDuration', 'lockUnlockDuration',
      'autoCloseDelay', 'autoLockDelay', 'initialPosition', 'sendStopAt0', 'sendStopAt100',
      'initialDelay'
    ]],
    ['Sensor feedback', [
      'stateFeedback', 'closedSensor', 'openSensor', 'obstructionSensor', 'lockSensor', 'jamSensor',
      'sensorPollInterval', 'batteryAlerts', 'batteryFilePath'
    ]]
  ];
  const accessories = [];
  const tabs = [];
  const newAccessories = new Set();
  const editedNewAccessories = new Set();
  let selectedAccessory = 0;
  const errors = new Map();
  let blocks;
  let properties;
  let revision = 0;
  let commandEditor;
  let loadingEditor = false;
  let switchingAccessory = false;
  let pending = Promise.resolve();

  function addField(container, name, schema) {
    const { title, description, type, oneOf, format } = schema;
    const choices = oneOf?.map(({ title, enum: [value] }) => [value, title]) ??
      schema.enum?.map(value => [value, String(value)]) ??
      (type === 'boolean' ? [[true, 'Yes'], [false, 'No']] : undefined);
    const types = Array.isArray(type) ? type : [type];
    const structured = !choices && (types.length > 1 || ['object', 'array'].includes(type));
    const numeric = type === 'number' || type === 'integer';
    const field = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'form-label';
    label.htmlFor = 'field-' + name;
    label.textContent = title;
    const control = document.createElement(choices ? 'select' : structured ? 'textarea' : 'input');
    control.className = choices ? 'form-select' : 'form-control';
    control.id = label.htmlFor;
    control.name = name;
    control.setAttribute('aria-describedby', 'config-status');
    if (structured) {
      control.rows = 3;
      control.spellcheck = false;
      control.placeholder = 'JSON';
    } else if (!choices) {
      control.type = numeric ? 'number' : format === 'password' ? 'password' : 'text';
      if (numeric) control.step = type === 'integer' ? '1' : 'any';
    }
    field.append(label, control);
    if (description) {
      const help = document.createElement('div');
      help.className = 'form-text';
      help.id = control.id + '-help';
      help.textContent = description;
      control.setAttribute('aria-describedby', help.id + ' config-status');
      field.append(help);
    }
    container.append(field);
    controls.set(name, control);
    settings.set(name, {
      field, choices, types, structured, numeric, required: schema.required === true,
      visible: schema.condition && new Function('model', 'arrayIndices', schema.condition.functionBody)
    });
    return field;
  }

  function addSettings() {
    const general = document.getElementById('accessory-fields');
    const panel = document.getElementById('settings-panel');
    const remaining = new Map(Object.entries(properties).filter(([name]) => !controls.has(name)));
    function addFields(container, names) {
      return names.map(name => {
        const field = addField(container, name, remaining.get(name));
        remaining.delete(name);
        return field;
      });
    }

    addFields(general, ['name', 'type', 'host']);
    for (const [title, names] of [...groupDefinitions, ['Other settings']]) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'broadlink-group';
      const legend = document.createElement('legend');
      legend.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'broadlink-fields';
      const fields = addFields(grid, (names ?? [...remaining.keys()]).filter(name => remaining.has(name)));
      if (!fields.length) continue;
      fieldset.append(legend, grid);
      panel.append(fieldset);
      groups.push({ fieldset, fields });
    }
  }

  function bindTabs(buttons, activate) {
    function select(index) {
      if (!activate(index)) return false;
      buttons.forEach((button, position) => {
        const active = position === index;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      return true;
    }

    buttons.forEach((button, index) => {
      button.addEventListener('click', () => select(buttons.indexOf(button)));
      button.addEventListener('keydown', event => {
        const currentIndex = buttons.indexOf(button);
        const next = {
          ArrowLeft: (currentIndex + buttons.length - 1) % buttons.length,
          ArrowRight: (currentIndex + 1) % buttons.length,
          Home: 0,
          End: buttons.length - 1
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        if (select(next)) buttons[next].focus();
      });
    });
    if (buttons.length) select(0);
    return select;
  }

  async function showCommandEditor() {
    if (commandEditor || loadingEditor || !globalThis.createBroadlinkCommandEditor) return;
    loadingEditor = true;
    try {
      const darkMode = await homebridge.userCurrentLightingMode?.() === 'dark';
      commandEditorHost.hidden = false;
      commandEditor = globalThis.createBroadlinkCommandEditor(commandEditorHost, commandData.value, darkMode);
      commandEditor.updateOptions({ wordWrap: commandWrapLines.checked ? 'on' : 'off' });
      commandEditor.onDidChangeModelContent(() => {
        if (switchingAccessory) return;
        commandData.value = commandEditor.getValue();
        commandData.dispatchEvent(new Event('input', { bubbles: true }));
      });
      commandData.classList.add('d-none');
    } catch {
      commandEditor?.dispose();
      commandEditor = undefined;
      commandEditorHost.hidden = true;
    } finally {
      loadingEditor = false;
    }
  }

  function renderAccessory() {
    const accessory = accessories[selectedAccessory];
    const isNewAccessory = newAccessories.has(accessory);
    cancelAccessoryButton.hidden = !isNewAccessory;
    deleteAccessoryButton.hidden = isNewAccessory;
    for (const [name, control] of controls) {
      const value = accessory[name];
      const setting = settings.get(name);
      if (setting?.choices) {
        control.replaceChildren();
        const placeholder = new Option(setting.required ? 'Select a type' : 'Default', '');
        placeholder.disabled = Boolean(setting.required);
        control.add(placeholder);
        for (const [choice, title] of setting.choices) control.add(new Option(title, String(choice)));
        if (value !== undefined && value !== '' && !setting.choices.some(([choice]) => choice === value)) {
          control.add(new Option(String(value), String(value)));
        }
      }
      if (control.type === 'checkbox') control.checked = value === true;
      else if (value === undefined) control.value = '';
      else control.value = name === 'data' || setting?.structured ? JSON.stringify(value, null, 2) : String(value);
      control.removeAttribute('aria-invalid');
    }
    if (commandEditor) {
      switchingAccessory = true;
      try {
        commandEditor.setValue(commandData.value);
      } finally {
        switchingAccessory = false;
      }
    }
    updateFieldVisibility();
  }

  function updateFieldVisibility() {
    for (const { field, visible } of settings.values()) {
      field.hidden = Boolean(visible && !visible({ accessories }, [selectedAccessory]));
    }
    for (const { fieldset, fields } of groups) {
      fieldset.hidden = fields.every(field => field.hidden);
    }
  }

  function fieldValue(control) {
    if (control.type === 'checkbox') return control.checked;
    const { name, value } = control;
    const setting = settings.get(name);
    if (control.validity.badInput) throw new Error('Enter a valid number.');
    if (value === '') {
      if (setting?.required) throw new Error('Name and type are required.');
      return undefined;
    }
    if (setting?.numeric) {
      if (control.validity.stepMismatch) throw new Error('Enter a whole number.');
      return control.valueAsNumber;
    }
    if (setting?.choices) {
      const choice = setting.choices.find(([option]) => String(option) === value);
      return choice ? choice[0] : value;
    }
    if (name === 'data' || setting?.structured) {
      if (!value.trim()) return undefined;
      const title = name === 'data' ? 'Command data' : properties[name].title;
      const types = name === 'data' ? properties.data.type : setting.types;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error(title + ' must be valid JSON.');
      }
      const type = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
      if (!types.includes(type)) throw new Error(title + ' requires JSON of type ' + types.join(' or ') + '.');
      return parsed;
    }
    return value;
  }

  homebridge.disableSaveButton();
  commandWrapLines.addEventListener('change', () => {
    commandEditor?.updateOptions({ wordWrap: commandWrapLines.checked ? 'on' : 'off' });
  });
  try {
    const [config, configSchema] = await Promise.all([
      homebridge.getPluginConfig(),
      homebridge.getPluginConfigSchema()
    ]);
    blocks = config;
    properties = configSchema.schema.properties.accessories.items.properties;
    addSettings();
    const configuredAccessories = blocks.flatMap(block => Array.isArray(block?.accessories) ? block.accessories : []);
    const hasLearningAccessory = configuredAccessories.some(accessory =>
      ['learn-ir', 'learn-code'].includes(String(accessory?.type || '').toLowerCase()));
    if (!hasLearningAccessory) {
      let platformBlock = blocks.find(block => block?.platform === 'BroadlinkRM') || blocks[0];
      if (!platformBlock) {
        platformBlock = { platform: 'BroadlinkRM', name: 'BroadlinkRM' };
        blocks.push(platformBlock);
      }
      const defaults = [];
      if (!platformBlock.hideLearnButton) defaults.push({ name: 'Learn', type: 'learn-code' });
      if (!platformBlock.hideScanFrequencyButton) {
        defaults.push({ name: 'Scan Frequency', type: 'learn-code', scanFrequency: true });
      }
      if (defaults.length) {
        if (!Array.isArray(platformBlock.accessories)) platformBlock.accessories = [];
        platformBlock.accessories.push(...defaults);
        try {
          await homebridge.updatePluginConfig(JSON.parse(JSON.stringify(blocks)));
          homebridge.enableSaveButton();
        } catch {
          status.textContent = 'Default learning accessories were added but could not be applied. Edit a field to retry.';
        }
      }
    }
    for (const block of blocks) {
      if (!Array.isArray(block.accessories)) continue;
      for (const accessory of block.accessories) {
        if (!accessory || typeof accessory !== 'object' || Array.isArray(accessory)) continue;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'nav-link';
        tab.id = 'accessory-tab-' + accessories.length;
        tab.textContent = accessory.name || accessory.type || 'Unnamed accessory';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'accessory-settings');
        accessoryTabs.insertBefore(tab, addAccessoryTab);
        tabs.push(tab);
        accessories.push(accessory);
      }
    }
  } catch {
    status.textContent = 'Unable to load the configuration. Close Settings and try again.';
    return;
  }

  const selectSection = bindTabs(sectionTabs, index => {
    sections.forEach((section, position) => { section.hidden = position !== index; });
    if (index === 1) void showCommandEditor();
    return true;
  });
  const selectAccessory = bindTabs(tabs, index => {
    if (errors.size) {
      status.textContent = 'Fix the current accessory’s invalid field before switching accessories. ' +
        errors.values().next().value;
      return false;
    }
    selectedAccessory = index;
    form.setAttribute('aria-labelledby', tabs[index].id);
    renderAccessory();
    selectSection(0);
    return true;
  });
  addAccessoryTab.addEventListener('click', () => {
    if (errors.size) {
      status.textContent = 'Fix the current accessory’s invalid field before adding another. ' +
        errors.values().next().value;
      return;
    }
    let block = blocks.find(item => item && typeof item === 'object' && !Array.isArray(item));
    if (!block) {
      block = {};
      blocks.push(block);
    }
    if (!Array.isArray(block.accessories)) block.accessories = [];
    const accessory = {};
    newAccessories.add(accessory);
    block.accessories.push(accessory);
    accessories.push(accessory);
    form.hidden = false;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'nav-link';
    tab.id = 'accessory-tab-' + (accessories.length - 1);
    tab.textContent = 'Add new accessory';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'accessory-settings');
    accessoryTabs.insertBefore(tab, addAccessoryTab);
    tabs.push(tab);
    addAccessoryTab.classList.remove('active');
    addAccessoryTab.setAttribute('aria-selected', 'false');
    // Bind the new tab using the same selection behavior as existing accessories.
    tab.addEventListener('click', () => selectAccessory(tabs.indexOf(tab)));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      if (event.key === 'ArrowLeft') tabs[index - 1]?.focus();
      if (event.key === 'ArrowRight') addAccessoryTab.focus();
    });
    selectAccessory(tabs.length - 1);
    const snapshot = JSON.parse(JSON.stringify(blocks));
    homebridge.disableSaveButton();
    status.textContent = 'Applying changes…';
    pending = pending.then(async () => {
      try {
        await homebridge.updatePluginConfig(snapshot);
        status.textContent = instructions;
        homebridge.enableSaveButton();
      } catch {
        status.textContent = 'Unable to apply changes. Edit a field to retry.';
      }
    });
  });
  cancelAccessoryButton.addEventListener('click', () => {
    const accessory = accessories[selectedAccessory];
    if (!newAccessories.has(accessory)) return;
    if (editedNewAccessories.has(accessory) &&
      !confirm('Discard your edits to this new accessory?')) return;
    revision++;
    errors.clear();
    for (const block of blocks) {
      if (!Array.isArray(block.accessories)) continue;
      const index = block.accessories.indexOf(accessory);
      if (index >= 0) {
        block.accessories.splice(index, 1);
        if (!block.accessories.length) delete block.accessories;
        break;
      }
    }
    const index = selectedAccessory;
    tabs[index].remove();
    tabs.splice(index, 1);
    accessories.splice(index, 1);
    newAccessories.delete(accessory);
    editedNewAccessories.delete(accessory);
    cancelAccessoryButton.hidden = true;
    if (tabs.length) {
      selectAccessory(Math.min(index, tabs.length - 1));
    } else {
      form.hidden = true;
      sections.forEach(section => { section.hidden = true; });
    }
    const snapshot = JSON.parse(JSON.stringify(blocks));
    homebridge.disableSaveButton();
    status.textContent = 'Applying changes…';
    pending = pending.then(async () => {
      try {
        await homebridge.updatePluginConfig(snapshot);
        status.textContent = instructions;
        homebridge.enableSaveButton();
      } catch {
        status.textContent = 'Unable to apply changes. Edit a field to retry.';
      }
    });
  });
  deleteAccessoryButton.addEventListener('click', () => {
    const accessory = accessories[selectedAccessory];
    if (!accessory || newAccessories.has(accessory)) return;
    const name = accessory.name || accessory.type || 'this accessory';
    if (!confirm(`Delete "${name}" from the plugin configuration?`)) return;
    revision++;
    errors.clear();
    for (const block of blocks) {
      if (!Array.isArray(block.accessories)) continue;
      const index = block.accessories.indexOf(accessory);
      if (index >= 0) {
        block.accessories.splice(index, 1);
        if (!block.accessories.length) delete block.accessories;
        break;
      }
    }
    const index = selectedAccessory;
    tabs[index].remove();
    tabs.splice(index, 1);
    accessories.splice(index, 1);
    if (tabs.length) {
      selectAccessory(Math.min(index, tabs.length - 1));
    } else {
      form.hidden = true;
      sections.forEach(section => { section.hidden = true; });
      deleteAccessoryButton.hidden = true;
      cancelAccessoryButton.hidden = true;
    }
    const snapshot = JSON.parse(JSON.stringify(blocks));
    homebridge.disableSaveButton();
    status.textContent = 'Applying changes…';
    pending = pending.then(async () => {
      try {
        await homebridge.updatePluginConfig(snapshot);
        status.textContent = instructions;
        homebridge.enableSaveButton();
      } catch {
        status.textContent = 'Unable to apply changes. Edit a field to retry.';
      }
    });
  });
  form.hidden = false;
  status.textContent = instructions;
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', ({ target }) => {
    const accessory = accessories[selectedAccessory];
    const name = target.name;
    if (controls.get(name) !== target) return;
    if (newAccessories.has(accessory)) editedNewAccessories.add(accessory);
    const edit = ++revision;
    homebridge.disableSaveButton();
    try {
      const value = fieldValue(target);
      if (value === undefined) delete accessory[name];
      else accessory[name] = value;
      errors.delete(name);
      target.removeAttribute('aria-invalid');
    } catch (error) {
      errors.set(name, error.message);
      target.setAttribute('aria-invalid', 'true');
    }

    if (errors.size) {
      status.textContent = errors.values().next().value;
      return;
    }

    updateFieldVisibility();
    tabs[selectedAccessory].textContent = accessory.name || accessory.type || 'Unnamed accessory';
    const snapshot = JSON.parse(JSON.stringify(blocks));
    status.textContent = 'Applying changes…';
    pending = pending.then(async () => {
      if (edit !== revision) return;
      try {
        await homebridge.updatePluginConfig(snapshot);
        if (edit !== revision) return;
        status.textContent = instructions;
        homebridge.enableSaveButton();
      } catch {
        if (edit === revision) status.textContent = 'Unable to apply changes. Edit a field to retry.';
      }
    });
  });
})();
