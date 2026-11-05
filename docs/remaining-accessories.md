# Remaining v5 accessory types

The TypeScript factory now recognizes every type in the legacy platform registry.
This provides core service and command support, not complete legacy option parity.
All examples belong in the BroadlinkRM platform's `accessories` array. Replace
placeholder codes and set `host` when selecting a specific Broadlink device.

## Type coverage

| Type | HomeKit service | Core support |
| --- | --- | --- |
| `humidifier-dehumidifier` | HumidifierDehumidifier | Power, mode, humidity thresholds, measured-humidity automation |
| `air-purifier` | AirPurifier | Power, manual/auto commands, speed, swing, control lock |
| `temperatureSensor` / `temperature-sensor` | TemperatureSensor, optional HumiditySensor | Native Broadlink and file measurements |
| `humiditySensor` / `humidity-sensor` | HumiditySensor | Native Broadlink and file measurements |
| `heater-cooler` | HeaterCooler | Heat/cool, temperature codes, nested speed/swing codes |
| `outlet` | Outlet | Power, inferred OutletInUse |
| `window` | Window | Same timed movement controls as window-covering |
| `fanv1` | Fan | On, speed, direction |
| `switch-multi` | Switch | Ordered code sequence |
| `switch-repeat` | Switch | Repeated on/off codes |
| `switch-multi-repeat` | Switch | Ordered sequence with per-entry repetitions and pauses |

Existing air-conditioner, fan, TV, light, window-covering, garage-door-opener,
lock, switch, and learning accessories remain available. See the other v5 guides
for their configuration and limitations.

## Humidifier/dehumidifier

```json
{
  "name": "Room Humidity Control",
  "type": "humidifier-dehumidifier",
  "humidifierThreshold": 40,
  "dehumidifierThreshold": 60,
  "humidityUpdateFrequency": 10,
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "targetStateHumidifier": "YOUR_HUMIDIFY_HEX",
    "targetStateDehumidifier": "YOUR_DEHUMIDIFY_HEX",
    "fanOnly": "YOUR_IDLE_HEX"
  }
}
```

Auto mode humidifies below the lower threshold, dehumidifies above the upper
threshold, and idles inside the band (including its boundaries). Defaults are
40% and 60%. The lower threshold cannot exceed the upper threshold. Idle sends
`fanOnly`, or `off` when fanOnly is absent. Active stays enabled while idling,
meaning humidity control remains armed. Humidify-only and dehumidify-only modes
use only their corresponding threshold. `humidifierOnly` / `deHumidifierOnly`
restrict available modes and cannot both be true.

Measurements come from the selected Broadlink device or `humidityFilePath`.
`humidityAdjustment` adds a percentage-point offset. Failed reads report an error
and do not trigger a new humidity-driven command. Active, mode and threshold
writes are serialized with polls; transmission failures retain the affected
previous mode/threshold. A successful power-on remains active if its later mode
command fails, and repeating Active=1 retries the mode command.

`noHumidity: true` disables polling and Auto mode. Manual humidify/dehumidify
commands then operate without a sensor. The required current-humidity getter
still attempts a real reading and reports an error when none exists; no synthetic
humidity is supplied. For reliable Home app measurement display, provide a sensor
source even when using manual controls. Polling defaults to 10 seconds; 0 disables
background updates but getters and active settings still read the sensor.

Like a fan, this service can expose `fanSpeedXX` codes and swing codes. Control
lock is exposed when both `lockControls` and `unlockControls` are supplied.

## Air purifier

```json
{
  "name": "Air Purifier",
  "type": "air-purifier",
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "targetStateManual": "YOUR_MANUAL_HEX",
    "targetStateAuto": "YOUR_AUTO_HEX",
    "fanSpeed50": "YOUR_LOW_HEX",
    "fanSpeed100": "YOUR_HIGH_HEX",
    "swingToggle": "YOUR_SWING_HEX",
    "lockControls": "YOUR_LOCK_CONTROLS_HEX",
    "unlockControls": "YOUR_UNLOCK_CONTROLS_HEX"
  }
}
```

