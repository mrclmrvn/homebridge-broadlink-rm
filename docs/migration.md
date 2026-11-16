# Migrating from v4 to v5

v5 is a rebuild, not a drop-in compatibility release yet. All legacy accessory
type names resolve, but a recognized type does not mean all of its old options
have been ported. Existing learned hex codes can be reused.

The [contributed cooling configuration review](legacy-config-coverage.md) records
which paths are covered by anonymized regression tests and which mode/default
differences still need attention. The [source audit](legacy-compatibility-audit.md)
records additional fallback/layout findings and remaining concrete gaps.
This is software evidence, not a hardware pass.

## Prepare an isolated trial

1. Back up the Homebridge configuration and cached accessory data, and record the
   existing package name/version and how it is installed.
2. Keep the working v4 package or an installation path for rollback. Avoid testing
   v4 and v5 against the same appliances simultaneously: both can send commands
   and register overlapping HomeKit controls.
3. Build the selected v5 revision and a local tarball using the
   [setup guide](setup.md). Test in a separate Homebridge environment where
   possible; physical hardware validation is still outstanding.
4. Start with one RM and one accessory. Test discovery or explicit hosts, basic
   power, code selection, failures, and restart behavior before adding the rest.
5. Use the [validation runbook](validation.md) to record the exact artifact,
   cache/pairing behavior and rollback results.
6. For a replacement installation, stop the old plugin instance, install v5 in
   the Homebridge service's environment, apply the reviewed config, and restart.

The new npm package is `@mrclmrvn/homebridge-broadlink-rm`; the platform alias
remains `BroadlinkRM`. The old package name is not an installation alias for v5.
The Node engine range matches the locked dependency and CI majors. The declared
Homebridge range now has [representative automated coverage](homebridge-compatibility.md)
beyond the development dependency; live integration and release-head CI results
remain separate requirements.

## Configuration differences to review

| Existing configuration | Current v5 behavior |
| --- | --- |
| Ordinary hex strings | Reused as accessory data; no re-learning required just for the rebuild |
| AC sparse-map fallback | Disabled by default; true selects mode defaults, legacy selects the heatTemperature boundary/generic-default rule |
| units / persistState | AC display units supported; persistState false disables saved settings for stateful accessories. See [state persistence](state-persistence.md) for each type's limits |
| Structured code arrays/objects | Shared command leaves support nested sequences/repetitions across controllers |
| `switch-multi`, `switch-repeat`, `switch-multi-repeat` | Actual sequence/repeat execution, not simple switch aliases |
| `heater-cooler` with data.heat/data.cool | HeaterCooler service; the earlier v5 Thermostat alias is removed |
| `air-conditioner` | Flat heat/cool/auto temperature codes, explicit device Auto, measured ambient thresholds and linked platform gates; saved mode/setpoint preserved by default without startup IR. See the Thermostat guide |
| `temperatureSensor`, `humiditySensor` | Accepted with original casing; kebab-case aliases also available |
| `window` and `fanv1` | Window and legacy Fan services, respectively |
| MQTT sensors | Legacy broker/credential/topic options are supported; see the MQTT guide for freshness and payload rules |
| 1-wire, pseudo-device sensors | CRC-checked Linux w1DeviceID and explicit Celsius pseudoDeviceTemperature supported; review source precedence |
| Ping/ARP state detection | Supported on switch/outlet, TV, fan/Fan v1 and purifier; ARP is a cache estimate |
| Eve/fakegato history, battery alerts | Eve history excluded; batteryAlerts exposes file/MQTT telemetry, with no assumed full battery |
| RF scan/learn buttons | Explicit learn-rf switch supports frequency sweep and packet capture; the old separate scan button is not recreated |
| Pronto strings | Raw modulated 0000 strings with whitespace are converted before transmission |
| Fan speedCycle/default-reset/timers, light exclusives | Supported; review assumptions and timer behavior in the fan/light guides |
| Garage endpoint/obstruction, lock-bolt and jam feedback | Explicit file/MQTT source objects; jams require an explicit signal, not a missed deadline |
| TV power timers / picture modes | Power timers supported; pictureMode is an explicit v5 code map rather than the old placeholder |
| Light allowResend / stateless | Repeat power/brightness commands and local reset are supported; local reset sends no Off |
| hideLearnButton/hideScanFrequencyButton | No automatic legacy helper-button creation; explicitly configure an IR learning accessory |

See the type-specific guides for exact options. The old sample configs at the
repository root and [historical HeaterCooler guide](v4-heater-cooler.md) contain
unported features; use [config-v5-sample.json](../config-v5-sample.json) and the v5
guides for a new trial configuration.

## Identity and pairing

v5 generates a UUID from the accessory name and configured host. An omitted host
uses the literal `default` in that identity. Changing either name or host, even
from an IP address to the equivalent MAC, changes the identity. v4 identity,
room assignments, scenes, and automations are not guaranteed to survive.

Disabled, missing, invalid, or unsupported cached accessories can be unregistered
at startup. Keep the backup if you need to restore the previous cache rather than
rebuilding HomeKit assignments manually.

TVs are published as external accessories and require separate pairing. An older
bridged TV cache entry with the same v5 identity is removed during migration.
See [TV setup](tv.md) before changing an existing TV installation.

## State differences

Most appliance state is inferred from commands rather than read back from the
appliance. Restarting the plugin or using another remote can desynchronize it.
Locks start Unknown; garage doors start Stopped. These are deliberate unknown
physical-state representations. The AC/Thermostat's last accepted mode, target
temperature and last active mode are saved in Homebridge accessory context and
restored for the same identity/cache without sending IR. With persistence disabled,
missing state or an older target-only snapshot, mode starts Off. Explicit ambient thresholds
may act afterward on fresh measurements if the linked gate permits it. Invalid saved targets fall back
to the configured default. This cache-based persistence does not preserve v4
identities or survive cache removal. Other stateful accessories restore validated
settings too; external TVs use a separate state file. Window position restores
its last completed/held estimate, or initialPosition (default 0) without a cache.
Interrupted travel requires endpoint recalibration and never resumes on startup.
See [state persistence](state-persistence.md). Optional file/MQTT garage endpoint,
obstruction and standalone lock-bolt sources provide explicit feedback; see
[power and feedback](power-and-feedback.md). Configured unavailable sources fault
rather than authorizing a command. Explicit jamSensor feedback reports jam state
and cancels automatic actions; it does not transmit stop/reversal or recover a motor.

Sensor readers, including the Thermostat, report invalid/missing readings as
errors rather than inventing zero values or displaying the AC target as measured
temperature. An explicit `pseudoDeviceTemperature` is a configured Celsius
constant and overrides the temperature source; it is not a physical measurement.
Otherwise MQTT measurements take precedence over file/1-wire/native values.
MQTT disconnects and expired readings are unavailable until a new valid message
arrives. See [sensor source precedence](sensor-sources.md) and
[MQTT migration details](mqtt.md) before combining source options.

`batteryAlerts` adds a dedicated Battery service on sensor and climate accessories.
It uses actual file/MQTT percentages; missing data faults instead of becoming
100%. ChargingState remains unavailable. Linux 1-wire and native RM readings do
not establish battery state. Polling/getter failures never reuse an old 1-wire
reading or replace it with zero after a CRC failure.

## Rollback

Stop the v5 instance, restore the previous plugin version in the same Homebridge
environment, and restore the saved configuration/cache according to your
installation's backup process. Restart Homebridge and verify accessory operation.
Do not assume removing the npm package alone restores HomeKit identities or
reverses changes to cached accessories. No automatic migration or rollback tool
is provided yet.
