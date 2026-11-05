# Thermostat mode commands and legacy options

`air-conditioner` / `airconditioner` uses the Thermostat service. These options
extend the [basic setup](setup.md); they do not implement compressor feedback or
automatic room-temperature regulation. Use [HeaterCooler](remaining-accessories.md#heatercooler)
for its separate nested `data.heat` / `data.cool` hierarchy.

```json
{
  "name": "Heating and Cooling Unit",
  "type": "air-conditioner",
  "coolOnly": false,
  "defaultCoolTemperature": 25,
  "defaultHeatTemperature": 28,
  "defaultMode": "cool",
  "turnOnWhenOff": true,
  "onDelay": 0.3,
  "modeChangeDelay": 0.25,
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "heat": "YOUR_HEAT_MODE_HEX",
    "cool": "YOUR_COOL_MODE_HEX",
    "heat18": "YOUR_HEAT_18_HEX",
    "cool18": "YOUR_COOL_18_HEX",
    "heat28": { "data": "YOUR_HEAT_28_HEX", "pseudo-mode": "heat" },
    "cool25": { "data": "YOUR_COOL_25_HEX", "pseudo-mode": "cool" }
  }
}
```

Supply every temperature you intend to expose or explicitly enable the fallback
below. Each command accepts strings and [structured sequences](power-and-feedback.md#shared-structured-commands).
The complete selected command plan is validated before any transmission.

## Mode and temperature selection

`coolOnly` restricts modes to Off/Cool; `heatOnly` restricts them to Off/Heat.
They cannot both be true. Otherwise Off/Heat/Cool are offered. Explicit
`defaultMode` must be heat or cool and agree with those restrictions; it selects
the mode used for explicit off-state activation. Startup remains Off.

For active mode Heat/Cool, lookup prefers `heatXX` / `coolXX`, then generic
`temperatureXX`. A mode change sends `data.heat` / `data.cool` first when provided,
then the temperature code after `modeChangeDelay` seconds (default 0.25).
Without a temperature entry, a mode command or plain `data.on` can provide the
existing activation fallback; an active temperature change requires a matching
entry unless default fallback is enabled. Mode commands must be command leaves,
not HeaterCooler's nested setting maps.

Temperature entries may contain `"pseudo-mode": "heat"` or `"cool"`. After a
successful send, both target and inferred current mode reflect that metadata.
Unsupported values or modes conflicting with heatOnly/coolOnly reject the plan
before sending. Device Auto commands/pseudo-mode Auto and closed-loop Auto
regulation remain unsupported. `replaceAutoMode: "heat"` or `"cool"` instead
offers Auto as a selection alias and immediately reports the mapped fixed mode;
it does not switch modes based on room temperature.

## Saved targets and legacy defaults

Accepted targets persist in Homebridge accessory context. A normal restart with
the same identity/cache restores the target without restoring power or sending
IR. Initial/fallback target uses `defaultCoolTemperature` (default 24), or
`defaultHeatTemperature` (default 24) for heatOnly/defaultMode heat.

Preserving that setpoint remains the default. Opt-in
`resetTemperatureOnModeChange: true` uses the configured heat/cool default when
entering that mode, including from Off. Without that option, 18°C → Off → restart
→ Cool still uses 18°C. With reset enabled and a cool default of 25°C, it uses
25°C instead and saves the accepted target.

`fallbackToDefaultTemperature: true` allows a missing temperature entry to use
the selected mode's configured default code. The target reports the temperature
actually selected; it never sends a default code while claiming the unavailable
request succeeded. Without a configured mode default, the current target is the
fallback candidate. Missing fallback codes still fail.

## Startup, Off and automatic commands

`turnOnWhenOff: true` sends `data.on` first when activating, then waits `onDelay`
seconds (default 0.3) before mode/temperature commands. `sendOnWhenOff` is the
legacy alias used only when turnOnWhenOff is absent. Missing `data.on` is an error.
Explicit zero delays work. Shutdown cancels delays and remaining commands.

Temperature writes while Off are deferred by default. Explicit
`ignoreTemperatureWhenOff: false` makes a changed temperature activate the last
used mode, or defaultMode before one has been used. This is an explicit activation
policy; it does not enable sensor-driven automation.

Off sends `data.offDryMode` when the inferred current mode was Cool and that code
exists, otherwise `data.off`. After successful commands, `enableAutoOff` /
`enableAutoOn` schedule real power changes using positive `onDuration` /
`offDuration` seconds (default 60). Auto-on resumes the last used fixed mode.
Explicit `disableAutomaticOff` / `disableAutomaticOn` override the corresponding
enable flag: false enables, true disables. No power timer starts at startup.

Identical mode/temperature requests are suppressed by default. `allowResend: true`
allows retransmission; when allowResend is absent, `preventResendHex: false` also
enables it. Failed command plans do not commit the requested mode/target. Already
transmitted portions cannot be undone, and physical activity remains unverified.

The tests cover command order, zero/nonzero delays, partial failures, cancellation,
defaults/fallback, metadata, normalized HomeKit values, timers and persisted targets.
Legacy ambient-temperature auto-on/off rules, linked auto switches, device Auto
and complete legacy fallback heuristics remain outside this implementation.