Speed selects the nearest `fanSpeedXX` code. Swing supports `swingOn`/`swingOff`
or `swingToggle`; hide it with `hideSwingMode` or `showSwingMode: false`.
`showLockPhysicalControls: false` hides the control lock. Speed, swing and control
lock appear only when matching codes are supplied. Manual/Auto sends the selected
mode code; these are device mode commands, not a plugin air-quality controller.
Current state is inferred as Inactive or Purifying Air from successful power
commands. No air-quality or filter-life sensor is supplied.

## Sensors

```json
{
  "name": "Room Sensor",
  "type": "temperatureSensor",
  "sensorPollInterval": 10,
  "temperatureAdjustment": 0,
  "humidityAdjustment": 0
}
```

Temperature sensors also expose a separate HumiditySensor service unless
`noHumidity` is true. Humidity-only accessories use `type: "humiditySensor"`.
Native measurements require a Broadlink device with the relevant built-in or
cable sensor. Unsupported or missing measurements report errors, never a
fabricated zero. Polling starts immediately, repeats after each completed read,
and is cancelled on shutdown. Setting `sensorPollInterval: 0` disables background
updates; HomeKit getters still read the source. Legacy `temperatureUpdateFrequency`
/ `humidityUpdateFrequency` are accepted when sensorPollInterval is absent.

For files, set `temperatureFilePath` and/or `humidityFilePath` to a source that
contains one of these formats:

```text
25.5
```

```json
{"temperature":25.5,"humidity":55}
```

```text
temperature: 25.5
humidity: 55
```

A combined temperature file may supply humidity using its explicit humidity
field. A plain number in temperatureFilePath is not reused as humidity. A plain
number in humidityFilePath is read as humidity. Empty, missing, malformed, or
out-of-range data reports an error. Native temperature is Celsius; use
`tempSourceUnits: "f"` for Fahrenheit file temperatures. Temperature adjustment
is applied in Celsius after conversion, while humidity adjustment is in
percentage points. Native Broadlink readings are never converted as Fahrenheit.

MQTT is supported through the legacy broker/topic options; see the
[MQTT guide](mqtt.md). 1-wire and pseudo-device sources are not implemented
by this source reader; their options report a configuration error. Battery data and Eve history
are not yet exposed. The same sensor reader now supplies humidity controllers, HeaterCooler and the
Thermostat-style AC.

## HeaterCooler

```json
{
  "name": "Heater Cooler",
  "type": "heater-cooler",
  "defaultMode": "cool",
  "minTemperature": 16,
  "maxTemperature": 30,
  "coolingThresholdTemperature": 24,
  "heatingThresholdTemperature": 18,
  "data": {
    "heat": {
      "on": "YOUR_HEAT_ON_HEX",
      "off": "YOUR_HEAT_OFF_HEX",
      "temperatureCodes": { "18": "YOUR_HEAT18_HEX" }
    },
    "cool": {
      "on": "YOUR_COOL_ON_HEX",
      "off": "YOUR_COOL_OFF_HEX",
      "temperatureCodes": { "24": "YOUR_COOL24_HEX" }
    }
  }
}
```

This now creates HeaterCooler, replacing the earlier incorrect Thermostat alias.
Cached Thermostat services on this accessory are removed. At least one of
`data.heat` / `data.cool` must be an object; only configured heat/cool modes are
advertised. Plugin-controlled Auto mode is not offered. `defaultMode` defaults
to cool when available, otherwise heat.

Each mode uses its own on/off codes. Activation sends the mode's on code,
followed by the current temperature code when configured. Missing temperature
codes report an error instead of falling back to an unrelated code. Without
`temperatureCodes`, the mode's on code is used. An inactive mode's temperature
threshold can be edited without transmission. Other off-state setting changes
activate the appliance unless `turnOnWhenOff` is false.

