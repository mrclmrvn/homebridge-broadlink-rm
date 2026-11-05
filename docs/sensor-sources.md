# Sensor sources and battery telemetry

Temperature/humidity sensors, Thermostat-style AC, HeaterCooler and humidity
controllers share one source reader. Configured external sources do not fall
back to a different source when their readings fail. Battery support is opt-in
through `batteryAlerts: true`; optional Eve history remains excluded.

## Source selection

| Quantity | Priority, highest first |
| --- | --- |
| Temperature | Explicit pseudo constant, MQTT, temperature file, 1-wire, native RM |
| Humidity | MQTT, humidity file, explicit humidity field in temperature file, native RM |
| Battery | MQTT, battery file, explicit battery field in temperature file or humidity file |

Native RM, 1-wire and pseudo sources do not supply battery data. Temperature-only
1-wire/pseudo configurations do not fall through to native humidity and omit the
default secondary humidity service. Configure a separate humidity file or MQTT
source when humidity is available. `noHumidity` still suppresses secondary
humidity. A combined temperature file must contain an explicit humidity/battery
field; a single temperature number is never reused for those quantities.

For file sources, see [file formats](remaining-accessories.md#sensors). A dedicated
`batteryFilePath` accepts a plain number, JSON `{ "battery": 45 }`, or a
`battery: 45` line. Combined files use the same explicit battery field/line.
Files are reread on demand and on configured polls; file timestamps are not
interpreted as measurement freshness. Use MQTT expiry when receipt-age limits
are required. These climate file semantics are separate from the bounded-age
[binary feedback sources](power-and-feedback.md#file-and-mqtt-binary-feedback).

## Linux 1-wire temperature

```json
{
  "name": "Wired Room Sensor",
  "type": "temperatureSensor",
  "w1DeviceID": "28-000005e2fdc3",
  "sensorPollInterval": 10,
  "temperatureAdjustment": 0
}
```

The reader opens `/sys/bus/w1/devices/<w1DeviceID>/w1_slave`. Supply the ID of
the actual sensor exposed inside the Homebridge host/container; the plugin does
not enable kernel modules or mount host devices. The legacy `w1Device` flag may
accompany `w1DeviceID`; a device-ID string in `w1Device` is also accepted. A flag
alone is insufficient. IDs must be two hexadecimal family digits, a hyphen and
twelve hexadecimal digits, preventing path traversal.

The reader requires the first line's CRC result to be `YES`, then parses signed
integer millidegrees Celsius after `t=` on the second line. Failed CRC, missing
files or malformed values report errors; no previous value or zero is supplied.
This follows the [Linux w1_therm interface](https://cdn.kernel.org/doc/html/latest/w1/slaves/w1_therm.html).
1-wire remains Celsius even if `tempSourceUnits` is `f`; Celsius adjustment is
applied afterward. Broadlink native temperatures follow the same unit rule.

The existing source poll intervals apply; no independent 1-wire timer is added.
Reads begin only when polled or requested and use an abort signal on shutdown.
Tests use fixtures; real Linux sensor, CRC-failure and container-access checks
remain necessary before claiming hardware validation.

## Explicit pseudo temperature

```json
{
  "name": "Configured Temperature",
  "type": "temperatureSensor",
  "pseudoDeviceTemperature": 22,
  "sensorPollInterval": 0
}
```

`pseudoDeviceTemperature` is a user-supplied constant in Celsius, including zero.
It is never a measured room temperature or a fallback after another source fails.
When configured, it overrides the temperature reading; other quantities still
use their configured sources. It must be a finite number in HomeKit's supported
range, −270 to 100°C. `temperatureAdjustment` applies in Celsius afterward.
Do not use this value as evidence of physical temperature when evaluating
heating/cooling behavior. Thermostat-style AC still infers activity from commands
and does not regulate the appliance using this constant.

## Native read deadlines

Native sensor reads have a two-second deadline covering the device command queue,
authentication and sensor response together. Concurrent native reads from the
same accessory share an in-flight request. On timeout, the request is cancelled
and HomeKit receives an unavailable reading; no stale measurement or default
temperature is substituted. A later read can recover normally. Shutdown cancels
pending reads and clears their deadlines. File, 1-wire and MQTT source behavior
is unchanged; the two-second deadline applies only to native RM reads through
the accessory source reader, not standalone CLI sensor queries.

The deadline leaves room before Homebridge's usual slow-handler warning. It is
not a guarantee against warnings if the Node event loop itself is blocked.

## Optional battery status

```json
{
  "name": "Wireless Room Sensor",
  "type": "temperatureSensor",
  "batteryAlerts": true,
  "sensorPollInterval": 0,
  "mqttURL": "mqtt://broker.local",
  "mqttMaxAge": 300,
  "mqttTopic": [
    { "identifier": "temperature", "topic": "room/state", "path": "temperature" },
    { "identifier": "humidity", "topic": "room/state", "path": "humidity" },
    { "identifier": "battery", "topic": "room/state", "path": "battery" }
  ]
}
```

`batteryAlerts` adds a separate HomeKit Battery service to the sensor or climate
accessory. BatteryLevel is a percentage from 0 to 100, rounded to the nearest
integer for HomeKit. StatusLowBattery is Low at 20% or below and Normal above
20%, using that rounded value. Missing or invalid data faults both readings;
zero is valid and no source defaults to 100%. Charging telemetry is unavailable
and ChargingState reports an error rather than assuming charging capability.
Disabling `batteryAlerts` removes the cached Battery service on restart.

MQTT supports an explicit `battery` identifier, scalar battery topics, nested
paths and battery aliases in combined JSON: `battery`, `batteryLevel`,
`battery_level`, `batteryPercentage`, `battery_percentage` (case insensitive).
Numeric strings are accepted by MQTT's numeric parser; booleans, null, invalid
text and percentages outside 0–100 are rejected. See [MQTT](mqtt.md) for topic,
TLS, receipt-age, retained-message and reconnect semantics. Battery has its own
receipt timestamp; battery-only updates do not refresh temperature/humidity or
trigger a climate-control poll. Push and expiry work with polling disabled.

File battery updates use the accessory's configured sensor poll interval;
getters still read when background polls are disabled. File values must be
numbers, without percentage suffixes or inferred voltage conversion. Battery
percentages are not adjusted by temperature/humidity offsets.
