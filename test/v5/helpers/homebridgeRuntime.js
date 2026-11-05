const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function packageInfo(entry, name) {
  let directory = path.dirname(entry);
  for (;;) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (info.name === name) return { ...info, directory };
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate ${name} package metadata`);
    directory = parent;
  }
}

const homebridgeEntry = require.resolve('homebridge');
const homebridge = packageInfo(homebridgeEntry, 'homebridge');
const fromHomebridge = createRequire(homebridgeEntry);
const hapName = ['@homebridge/hap-nodejs', 'hap-nodejs'].find(name => homebridge.dependencies?.[name]);
if (!hapName) throw new Error(`Homebridge ${homebridge.version} has no recognized HAP dependency`);
const hap = fromHomebridge(hapName);
const hapPackage = packageInfo(fromHomebridge.resolve(hapName), hapName);
if (!hap.Accessory || !hap.Service || !hap.Characteristic) throw new Error('Selected Homebridge HAP API is incomplete');

function createHomebridgeAPI() {
  // Test harness only: the plugin itself receives the public API from Homebridge.
  const { HomebridgeAPI } = require(path.join(path.dirname(homebridgeEntry), 'api.js'));
  return new HomebridgeAPI();
}

module.exports = { hap, homebridge, hapPackage, createHomebridgeAPI };
