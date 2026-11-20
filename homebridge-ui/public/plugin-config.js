(async () => {
  const accessoryTabs = document.getElementById('accessory-tabs');
  const sectionTabs = ['settings-tab', 'data-tab'].map(id => document.getElementById(id));
  const sections = ['settings-panel', 'data-panel'].map(id => document.getElementById(id));
  const form = document.getElementById('accessory-settings');
  const acFields = document.getElementById('ac-fields');
  const acSettings = document.getElementById('ac-settings');
  const status = document.getElementById('config-status');
  const commandData = document.getElementById('command-data');
  const commandEditorHost = document.getElementById('command-editor');
  const instructions = 'Use JSON Config for platform settings, adding accessories, or editing other options.';
  const controls = new Map([
    ['data', commandData],
    ['disabled', document.getElementById('field-disabled')]
  ]);
  const accessories = [];
  const tabs = [];
  let selectedAccessory = 0;
  const errors = new Map();
  let blocks;
  let accessoryTypes;
  let revision = 0;
  let commandEditor;
  let loadingEditor = false;
  let switchingAccessory = false;
  let pending = Promise.resolve();

  function addField(container, name, title, kind = 'text', choices) {
    const field = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'form-label';
    label.htmlFor = 'field-' + name;
    label.textContent = title;
    const control = document.createElement(choices ? 'select' : 'input');
    control.className = choices ? 'form-select' : 'form-control';
    control.id = label.htmlFor;
    control.name = name;
    control.dataset.kind = kind;
    control.setAttribute('aria-describedby', 'config-status');
    if (choices) {
      for (const [value, caption] of choices) control.add(new Option(caption, value));
    } else {
      control.type = kind;
      if (kind === 'number') control.step = 'any';
    }
    field.append(label, control);
    container.append(field);
    controls.set(name, control);
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
      button.addEventListener('click', () => select(index));
      button.addEventListener('keydown', event => {
        const next = {
          ArrowLeft: (index + buttons.length - 1) % buttons.length,
          ArrowRight: (index + 1) % buttons.length,
          Home: 0,
          End: buttons.length - 1
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        if (select(next)) buttons[next].focus();
      });
    });
    select(0);
    return select;
  }

  async function showCommandEditor() {
    if (commandEditor || loadingEditor || !globalThis.createBroadlinkCommandEditor) return;
    loadingEditor = true;
    try {
      const darkMode = await homebridge.userCurrentLightingMode?.() === 'dark';
      commandEditorHost.hidden = false;
      commandEditor = globalThis.createBroadlinkCommandEditor(commandEditorHost, commandData.value, darkMode);
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
    for (const [name, control] of controls) {
      const value = accessory[name];
      if (name === 'type') {
        control.replaceChildren();
        const placeholder = new Option('Select a type', '');
        placeholder.disabled = true;
        control.add(placeholder);
        for (const { title, enum: [type] } of accessoryTypes) control.add(new Option(title, type));
        if (typeof value === 'string' && value && !accessoryTypes.some(({ enum: [type] }) => type === value)) {
          control.add(new Option(value, value));
        }
      }
      if (control.type === 'checkbox') control.checked = value === true;
      else control.value = value === undefined ? '' : name === 'data' ? JSON.stringify(value, null, 2) : String(value);
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
    showAcFields(accessory);
  }

  function showAcFields(accessory) {
    acSettings.hidden = !['air-conditioner', 'airconditioner'].includes(String(accessory.type).toLowerCase());
  }

  function fieldValue(control) {
    if (control.type === 'checkbox') return control.checked;
    const value = control.value;
    if (control.validity.badInput) throw new Error('Enter a valid number.');
    if (value === '') {
      if (control.name === 'name' || control.name === 'type') throw new Error('Name and type are required.');
      return undefined;
    }
    switch (control.dataset.kind) {
      case 'number': return control.valueAsNumber;
      case 'boolean': return value === 'true';
      case 'json': {
        if (!value.trim()) return undefined;
        let data;
        try {
          data = JSON.parse(value);
        } catch {
          throw new Error('Enter valid JSON for the command data.');
        }
        if (data === null || (typeof data !== 'object' && typeof data !== 'string')) {
          throw new Error('Command data must be a JSON object, array, or string.');
        }
        return data;
      }
      default: return value;
    }
  }

  homebridge.disableSaveButton();
  try {
    const [config, configSchema] = await Promise.all([
      homebridge.getPluginConfig(),
      homebridge.getPluginConfigSchema()
    ]);
    blocks = config;
    accessoryTypes = configSchema.schema.properties.accessories.items.properties.type.oneOf;
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
        accessoryTabs.append(tab);
        tabs.push(tab);
        accessories.push(accessory);
      }
    }
  } catch {
    status.textContent = 'Unable to load the configuration. Close Settings and try again.';
    return;
  }

  if (!accessories.length) {
    status.textContent = 'Use JSON Config to add your first accessory.';
    return;
  }

  const fields = document.getElementById('accessory-fields');
  const toggle = [['', 'Default'], ['true', 'Yes'], ['false', 'No']];
  addField(fields, 'name', 'Name');
  addField(fields, 'type', 'Type', 'text', []);
  addField(fields, 'host', 'Host (IP or MAC)');
  addField(acFields, 'minTemperature', 'Minimum temperature', 'number');
  addField(acFields, 'maxTemperature', 'Maximum temperature', 'number');
  addField(acFields, 'tempStepSize', 'Temperature step size', 'number');
  addField(acFields, 'coolOnly', 'Cool only', 'boolean', toggle);
  addField(acFields, 'defaultCoolTemperature', 'Default cooling temperature', 'number');
  addField(acFields, 'defaultMode', 'Default mode', 'text', [['', 'Default'], ['cool', 'Cool'], ['heat', 'Heat'], ['auto', 'Auto']]);
  addField(acFields, 'turnOnWhenOff', 'Send power-on command when off', 'boolean', toggle);

  const selectSection = bindTabs(sectionTabs, index => {
    sections.forEach((section, position) => { section.hidden = position !== index; });
    if (index === 1) void showCommandEditor();
    return true;
  });
  bindTabs(tabs, index => {
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
  form.hidden = false;
  status.textContent = instructions;
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', ({ target }) => {
    const accessory = accessories[selectedAccessory];
    const name = target.name;
    if (controls.get(name) !== target) return;
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

    showAcFields(accessory);
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
