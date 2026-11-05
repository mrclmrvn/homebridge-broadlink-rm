# Automated Homebridge version coverage

The plugin declares Homebridge `^1.6.0 || ^2.0.0` and Node
`^22.12.0 || ^24 || ^26`. A usable combination must satisfy both the plugin's
engines and the selected Homebridge version's engines. Supporting a Node major
in the plugin does not make it compatible with every historical Homebridge
release. See the [Homebridge Node guidance](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js/).

## Targets and recorded local results

The following exact releases were selected from npm on November 5, 2026:

| Homebridge | Role | Selected HAP dependency | Local Node 24.14.1 result |
| --- | --- | --- | --- |
| 1.6.0 | Declared lower boundary | hap-nodejs 0.11.2 | Build and 182 tests pass |
| 1.11.4 | Latest stable 1.x at this checkpoint | hap-nodejs 0.14.3 | Build and 182 tests pass |
| 2.0.0 | Declared 2.x lower boundary | @homebridge/hap-nodejs 2.1.4 | Build and 182 tests pass |
| 2.5.0 | Locked development release | @homebridge/hap-nodejs 2.3.0 | Build and 182 tests pass |

Alternate versions were installed in isolated temporary copies; the project's
development installation and committed lockfile were preserved. These are
representative boundaries/releases, not exhaustive checks of every intervening
Homebridge release. HAP versions above are recorded resolutions: alternative
Homebridge installations can resolve newer dependencies within their own ranges.

## CI matrix

`.github/workflows/pipeline.yml` defines two jobs:

- The existing main matrix uses the locked Homebridge 2.5.0 across Node 22/24/26
  and Ubuntu, Windows and Intel macOS: nine combinations.
- The compatibility matrix overrides only Homebridge to 1.6.0, 1.11.4 or 2.0.0
  on Node 22/24 and Ubuntu: six additional combinations. It starts with locked
  tools, installs the selected version without saving or updating package-lock,
  verifies the actual runtime, then compiles and runs the entire v5 suite.

Node 26 is excluded from the alternative-version matrix: Homebridge 1.11.4 and
2.0.0 do not declare it in their engine ranges. Node 26 remains covered with
Homebridge 2.5.0. Older-version Windows/macOS combinations are not separately
covered by CI. The local results above are distinct from remote workflow
results; the new matrix must run against the pushed commit before claiming
remote success.

## Runtime selection and test scope

`npm run test:homebridge` first reports the selected Homebridge, HAP and Node
versions. It checks the expected version, both Node engine constraints, the
plugin's Homebridge range and the selected Homebridge's HAP dependency range.
The expected version comes from `HOMEBRIDGE_EXPECTED_VERSION` or the committed
lockfile for the normal development run.

All real-HAP tests load HAP through the installed Homebridge package's own module
resolution. They select its declared scoped or unscoped HAP dependency; they
cannot silently keep testing a different HAP package left in node_modules.
The source also compiles against that installed Homebridge's declarations.

`test/v5/homebridgeCompatibility.test.js` additionally exercises real Homebridge
API/PlatformAccessory classes: bridged registration, external TV publication,
context update events and JSON cache serialization/deserialization. It restores
an 18°C AC target while mode stays Off. The test harness loads Homebridge's
internal API constructor for these checks; production plugin code receives the
public API from Homebridge and does not import those internal files.

These checks do not start a Homebridge server or advertiser, pair with HomeKit,
write Homebridge's live cache, or send hardware commands. The visual config UI,
on-disk persistence, real network/device behavior, shutdown of a live server and
migration/rollback still require the [validation runbook](validation.md).
Compatibility installs skip package lifecycle scripts; these tests exercise
JavaScript APIs and types, not service provisioning or native dependencies.

## Running locally

For the locked development version:

```bash
npm ci
npm run test:homebridge
```

For another target, use a disposable checkout/copy. The following environment
assignment is for macOS/Linux shells; CI sets it through the workflow environment:

```bash
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts homebridge@1.6.0
HOMEBRIDGE_EXPECTED_VERSION=1.6.0 npm run test:homebridge
```

Use `npm ci` afterward if reusing that checkout to restore the locked development
dependencies. Choose a Node version satisfying both engine ranges; the preflight
deliberately fails unsupported combinations. Updating targets should include
reviewing release metadata, Node constraints, local results and the matrix.
