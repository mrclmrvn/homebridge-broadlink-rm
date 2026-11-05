# v5 roadmap and validation gaps

This list reflects the current implementation, not a release or hardware
certification. All legacy accessory type names are recognized, but full legacy
configuration parity remains a goal.

The [upstream issue checkpoint](upstream-issue-checkpoint.md) tracks the original
open reports separately from this migration plan, including unresolved fan
direction/speed maps, IR group scheduling, RM Max support and HeaterCooler Auto.

## Implemented foundation

- TypeScript dynamic platform and native Node.js UDP/crypto driver.
- Discovery, corrected authentication/packet validation, IR/RF learning, native
  sensor queries, and raw modulated Pronto conversion.
- Exact static device IDs, address refresh, reliable CLI error status, and an
  explicit package allowlist with automatic prepack builds.
- Two-second native accessory sensor deadlines covering queue/authentication,
  shared in-flight reads, timeout/shutdown cancellation and recovery tests.
- Duplicate accessory identity guards before bridged registration or external TV
  publication, plus MAC rediscovery and TV restart identity regression checks.
- Core service mappings for every legacy accessory type, external TV publishing,
  timed movement and lock controls, humidity automation, and standalone sensors.
- Shared structured command leaves with bounded expansion and cancellation;
  switch/outlet variants preserve their sequence/repeat options.
- Shared native/file/MQTT sources for sensor and climate controllers, Linux 1-wire
  CRC-checked readings, explicit pseudo temperatures and optional battery telemetry.
- Ping/ARP power estimates and guarded toggles on switch/outlet, TV and fan/purifier;
  ARP inspects cached neighbors and is not fresh physical power confirmation.
- Fan cycling/default resets/timers; light exclusives/timers, resend and stateless
  local resets; TV power timers and explicit picture-mode mappings.
- Thermostat flat heat/cool codes, mode/On sequencing, metadata, dry-off, fixed
  Auto replacement and opt-in mode-default resets/fallback without losing the
  default saved-setpoint behavior.
- Explicit appliance Auto with unavailable compressor activity, measured ambient
  thresholds with minimum intervals/manual ownership, and linked physical/virtual
  switch gates that block on missing or ambiguous names.
- Explicit file/MQTT garage endpoint/obstruction, standalone bolt and jam feedback;
  faults cancel inferred transitions and automatic actions without motor commands.
- Thermostat mode/temperature validation, state commits after successful sends,
  and saved target restoration through Homebridge accessory context without
  restoring power mode or transmitting at startup.
- MQTT subscriptions with legacy config support, validated messages, receipt-age
  expiry, reconnect handling, push updates and connection cleanup.
- v5 tests, real HAP service checks and real Homebridge API/cache serialization
  checks using the selected version's own HAP dependency.
- A three-OS/three-Node locked-Homebridge CI matrix plus Ubuntu Homebridge
  1.6.0/1.11.4/2.0.0 checks on Node 22/24; see [coverage](homebridge-compatibility.md).
- Setup, migration, diagnostics, accessory, and development/release documentation.
- Explicit legacy sparse-map fallback, display-unit preference and AC target
  persistence opt-out, with independent nested sequence timing and aggregate limits.
- Anonymized regression coverage for a contributed two-host legacy cooling config,
  including all 16–30°C mappings, disabled fan handling and host routing; see the
  [compatibility review](legacy-config-coverage.md) for remaining behavior differences.

Implementation is distinct from validation: mock-backed accessory coverage does
not verify Broadlink packets or real devices.

## Compatibility and protocol work

- Add scheduled rediscovery and late-device recovery with overlap/shutdown
  handling and explicit discovery-disable semantics; MAC address replacement
  alone does not provide this. Assess failure-triggered sweeps and link-local
  diagnostics from [upstream PR #786](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/786).
- Assess optional custom scan/learn/test configuration UI separately from the
  existing declarative schema and CLI; see [upstream PR #787](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/787).
- Extend the new in-memory driver tests with real-device fixtures for packet
  framing, error parsing, and discovery across firmware/device families.
- Validate RF learning and Pronto output on actual hardware; frequency support
  remains device-dependent. Expand coverage for uncommon device IDs.
- Validate 1-wire CRC behavior, file access and container mounts on a real Linux
  host; validate battery producers, units and HomeKit presentation in live use.
- Audit further real migration cases beyond current fixtures; see the
  [source compatibility audit](legacy-compatibility-audit.md) for supported fallback
  policies and intentional differences.
- Port legacy light Ping/ARP monitoring if required by migration cases; current
  light power state remains inferred. General legacy accessory-state persistence
  and non-switch ambient gate types are not reproduced. External HomeKit gates
  remain outside platform-local linking.
- Validate explicit jam producers and physical recovery. Feedback faults/cancels
  software actions; it does not transmit motor stop/reversal or supply an interlock.
- Validate power utilities, cycle reset assumptions and feedback polarity/freshness
  against actual appliances and producers. Optional Eve history is excluded from
  the current implementation scope by user decision.

## Validation and release work

- Run the new Homebridge matrix on the pushed/release head and validate live
  installations; representative version checks are not exhaustive range proof.
  Node engines match the locked dependency/CI majors (22.12+ in 22.x, 24, 26),
  but each Homebridge release must also support the selected Node version.
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
