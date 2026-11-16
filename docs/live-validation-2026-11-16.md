# Scoped live validation — November 16, 2026

User-reported checks on native Ubuntu, Homebridge 2.5.0 and an RM4 reporting
device type `0x653a`, using local `5.0.0-alpha.1` test packages. The later
`auth-fix` and `ac-diagnostics` artifacts contain the changes in this PR.
These observations cover one AC, not the entire plugin or device matrix.
Private logs, pairing identifiers, network addresses and package archives are
excluded from this record.

| Check | Observation |
| --- | --- |
| Initial sensor/authentication failure | Discovery succeeded, but v5 ignored a matching, checksummed authentication reply whose command field appeared as `0x03E9`. |
| Corrected authentication | Reading opcode byte `0x26` accepted that reply. Standalone authentication and sensor reads completed in about 70 ms total. |
| Native sensor response | Successful reading: 29.64 C and 49.11% humidity; sensor reply command field appeared as `0x03EE`. Continued freshness in the UI is not separately recorded here. |
| Homebridge UI control | User confirmed physical AC control after the authentication fix. |
| Off to Cool using only a temperature code | Broadlink acknowledged the writes, but the physical AC stayed Off. Logs confirmed the requests reached the plugin and were not skipped. |
| Explicit power-on | With `turnOnWhenOff: true` and the existing `data.on`, user confirmed power-on from Apple Home. No default behavior was changed. |
| Target-temperature persistence | After restart with target 23 C, HomeKit initially showed Off. User confirmed subsequent power-on used 23 C. |

The initial Off mode after restart is expected. This record does not establish
previous-mode restoration or a separately observed no-IR startup check. The
complete 18 C round-trip was not explicitly confirmed after enabling the On code.

A second RM/AC had intermittent missing sensors under v4 as well, reportedly
recovering after a power cycle. Its v5 physical control and sensor validation
remain outstanding. The earlier v4/v5 replacement also affected one accessory's
scene/automation links; identity preservation is deferred at the user's request.

Migration and rollback scripts, other accessory types and broader hardware
coverage need their own validation. This record is not a full release sign-off.
