# Contributed legacy cooling configuration: compatibility coverage

A working legacy configuration was supplied for comparison on November 5, 2026.
It contains two RM4-configured hosts, an explicit learning button, two cooling-only
Thermostats, and a disabled three-speed fan. This report records software coverage
for that configuration shape, not physical appliance validation or complete v4
behavioral parity.

The original Desktop file is unchanged and is not tracked in this repository.
`test/v5/fixtures/legacy-cooling-platform.json` replaces names, IP/MAC addresses
and every learned code with test values. It omits the original child-bridge
identity. Code lengths, nested entries, configured options and the relationship
between On/default-temperature codes are preserved. Synthetic codes are test
bytes and must not be used to operate appliances.

## Configuration review

| Configuration detail | Current v5 behavior |
| --- | --- |
| Two static hosts with `isRM4: true` | Supported; accessories can select them by IP or MAC. Exact model/device IDs still need discovery or explicit `devType` |
| Explicit `learn-code` accessory | Supported; construction is covered here and learning behavior has separate mocked tests |
| Two `air-conditioner` accessories with `coolOnly: true` | Thermostat services expose Off/Cool |
| `defaultCoolTemperature: 25`, bounds 16–30, step 1 | Initial/fallback target 25°C; valid saved targets are restored from the Homebridge cache |
| All `temperature16` through `temperature30` entries | Each nested data string is selected and routed to its configured host in tests |
| `{ "pseudo-mode": "cool", "data": "..." }` | The data wrapper works. Mode metadata is not interpreted; it is redundant for these cooling-only units |
| `ignoreTemperatureWhenOff: true` | The requested effect matches v5's existing rule: temperature writes while Off are stored without sending IR. False/omitted legacy behavior is not reproduced |
| `defaultMode: "cool"` | No separate AC startup-mode handling is implemented. Both units start Off and Cool is their only active mode |
| Distinct `data.on` and `temperature25` codes | Turning on prefers the selected temperature code. A separate On command is not automatically sent first |
| Disabled fan, three speeds at 33/66/99 | Skipped during registration; an existing cached disabled accessory is removed. The same fan mapping works when explicitly enabled in a test |
| `defaultFanSpeed: 33` | Does not itself send a reset-speed command; default reset requires `alwaysResetToDefaults` |
| `hideScanFrequencyButton: true` | No automatic scan button is created by v5; explicit learning accessories are separate |
| `hideWelcomeMessage: true` | No legacy welcome banner exists; ordinary v5 startup logs remain |
| `_bridge` settings | Owned by Homebridge; live child-bridge identity/pairing is outside this test |

All supplied command strings were checked locally for complete hexadecimal byte
pairs, and both ACs have every temperature entry in their configured range.
That checks representation and coverage, not the meaning of the IR pulses.

## Known behavior differences to verify

V5 starts each AC Off with target 25°C when no valid saved target exists. The last
accepted target is persisted in Homebridge context and restored for the same
identity/cache after restart. If a user chooses 27°C while Off, v5 stores 27°C
without transmitting, then sends `temperature27` when Cool is enabled.
The legacy mode-change path resets to `defaultCoolTemperature` when entering
Cool; this behavior is not yet reproduced. Test the desired user flow explicitly.

Cooling activity is inferred from successful sends, not compressor feedback.
Current room temperature/humidity require an actual supported sensor; there is
no file or MQTT source in this contributed configuration. RM4 framing support
does not prove that either physical RM has the expected sensor hardware.

Both hosts set `isRM4` without an exact device ID. The static fallback selects an
RM4 Mini ID unless RF support is declared; discovery can replace it with the real
device ID. Confirm the actual IDs instead of guessing a Mini/Pro model from the
flag. See [driver configuration](protocol.md).

The fan is disabled in the supplied config, so no fan controls are registered.
If enabled, it has no direction or swing codes: hide those controls if unsupported
using `hideRotationDirection` and `hideSwingMode` rather than expecting their
writes to work without data.

## Automated evidence and next physical checks

`test/v5/legacyConfig.test.js` constructs real HAP services while replacing device
registration, discovery and command transport with in-memory doubles. It checks
startup without sending, disabled cache removal, all thirty AC temperature
selections, per-host routing, Off, deferred temperature changes, state after send
failures, and all three fan speeds when enabled in a test. No real network probe,
IR learning, transmission, Homebridge deployment or pairing is performed.

The original review added four cases. Follow-up tests cover persisted targets
across serialized cache restoration, startup without sends, invalid saved values,
failed command handling and cache-update errors. An additional regression changes
an active AC from 25°C to 18°C, turns it Off, restores snapshots captured by the
cache API and checks that two ACs retain independent targets without startup
commands. `npm test` now passes 120 tests.
This exercises Homebridge's cache API boundary, not live on-disk crash recovery.
Record actual installation, discovery/authentication, sensor capabilities,
temperature-code appliance responses, startup/pairing and Off/On flow using the
[validation runbook](validation.md) and [report template](validation-report-template.md).
Keep the original working config and a rollback path for that supervised trial.
