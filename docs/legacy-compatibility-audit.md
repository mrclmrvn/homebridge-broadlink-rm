# Legacy configuration compatibility audit

This source audit compares the retained legacy controllers and tests with the
TypeScript implementation. It complements the [contributed config review](legacy-config-coverage.md);
neither is evidence of physical appliance or live Homebridge compatibility.

## AC lookup and configuration findings

| Legacy behavior | Current implementation and decision |
| --- | --- |
| Look up mode-prefixed codes before generic temperature codes | Supported for heatXX, coolXX, autoXX, then temperatureXX |
| Sparse-map fallback chosen by requested temperature versus heatTemperature | Opt-in `fallbackToDefaultTemperature: "legacy"` now reproduces this rule |
| Legacy defaults for sparse fallback | Boundary 22°C; cool default 16°C and heat default 30°C unless configured |
| Legacy fallback retries only a generic temperature key | Preserved in legacy policy; a mode-prefixed default alone is insufficient |
| Mode-default fallback introduced in v5 | `fallbackToDefaultTemperature: true` retains this distinct policy |
| Missing configured fallback | Now fails before any On/mode stage; it cannot silently downgrade to a plain activation command |
| Temperature object with data and pseudo-mode | Complete structured command is retained; the accepted target/mode reflect the selected code |
| Nested commands inside On/mode/temperature stages | User array gaps remain independent of controller delays, including when stage delays are zero |
| Bound total sequence expansion | One 10000-step limit applies across the complete AC plan, validated before sending |
| units: c/f, including uppercase | Configures Thermostat display preference; internal values and command keys remain Celsius |
| persistState: false | Disables AC mode/target restore/cache updates; runtime control still works |
| Persisted power/mode on restart | AC target, mode and last active mode restore without sending IR; other accessory types remain separate |

Legacy fallback depends on the requested temperature, not the selected mode.
For example, with boundary 22°C, a missing Cool request at 24°C retries
`temperature30`, while a missing Heat request at 21°C retries `temperature16`.
That can select a different encoded mode. Pseudo-mode restrictions and ambient
mode validation still apply before any transmission. The plugin reports the
accepted fallback temperature, never the unavailable requested one.

Range and step checks also apply to fallback values. Missing, malformed or
out-of-range fallback entries are errors; there is no guessed physical state.
Explicit opt-in keeps sparse fallback from changing existing strict v5 configs
or the saved-setpoint behavior requested for the contributed installation.

## Intentional differences and remaining gaps

- V5 keeps saved AC setpoints by default. Legacy reset-on-mode-change is available
  explicitly; the contributed installation does not need to enable it.
- Default bounds differ from the legacy controller. Specify bounds/defaults in
  migrated configs; the supplied example already specifies 16–30°C and 25°C.
- `persistState: false` is supported for AC modes and targets. V5 does not reproduce the
  old plugin's general persistence of power, movement and other accessory states.
  Disabling AC persistence ignores an existing saved snapshot without deleting
  it; re-enabling can restore that earlier snapshot.
- Light power monitoring remains a gap: legacy lights inherited Ping/ARP through
  their switch controller; v5 monitoring currently covers switch/outlet, TV and
  fan/purifier types. Do not assume a light's pingIPAddress is active.
- Ambient switch gates currently accept named switch/outlet types in this
  platform. Other legacy controllers exposing switch-like state are not accepted
  as gates; missing or unsupported matches block automation. External HomeKit
  switch linking was not established by this source audit.
- Automatically created legacy learn/scan helpers are replaced by explicit
  learning accessories. Old helper-button hide flags do not recreate them.
- Failure handling, missing measurements, jam feedback and source age rules are
  intentionally explicit. A migration should not rely on old fabricated sensor
  values, optimistic completion or ignored command errors.

Additional configurations may reveal further gaps; recognizing every type name
is not a promise of identical behavior for every legacy option.

## Verification and next work

`test/v5/airConditionerCompatibility.test.js` adds eleven cases for lookup priority,
threshold boundaries, actual fallback state/persistence, missing/out-of-range
fallbacks, ambient mode restrictions, display units, nested timing, aggregate
limits and persistence opt-out. The full suite passes **167 tests** at this
checkpoint. The retained legacy reference files and contributed private JSON are unchanged; no physical IR/RF or network operation is performed by this audit.

Follow-up [Homebridge version coverage](homebridge-compatibility.md) adds exact
1.6.0/1.11.4/2.0.0 targets alongside locked 2.5.0, with selected HAP dependencies
and real API/cache checks. All four passed 169 tests locally on Node 24. The
configured remote matrix and live installations still need release-head results.
Release tooling also needs review against the final package;
the retained legacy release-it configuration is not a validated v5 release path.
Use the [validation runbook](validation.md) to record live UI/cache/pairing,
appliance, migration and rollback results before release claims.
