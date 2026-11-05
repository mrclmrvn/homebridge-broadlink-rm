# MQTT temperature and humidity sensors

MQTT is supported by standalone temperature/humidity sensors, the Thermostat-style
`air-conditioner`, `heater-cooler`, and `humidifier-dehumidifier`. Existing option
names are retained: mqttURL, mqttTopic, mqttUsername and mqttPassword.

The integration uses [MQTT.js](https://github.com/mqttjs/MQTT.js) with MQTT 3.1.1.
Binary garage endpoint/obstruction and lock-bolt sources use the same transport;
see [power and feedback](power-and-feedback.md#file-and-mqtt-binary-feedback).

It subscribes to measurements and does not publish appliance commands, wills,
or Home Assistant discovery entities. Each configured accessory owns one broker
connection; connections are not pooled. MQTT.js is loaded only when a configured
MQTT source is started, and no MQTT connection opens for non-MQTT accessories.
The Broadlink driver remains based on Node standard libraries; MQTT.js is now a
runtime dependency without mandatory native compilation.

## Combined sensor topic

```json
{
  "name": "Room Temperature",
  "type": "temperatureSensor",
  "mqttURL": "mqtt://broker.invalid:1883",
  "mqttTopic": "zigbee2mqtt/room",
  "mqttMaxAge": 300,
  "sensorPollInterval": 0
}
```

Replace broker.invalid and the topic with your broker and sensor. A combined
message such as `{"temperature":23.5,"humidity":48}` supplies both quantities.
The temperature accessory exposes a separate HumiditySensor unless noHumidity
is true. MQTT messages push updates even when background polling is disabled.
No Broadlink device is required for sensor-only accessories using MQTT.

Recognized JSON field names are case-insensitive: temperature, temp,
local_temperature, humidity, hum, relativehumidity and relative_humidity.
Fields can be nested in objects or arrays; traversal is bounded. Top-level
matches take precedence over nested fields. Prefer explicit paths when a payload
contains several sensors or ambiguous field names.

A scalar topic accepts a number or numeric string. With mqttTopic as a string,
scalar values are interpreted as humidity for humiditySensor/humidity-sensor and
humidifier-dehumidifier, and as temperature for the other consumers. A scalar
never supplies both temperature and humidity. Use identifiers for separate
scalar topics to avoid ambiguity.

## Separate topics and custom fields

```json
{
  "name": "Room AC",
  "type": "air-conditioner",
  "mqttURL": "mqtts://broker.invalid:8883",
  "mqttUsername": "YOUR_USERNAME",
  "mqttPassword": "YOUR_PASSWORD",
  "mqttTopic": [
    { "identifier": "temperature", "topic": "sensors/room/temperature" },
    { "identifier": "humidity", "topic": "sensors/room/state", "path": "readings.rh" }
  ],
  "tempSourceUnits": "c",
  "mqttMaxAge": 300,
  "coolOnly": true,
  "data": { "on": "YOUR_ON_HEX", "off": "YOUR_OFF_HEX" }
}
```

The first topic can publish `23.5` or a JSON object with a temperature alias.
The second can publish `{"readings":{"rh":48}}`. Paths are dot-separated,
case-sensitive field/array indices; they do not evaluate expressions. A path
requires an explicit measurement identifier and an object payload.
Multiple identifiers can subscribe to the same topic with different paths.

Climate identifiers are temperature, humidity, battery, combined and unknown.
Battery accepts percentage scalars or numeric JSON fields/paths; combined JSON
recognizes battery/batteryLevel/battery_level/batteryPercentage/battery_percentage
case-insensitively. `batteryAlerts` exposes a separate Battery service on sensor
and climate accessories; see [sensor sources](sensor-sources.md#optional-battery-status).
Binary sources also use contact, lock, obstruction and jam identifiers as described
in the feedback guide. combined requires object measurements; unknown follows the combined
JSON/scalar behavior described above. Topic filters support MQTT + and # rules,
including the special handling of $-prefixed topics. Shared-subscription filters
are not supported. Prefer a filter that identifies one physical sensor: multiple
matching publishers otherwise overwrite that quantity's latest measurement.

Supported broker schemes are mqtt, mqtts, ws and wss. TLS certificate verification
is enabled for secure transports; the legacy insecure verification setting is
not copied. For a private CA, configure the Node process's trusted CA environment
rather than disabling verification. Username/password fields take precedence over
URL credentials. Broker URLs, broker error details and message payloads are not
included in integration error logs; avoid sharing credentials in bug reports.

## Freshness, failures and reconnects

mqttMaxAge is the maximum age in seconds since a measurement was received locally
(default 300). Zero disables age expiry while connected. Choose an age longer
than the sensor's expected publication interval. Temperature, humidity and battery
have independent receipt times; partial JSON messages do not refresh omitted
fields. Battery-only and link-quality updates do not refresh or erase earlier
temperature/humidity measurements. Battery-only updates do not trigger climate
control polls. Empty or malformed measurement messages
invalidate the affected quantity; booleans, nulls and invalid numeric text do
not become zero. A real numeric zero remains valid.

Age expiry pushes an error to HomeKit without waiting for a background poll.
Disconnects, broker errors or denied subscriptions make readings unavailable.
The client retries connections and subscribes again after reconnect; old cached
readings are cleared. A new message is required before values become available.
Retained messages are accepted, including after reconnect. Their age is measured
from receipt, not from the sensor's original sampling time: payload timestamps
are not interpreted, so receipt freshness does not prove measurement freshness.

Configured MQTT sources take precedence over file/native sources for both
quantities. Missing MQTT values do not fall back to a native reading, file value,
zero, or the AC target temperature. This prevents a source failure from silently
changing measurement origin. Celsius is used by default; tempSourceUnits=f
converts MQTT temperatures to Celsius, then temperatureAdjustment is applied.
humidityAdjustment is in percentage points. Invalid/out-of-range adjusted values
report errors to HomeKit.

MQTT callbacks are coalesced and serialized with each consumer's control writes.
Shutdown/removal disposes the source, ends its connection, and clears age and
consumer update timers. A late callback cannot re-enable a disposed source.

## Effect on appliance control

MQTT supplies temperature display/feedback for AC/Thermostat and HeaterCooler.
It does not add plugin-controlled automatic heating/cooling regulation, and does
not alter the selected IR temperature code. The AC no longer presents its target
temperature as a measured startup value: it waits for an actual reading. Native
and file readings now use the same source reader on that accessory, with owned
poll timers that stop on shutdown.

For humidifier-dehumidifier, valid humidity updates re-evaluate the existing
mode/threshold logic. Missing, stale, invalid or disconnected measurements cannot
issue a new humidity-driven command. The last successfully requested operating
state remains in effect until a valid update or manual command changes it; this
is not an automatic shutoff policy. Manual Off still works when the broker is
unavailable. noHumidity=true keeps manual modes and disables humidity Auto even
if measurement messages are available.

## Validation

The suite covers configuration, payload parsing, zero values, explicit paths,
wildcard filters, units/offsets, stale readings, denied subscriptions, reconnects,
late acknowledgments, shutdown, and updates to all supported consumer services.
An integration test uses the real MQTT.js client against a small in-process
broker stream and consumes a retained MQTT packet. It does not need external
broker credentials or a network listener. Live TLS brokers, Homebridge UI forms,
and physical appliance behavior remain unvalidated.
