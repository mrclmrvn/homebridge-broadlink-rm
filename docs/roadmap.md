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
- Shared structured command leaves with bounded expansion and cancellation;
  switch/outlet variants preserve their sequence/repeat options.
- Shared native/file/MQTT sources for sensor and climate controllers, Linux 1-wire
  CRC-checked readings, explicit pseudo temperatures and optional battery telemetry.
- Ping/ARP power estimates and guarded toggles on switch/outlet, TV and fan/purifier;
  ARP inspects cached neighbors and is not fresh physical power confirmation.
- Fan cycling/default resets/timers and light exclusives/timers.
- Explicit file/MQTT garage endpoint/obstruction and standalone bolt feedback.
- Thermostat mode/temperature validation and state commits after successful sends.
- MQTT subscriptions with legacy config support, validated messages, receipt-age
  expiry, reconnect handling, push updates and connection cleanup.
- v5 tests, real HAP service-construction checks, and a three-OS/three-Node CI matrix.
- Setup, migration, diagnostics, accessory, and development/release documentation.

Implementation is distinct from validation: mock-backed accessory coverage does
not verify Broadlink packets or real devices.

## Compatibility and protocol work

- Extend the new in-memory driver tests with real-device fixtures for packet
  framing, error parsing, and discovery across firmware/device families.
- Validate RF learning and Pronto output on actual hardware; frequency support
  remains device-dependent. Expand coverage for uncommon device IDs.
- Validate 1-wire CRC behavior, file access and container mounts on a real Linux
  host; validate battery producers, units and HomeKit presentation in live use.
- Audit advanced light options, jam detection, TV timers/picture modes and advanced
  legacy air-conditioner behavior. Core feedback does not supply motor interlocks
  or automatic obstruction reversal.
- Validate power utilities, cycle reset assumptions and feedback polarity/freshness
  against actual appliances and producers. Optional Eve history is excluded from
  the current implementation scope by user decision.

## Validation and release work

- Audit the declared Homebridge range beyond the development dependency.
  Node engines now match the locked dependency/CI majors (22.12+ in 22.x, 24, 26).
- Validate configuration schema behavior in a live Homebridge UI, especially
  scalar/array switch data, MQTT topic forms and options shared across accessories.
- Exercise hardware across device families and record actual auth, send, IR learn,
  sensor, RF, and reachability results. Confirm appliance responses, not only logs.
- Validate live Homebridge cache restoration/removal, restart, shutdown, TV pairing,
  migration and rollback with representative existing installations.
- Validate installation of the narrowed, automatically built tarball, finalize
  release tooling/changelog, and explicitly publish the scoped alpha when ready.
- Complete any Homebridge verification requirements before claiming a verified
  plugin badge.

## Documentation follow-up after validation

Use the [validation runbook](validation.md) and [report template](validation-report-template.md)
to record which hardware models, firmware and Homebridge/Node versions were actually
tested; add reproducible examples from those checks. Update the setup and
migration guides when compatibility gaps close. Keep historical v4 samples and
references clearly marked until they are deliberately replaced or archived.
