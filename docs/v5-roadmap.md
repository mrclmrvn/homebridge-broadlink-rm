# v5 roadmap and validation gaps

This list reflects the current implementation, not a release or hardware
certification. All legacy accessory type names are recognized, but full legacy
configuration parity remains a goal.

## Implemented foundation

- TypeScript dynamic platform and native Node.js UDP/crypto driver.
- Discovery, corrected authentication/packet validation, IR/RF learning, native
  sensor queries, and raw modulated Pronto conversion.
- Exact static device IDs, address refresh, reliable CLI error status, and an
  explicit package allowlist with automatic prepack builds.
- Core service mappings for every legacy accessory type, external TV publishing,
  timed movement and lock controls, humidity automation, and standalone sensors.
- Switch/outlet code sequences and repeat support; native/file sources for the
  newer sensor, humidity and HeaterCooler implementations.
- v5 tests, real HAP service-construction checks, and a three-OS/three-Node CI matrix.
- Setup, migration, diagnostics, accessory, and development/release documentation.

Implementation is distinct from validation: mock-backed accessory coverage does
not verify Broadlink packets or real devices.

## Compatibility and protocol work

- Extend the new in-memory driver tests with real-device fixtures for packet
  framing, error parsing, and discovery across firmware/device families.
- Validate RF learning and Pronto output on actual hardware; frequency support
  remains device-dependent. Expand coverage for uncommon device IDs.
- Port shared structured command support beyond switch/outlet.
- Port ping/ARP state detection, external MQTT/1-wire/pseudo sensors, battery data,
  and optional Eve history.
- Close remaining per-type gaps: fan cycling/default resets/timers, light
  exclusives and advanced options, contact/obstruction/jam feedback, and advanced
  legacy air-conditioner behavior.
- Align the older Thermostat's sensor/state/error handling and lifecycle cleanup
  with the newer controllers; complete consistent accessory-owned resource teardown.

## Validation and release work

- Audit the declared Homebridge range beyond the development dependency.
  Node engines now match the locked dependency/CI majors (22.12+ in 22.x, 24, 26).
- Validate configuration schema behavior in a live Homebridge UI, especially
  scalar/array switch data and options shared across accessory forms.
- Exercise hardware across device families and record actual auth, send, IR learn,
  sensor, RF, and reachability results. Confirm appliance responses, not only logs.
- Validate live Homebridge cache restoration/removal, restart, shutdown, TV pairing,
  migration and rollback with representative existing installations.
- Validate installation of the narrowed, automatically built tarball, finalize
  release tooling/changelog, and explicitly publish the scoped alpha when ready.
- Complete any Homebridge verification requirements before claiming a verified
  plugin badge.

## Documentation follow-up after validation

Record which hardware models, firmware and Homebridge/Node versions were actually
tested; add reproducible examples from those checks. Update the setup and
migration guides when compatibility gaps close. Keep historical v4 samples and
references clearly marked until they are deliberately replaced or archived.
