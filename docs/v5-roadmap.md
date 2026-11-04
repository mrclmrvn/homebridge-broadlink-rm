# v5 roadmap and validation gaps

This list reflects the current implementation, not a release or hardware
certification. All legacy accessory type names are recognized, but full legacy
configuration parity remains a goal.

## Implemented foundation

- TypeScript dynamic platform and native Node.js UDP/crypto driver.
- Discovery, authentication, IR send/learn and native sensor query paths.
- Core service mappings for every legacy accessory type, external TV publishing,
  timed movement and lock controls, humidity automation, and standalone sensors.
- Switch/outlet code sequences and repeat support; native/file sources for the
  newer sensor, humidity and HeaterCooler implementations.
- v5 tests, real HAP service-construction checks, and a three-OS/three-Node CI matrix.
- Setup, migration, diagnostics, accessory, and development/release documentation.

Implementation is distinct from validation: mock-backed accessory coverage does
not verify Broadlink packets or real devices.

## Compatibility and protocol work

- Audit packet header/framing, checksum, key exchange, error parsing, concurrency,
  socket teardown, malformed replies, and discovery with driver-focused tests.
- Verify exact device IDs and static host selection on RM2/3 and RM4 models;
  add explicit type configuration and address/type refresh where appropriate.
- Implement the RF frequency-sweep learning flow and expose a supported UI/CLI
  path, with separate validation for supported frequencies and device models.
- Port Pronto conversion and shared structured command support beyond switch/outlet.
- Port ping/ARP state detection, external MQTT/1-wire/pseudo sensors, battery data,
  and optional Eve history.
- Close remaining per-type gaps: fan cycling/default resets/timers, light
  exclusives and advanced options, contact/obstruction/jam feedback, and advanced
  legacy air-conditioner behavior.
- Align the older Thermostat's sensor/state/error handling and lifecycle cleanup
  with the newer controllers; complete learning cancellation and consistent
  accessory-owned resource teardown.
- Make CLI operational failures return reliable nonzero status for automation.

## Validation and release work

- Audit declared Node/Homebridge engines against a documented support matrix.
  Current CI validates the locked dependency set on Node 22/24/26, not the entire
  range advertised by package.json.
- Validate configuration schema behavior in a live Homebridge UI, especially
  scalar/array switch data and options shared across accessory forms.
- Exercise hardware across device families and record actual auth, send, IR learn,
  sensor, RF, and reachability results. Confirm appliance responses, not only logs.
- Validate live Homebridge cache restoration/removal, restart, shutdown, TV pairing,
  migration and rollback with representative existing installations.
- Tighten the package file inventory, verify tarball installation, finalize release
  tooling/changelog, and explicitly publish the scoped alpha when ready.
- Complete any Homebridge verification requirements before claiming a verified
  plugin badge.

## Documentation follow-up after validation

Record which hardware models, firmware and Homebridge/Node versions were actually
tested; add reproducible examples from those checks. Update the setup and
migration guides when compatibility gaps close. Keep historical v4 samples and
references clearly marked until they are deliberately replaced or archived.
