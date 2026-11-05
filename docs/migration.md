# Migrating from v4 to v5

v5 is a rebuild, not a drop-in compatibility release yet. All legacy accessory
type names resolve, but a recognized type does not mean all of its old options
have been ported. Existing learned hex codes can be reused.

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
Homebridge range still needs validation beyond the development dependency.

## Configuration differences to review

| Existing configuration | Current v5 behavior |
| --- | --- |
| Ordinary hex strings | Reused as accessory data; no re-learning required just for the rebuild |
| Structured code arrays/objects | Implemented for switches/outlets; not generally supported elsewhere |
| `switch-multi`, `switch-repeat`, `switch-multi-repeat` | Actual sequence/repeat execution, not simple switch aliases |
| `heater-cooler` with data.heat/data.cool | HeaterCooler service; the earlier v5 Thermostat alias is removed |
| `air-conditioner` | Thermostat service with temperatureXX codes; advanced legacy mode logic is incomplete |
| `temperatureSensor`, `humiditySensor` | Accepted with original casing; kebab-case aliases also available |
| `window` and `fanv1` | Window and legacy Fan services, respectively |
| MQTT sensors | Legacy broker/credential/topic options are supported; see the MQTT guide for freshness and payload rules |
| 1-wire, pseudo-device sensors | Not implemented in the new sensor reader; configuring them there is an error |
| Ping/ARP state detection | Not implemented |
| Eve/fakegato history, battery alerts | Not implemented in new sensor ports |
| RF scan/learn buttons | Explicit learn-rf switch supports frequency sweep and packet capture; the old separate scan button is not recreated |
| Pronto strings | Raw modulated 0000 strings with whitespace are converted before transmission |
| Fan speedCycle/default-reset/timers, light exclusives | Still pending |
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
physical-state representations. Window position starts from initialPosition
(default 0), not a position sensor. Contact, obstruction, and jam detection are
not integrated in those ports.

Sensor readers, including the Thermostat, report invalid/missing readings as
errors rather than inventing zero values or displaying the AC target as measured
temperature. MQTT disconnects and expired readings are unavailable until a new
valid message arrives. MQTT measurements take precedence over file/native values;
see [MQTT migration details](mqtt.md) before combining source options.

## Rollback

Stop the v5 instance, restore the previous plugin version in the same Homebridge
environment, and restore the saved configuration/cache according to your
installation's backup process. Restart Homebridge and verify accessory operation.
Do not assume removing the npm package alone restores HomeKit identities or
reverses changes to cached accessories. No automatic migration or rollback tool
is provided yet.
