# Thermostat mode commands and legacy options

`air-conditioner` / `airconditioner` uses the Thermostat service. These options
extend the [basic setup](setup.md). Device Auto and explicit ambient-threshold
control are separate features; neither provides compressor feedback. Use [HeaterCooler](remaining-accessories.md#heatercooler)
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
The complete selected command plan is validated before any transmission, with
one aggregate 10000-step limit. User-defined arrays retain their default 0.1-second
gaps inside each command leaf, independently of On/mode stage delays.

## Mode and temperature selection

`coolOnly` restricts operating modes to Off/Cool, with the tile activation alias
described below; `heatOnly` restricts modes to Off/Heat.
They cannot both be true. Otherwise Off/Heat/Cool are offered, with device Auto
when appropriate mappings exist. Explicit `defaultMode` may be heat, cool or auto
and must agree with the available modes or fixed Auto replacement; it selects
the mode used for explicit off-state activation. Startup restores a valid saved
mode when persistence is enabled; otherwise it begins Off. Configured ambient
thresholds can act on the first valid poll/message.

### Apple Home tile power-on compatibility

Some Apple Home clients send mode `1` (Heat) when tapping an Off thermostat tile,
even when the advertised valid modes are only `0` (Off) and `2` (Cool).
Homebridge rejects that write before the plugin handler, and Apple Home may show
No Response despite working sensors and explicit Cool selection.

For a cool-only AC, the compatibility behavior is automatic:

```json
"coolOnly": true
```

V5 accepts mode 1 as an activation alias for Cool, using the retained
target temperature or the configured startup default. It does not send Heat
codes or save Heat as the operating mode. Reads and deferred display updates
normalize the reported target to Cool (2). Off still sends the normal Off code.

Homebridge's public characteristic API uses the same valid-values list for
advertising and validating writes, so Heat must also appear as an accepted value.
Apple Home may therefore show a Heat selection; for a cool-only AC it means Cool.
Heat-only and combined Heat/Cool ACs retain normal Heat behavior. The temporary
`homeAppTileOn` flag used in an earlier test build has been removed and can be
deleted from configuration after upgrading. This is separate from `turnOnWhenOff: true`, which
sends `data.on` before the chosen temperature code when the appliance needs it.

For active mode Heat/Cool/Auto, lookup prefers `heatXX` / `coolXX` / `autoXX`,
then generic `temperatureXX`. A mode change sends `data.heat` / `data.cool` /
`data.auto` first when provided,
then the temperature code after `modeChangeDelay` seconds (default 0.25).
Without a temperature entry, a mode command or plain `data.on` can provide the
existing activation fallback; an active temperature change requires a matching
entry unless default fallback is enabled. Mode commands must be command leaves,
not HeaterCooler's nested setting maps.

Temperature entries may contain `"pseudo-mode": "heat"`, `"cool"` or `"auto"`.
After a successful send, the reported target reflects the encoded mode.
Unsupported values or modes conflicting with heatOnly/coolOnly reject the plan
before sending. `replaceAutoMode: "heat"` or `"cool"` offers Auto as a selection
alias and reports the mapped fixed mode; that explicit replacement takes
precedence over device Auto when processing a mode request.

### Device Auto

Without heatOnly/coolOnly restrictions, Auto is available when `data.auto`, an
`autoXX` entry, or a generic temperature entry with pseudo-mode auto is configured.
For example, `data.auto` can select appliance Auto, while `data.auto24` supplies
its 24°C setting. Missing active temperature codes still fail rather than
pretending to change a setpoint. `defaultAutoTemperature` supplies an optional
Auto default, including opt-in reset/fallback behavior.

Device Auto delegates regulation to the appliance. Its target mode is Auto, but
CurrentHeatingCoolingState reports unavailable because the plugin cannot observe
whether the compressor is heating, cooling or idle. It never reports a fabricated
Off/Heat/Cool activity. Selecting a fixed mode or Off restores inferred activity.
Choosing device Auto also suspends plugin ambient-threshold actions until a
fixed mode or Off is selected. A fixed replaceAutoMode alias is distinct from
appliance Auto.

## Saved state and legacy defaults

Accepted targets, operating modes and the last active mode persist in Homebridge
accessory context. After a restart or process crash, the same identity/cache
restores the last saved state: Cool at 23°C returns as Cool at 23°C, while Off
stays Off. Restoration sends no IR and does not start automatic power timers.
Explicit ambient automation may act later on a fresh reading.
Initial/fallback target uses `defaultCoolTemperature` (default
24), `defaultHeatTemperature` (default 24) for heatOnly/defaultMode heat, or
`defaultAutoTemperature` falling back to the cool default for defaultMode auto.

Preserving that setpoint remains the default. Opt-in
`resetTemperatureOnModeChange: true` uses the configured heat/cool default when
entering that mode, including from Off. Without that option, 18°C → Off → restart
→ Cool still uses 18°C. With reset enabled and a cool default of 25°C, it uses
25°C instead and saves the accepted target.

`fallbackToDefaultTemperature: true` allows a missing temperature entry to use
the selected mode's configured default code. The target reports the temperature
actually selected; it never sends a default code while claiming the unavailable
request succeeded. Without a configured mode default, the current target is the
fallback candidate. Missing fallback codes fail before any On/mode command;
they do not downgrade to a plain activation fallback.

`fallbackToDefaultTemperature: "legacy"` selects the original sparse-map rule:
first try the exact mode/generic entry; if missing, compare the requested target
to `heatTemperature` (default 22°C). At or above the boundary, retry only generic
`temperature<defaultHeatTemperature>` (default 30°C); below it, retry only generic
`temperature<defaultCoolTemperature>` (default 16°C). The selected mode does not
choose that fallback. Range/step checks and pseudo-mode restrictions still apply. Configured startup
and mode defaults must also align with the configured minimum/step.
See the [compatibility audit](legacy-compatibility-audit.md) for concrete examples.

`persistState` defaults to true. Explicit false ignores all saved AC state and
skips state cache updates; startup uses the configured target and mode Off.
Existing saved data is not deleted and can be restored if persistence is later
re-enabled. Older target-only snapshots restore their temperature but start Off;
select a mode once with this build to save it for subsequent restarts.

State is saved after the whole command sequence succeeds, including mode-only
changes and Off. Accepted off-state temperature edits are saved immediately.
Failed commands do not overwrite the saved state. These saves use Homebridge's
cache-update API when the change is accepted, not a shutdown-only flush. Storage
errors, termination before the update finishes, cache removal and power loss can
still lose a change. A failed partial IR sequence can also leave the physical AC
different from the last successfully saved state.

Saved temperatures must match the current range/step, and saved modes must match
the current configuration. Invalid fields fall back to startup defaults/Off.
An Auto mode invalidated by a new `replaceAutoMode` setting is not silently
translated into a physical Heat/Cool transition. Activity in restored Auto stays
unknown; no compressor feedback is invented. Other modes remain inferred from
the last successful command, so an external remote or appliance power loss can
desynchronize the displayed state. Restoring a mode does not physically turn an
AC back on after its own power loss.

## Startup, Off and automatic commands

`turnOnWhenOff: true` sends `data.on` first when activating, then waits `onDelay`
seconds (default 0.3) before mode/temperature commands. `sendOnWhenOff` is the
legacy alias used only when turnOnWhenOff is absent. Missing `data.on` is an error.
Explicit zero delays work. Shutdown cancels delays and remaining commands.

Temperature writes while Off are deferred by default. Explicit
`ignoreTemperatureWhenOff: false` makes a changed temperature activate the last
used mode, or defaultMode before one has been used. This is an explicit activation
policy; ambient-threshold automation below is configured independently.

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

## Ambient-threshold automation and linked switches

Ambient control is opt-in through `autoHeatTemperature` and/or
`autoCoolTemperature`, both in Celsius. A valid measurement strictly below the
heat threshold selects Heat; strictly above the cool threshold selects Cool.
When both are present, heat must be below cool. Equality is in the inactive band.
Only allowed fixed modes may be configured, and pseudo temperatures are rejected
as automation sources. Native, file and MQTT temperature readings are supported.

```json
{
  "autoHeatTemperature": 18,
  "autoCoolTemperature": 27,
  "minimumAutoOnOffDuration": 120,
  "autoSwitchName": "Climate Automation"
}
```

The selected mode uses the existing saved target and command selection, including
explicit reset/fallback options. Command metadata conflicting with the desired
ambient mode is rejected before transmitting. Returning to the inactive band
sends Off only when the plugin owns the current automatic run. A manual mode or
setpoint write takes ownership back, so entering the band does not switch off
that manual run. A failed manual command does not change ownership.

`minimumAutoOnOffDuration` defaults to 120 seconds; `autoMinimumDuration` is the
legacy alias. It bounds automatic changes and retries after failed sends. A
successful manual write also starts this interval before another automatic
change is permitted. Explicit 0 removes the interval. Reevaluation requires a
later valid poll/message: no standalone timer sends a command merely because
the interval ended. Manual Off pauses automation for the interval; it does not
permanently disable explicitly configured thresholds. Use the gate to disable
future ambient actions.

`autoSwitchName` (legacy alias `autoSwitch`) requires exactly one currently
registered switch/outlet accessory with that name and On=true. Missing, disabled,
ambiguous or non-switch matches block actions. The name is case-sensitive and
need not appear before the AC in the config. The gate reads plugin state without
sending commands. Turning it Off suspends future actions and leaves a running AC
unchanged; it is not an emergency-stop control. Manual AC commands and separately
configured power timers remain independent of this ambient gate.

A local enable toggle can be configured as a separate accessory:

```json
{
  "name": "Climate Automation",
  "type": "switch",
  "virtual": true
}
```

Virtual switch/outlet state starts Off on restart. Do not supply data or a power
probe to a virtual accessory; enabling/disabling it sends no IR/RF. A physical
switch/outlet can also be linked, using its last reported plugin state.

Background sensor polls and MQTT temperature updates drive ambient decisions;
getters only read measurements. With polling disabled, native/file sources will
not regulate automatically; MQTT push updates still work. Missing, malformed,
stale or disconnected temperatures issue no ambient command, including Off.
Existing power is left as last reported and manual Off remains available.
Battery-only MQTT updates never drive the controller. Selecting device Auto
suspends this fixed-mode controller.

If thresholds are configured without a gate, the first valid startup reading may
activate the appliance. With a virtual gate, startup stays gated Off until that
toggle is enabled. This activation comes from explicit automation configuration,
not from restoring the saved target.

Tests cover command order, failures/cancellation, defaults/fallback, metadata,
HomeKit values, timers, persisted targets, device Auto, thresholds, minimum
intervals, manual ownership, missing/ambiguous/virtual gates and MQTT expiry.
Strict, mode-default and legacy sparse fallback policies are documented above.
Other migration differences are recorded in the [compatibility audit](legacy-compatibility-audit.md).
Linked gates belong to this platform; arbitrary third-party HomeKit linking is
outside this implementation. Live sensor/appliance and Homebridge validation
remain required.

`units: "c"` / `"f"` (case insensitive) selects the Thermostat display preference.
It does not convert temperature command keys, saved targets or ambient thresholds;
those remain Celsius. Input measurement conversion still uses `tempSourceUnits`.

## Sync mode from an external source

If a separate receiver or integration can report the AC's mode after someone
uses the physical remote, publish that mode to MQTT. Configure **MQTT AC Mode
Feedback** under **Settings → Sensor feedback**, or add this to the
`air-conditioner` accessory:

```json
{
  "stateFeedback": {
    "mqttURL": "mqtt://broker.example",
    "mqttTopic": "living-room/ac/mode"
  }
}
```

Publish `off`, `heat`, `cool`, or `auto` as text, or use JSON such as
`{"mode":"cool"}`. A custom payload path can use
`{"identifier":"mode","topic":"living-room/ac","path":"hvac.mode"}` in a
`mqttTopic` array. Publish the actual mode after a command has taken effect.
This integration consumes reported modes. It does not put the Broadlink RM in
continuous learning mode or interpret the remote's raw codes.

A valid mode change updates HomeKit and saved state without transmitting IR/RF.
The target temperature stays as set in HomeKit. Unsupported modes, retained
messages from before subscription, and stale or malformed reports are ignored.
`mqttMaxAge` defaults to 300 seconds. A successful HomeKit transmission
takes precedence over reports queued during that transmission. An external
mode change cancels outstanding automatic power timers and uses the same
ambient automation hold as a manual HomeKit write.
