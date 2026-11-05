const assert = require('node:assert/strict');
const { hap, homebridge, hapPackage } = require('../v5/helpers/homebridgeRuntime');

const expected = process.env.HOMEBRIDGE_EXPECTED_VERSION || require('../../package-lock.json').packages['node_modules/homebridge'].version;
console.log(`Compatibility target: Homebridge ${homebridge.version}, ${hapPackage.name} ${hapPackage.version}, Node ${process.version}`);
assert.equal(homebridge.version, expected,
  'Installed Homebridge must match the compatibility target');
// Use the declared dependency range, not an unrelated HAP package left in node_modules.
const semver = require(require.resolve('semver', { paths: [homebridge.directory] }));
assert.ok(semver.satisfies(hapPackage.version, homebridge.dependencies[hapPackage.name]), 'HAP must satisfy this Homebridge dependency');
assert.ok(semver.satisfies(process.version, homebridge.engines.node), 'Node must satisfy the selected Homebridge engine range');
const plugin = require('../../package.json');
assert.ok(semver.satisfies(homebridge.version, plugin.engines.homebridge), 'Homebridge must be in the plugin declared range');
assert.ok(semver.satisfies(process.version, plugin.engines.node), 'Node must satisfy plugin engines');
assert.equal(typeof hap.Service.Thermostat, 'function');