`temperatureUnits: "f"` converts configured bounds and thresholds from Fahrenheit;
HomeKit temperature writes and readings are always Celsius. Defaults are 16–30°C,
heating 18°C and cooling 24°C (clamped to the configured range). Native sensor
polling uses `temperatureUpdateFrequency` or sensorPollInterval; 0 disables it.
There is no synthetic fallback reading. Current heating/cooling state is inferred
from the selected active mode; no thermostat regulation or compressor feedback
is implemented.

Temperature entries may nest `rotationSpeedXX` and `swingOn`/`swingOff` codes,
matching the legacy hierarchy. Speed selects the nearest code and reports that
selected speed. `swingToggle` with `swingDnd` supports toggle-based remotes:
the toggle is used for explicit swing changes; other changes use swingDnd.
Optional speed/swing controls are detected from configured code keys. Unsupported
structured sequence objects report an error.

## Outlet, Window and Fan v1

Outlet uses the standard switch `data.on`/`data.off` configuration. OutletInUse
mirrors inferred power, not measured electrical load. Ping/ARP use detection is
not implemented.

Window uses `type: "window"` and the timing/code options from
[moving-accessories.md](moving-accessories.md), with Service.Window.

Fan v1 uses `type: "fanv1"` and the fan's on/off, `fanSpeedXX`, stepSize/speedSteps,
and clockwise/counterClockwise codes. It exposes Service.Fan with On instead of
Active and no swing control. Legacy fan speed cycling, reset defaults and power
timers remain pending as documented in [fan.md](fan.md).

## Switch variants and sequences

Single strings or sequence arrays at the top-level `data` execute on On=true;
Off=false only resets their local state. Object data uses `on` / `off` branches.

```json
{
  "name": "Remote Sequence",
  "type": "switch-multi-repeat",
  "interval": 0,
  "data": [
    { "data": "YOUR_FIRST_HEX", "sendCount": 2, "interval": 0.1, "pause": 0.5 },
    { "data": "YOUR_SECOND_HEX", "sendCount": 1 }
  ]
}
```

`switch-multi` runs an ordered array; `switch-repeat` repeats its selected branch
using `sendCount` or the state-specific `onSendCount`/`offSendCount`. The switch's
`interval` defaults to 1 second and controls gaps between those repeats or array
entries. `switch-multi-repeat` uses per-entry repetition objects. Ordinary switch
and outlet branches also accept strings, arrays, or `{ data, sendCount, interval,
pause }` objects. Structured objects default to one send, 0.1 seconds between
repeats, and no trailing pause. Explicit zero intervals are accepted.

The full sequence is validated before sending. Counts must be integers from
1 to 10000, compiled sequences are limited to 10000 steps, and nested structures
are limited to 20 levels. A partially transmitted sequence cannot be rolled back;
state is committed only after its completion. Shutdown cancels pending delays and
prevents further sends. Writes are serialized per accessory, including repeats.

Stateless switches reset locally after onDuration (default 0.5 seconds) without
sending off. An onDuration without enableAutoOff also retains the existing v5
local-reset behavior. `enableAutoOff: true` sends off after onDuration (default
60 seconds). `enableAutoOn: true` sends on after offDuration (default 60 seconds).
No automatic on command is scheduled at startup.

## Validation and remaining gaps

`npm test` builds and tests type mappings, code selection, repeated sequences,
controlled timers, sensor parsing, transmission failures, and resource cleanup.
A test also constructs all remaining services with real HAP classes and checks
for characteristic warnings. Live Homebridge pairing and physical operation
remain unvalidated.

All legacy type names now resolve, but advanced options remain incomplete.
1-wire/pseudo-device integrations, history, shared structured-code support outside
switch/outlet, and complete legacy accessory behavior remain separate roadmap
work. MQTT support adds MQTT.js as a runtime dependency; the core Broadlink
driver remains based on Node standard libraries.
