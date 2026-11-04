# v5 development, CI and release preparation

## Local workflow

The current lockfile installs Homebridge 2.5.0 for development, whose Node engine
range is `^22.12.0 || ^24 || ^26`. Use a matching Node version for source work:

```bash
npm ci
npm test
npm run watch
```

`npm test` runs TypeScript compilation, then Node's built-in test runner over
`test/v5/*.test.js`. Tests use built JavaScript from dist; running the test runner
directly after a source edit without rebuilding can test stale output. `npm run
watch` continuously builds and stays running until stopped.

No lint script is currently configured. The old tests at test/*.test.js target
the legacy implementation and are not part of the v5 suite. Do not treat their
presence as evidence that their behaviors are supported by the new code.

## Source layout

| Path | Purpose |
| --- | --- |
| src/index.ts, settings.ts | Plugin registration and identity |
| src/platform.ts | Dynamic lifecycle, cache cleanup, external TV publishing |
| src/deviceManager.ts | Static/discovered RM device lookup and sockets |
| src/broadlink/ | UDP packets, crypto, discovery, IR learning and native sensors |
| src/accessories/ | HomeKit service and code mappings |
| src/accessories/timed.ts | Serialized commands, cancellable timers/delays for newer controllers |
| src/accessories/sensorSource.ts | Native/file readings, validation and unit conversion |
| src/cli.ts | Standalone diagnostics |
| config.schema.json | Shared Homebridge visual configuration schema |
| test/v5/ | New tests, controlled clocks and service fixtures |
| accessories/, helpers/, base/, index.js, platform.js | Legacy reference implementation |

The package entry point is dist/index.js, not the root legacy index.js. Dist is
generated and gitignored. Runtime npm dependencies are empty; development tools
and the Homebridge test dependency have their own dependency trees.

## Test expectations

Exercise externally visible behavior: code selection, service types, state after
failed sends, cancellation, partial success, and retries. Use controlled timers
for intermediate timing assertions. A real 10 ms timeout can expire before a
setImmediate callback on a loaded CI runner; increasing a delay only hides that
race. The suite also constructs remaining services with real HAP classes to
check initial values and characteristic warnings.

These tests do not establish packet correctness, RF performance, physical state,
or live HomeKit pairing. Driver-focused tests and hardware checks remain on the
[roadmap](v5-roadmap.md). When changing public options, update the relevant v5
guide and schema alongside the implementation.

## GitHub Actions

.github/workflows/pipeline.yml runs npm ci and npm test on pushes, pull requests,
and manual dispatch. The matrix uses Node 22/24/26 across ubuntu-latest,
windows-latest, and macos-15-intel. Intel macOS was selected after ARM64 runner
capacity failures; it does not provide ARM64 CI coverage. Both push and PR events
can produce separate matrix runs for the same commit. Tests must pass without
relying on their scheduling order.

The workflow uses read-only repository permissions and does not publish packages
or install on a user's Homebridge server. Check a run's commit before treating a
green badge as validation for uncommitted or newer source changes.

## Inspect and pack

```bash
npm test
npm pack --dry-run
npm pack
```

Build first: prepublishOnly runs before npm publish, not before npm pack. Check
the dry-run inventory and tarball, including dist/index.js, declarations, schema,
README, and license. There is not yet an explicit files allowlist, so legacy and
test files may also be included. Packaging cleanup is still outstanding.

Install the tarball into an isolated Homebridge environment. Test startup,
restored cache, each used accessory type, missing hardware, command failures,
shutdown, TV external pairing, and actual appliance responses. Do not substitute
mocked service tests for this validation.

## Release work still required

Before publishing an alpha for others, reconcile package.json's broader declared
Node/Homebridge engines with actual tested compatibility, review the tarball
inventory, complete driver tests and a recorded hardware test pass, and check
migration documentation. Verify the package version and final changelog, and
confirm the npm scope/account and dist-tag intended for that release.

A scoped alpha publication would use the following command only when release
preparation and publication are explicitly intended:

```bash
npm publish --access public --tag alpha
```

This guide does not execute a publication or confirm that a package/dist-tag
exists. The legacy .release-it.json is retained, but its associated tooling is
not in the v5 package scripts/dependencies; it is not a validated release path.
Homebridge verification badges/checklist completion have not been claimed.
