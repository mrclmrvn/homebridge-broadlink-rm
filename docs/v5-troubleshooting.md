# CLI and troubleshooting

Run diagnostics from a built checkout on the network that can reach the RM.
These commands communicate with hardware except for help. The addresses, MACs,
and codes below are examples: substitute your actual values before running.

```bash
npm run build
node dist/cli.js help
node dist/cli.js discover
node dist/cli.js auth 192.0.2.10 02:00:00:00:00:01 0x520c
node dist/cli.js learn 192.0.2.10 02:00:00:00:00:01 0x520c
node dist/cli.js sensors 192.0.2.10 02:00:00:00:00:01 0x520c
node dist/cli.js send 192.0.2.10 02:00:00:00:00:01 YOUR_LEARNED_HEX 0x520c
```

`send` transmits a real command and can change an appliance's state. Learn captures
an IR code, not an RF frequency sweep. Do not run learning and other commands
concurrently while diagnosing a device.

The development form is also available, for example `npm run cli -- discover`.
The compiled CLI does not need ts-node. Use the exact device ID from discovery
when possible; the default when omitted is 0x520b. The examples use 0x520c for an
RM4 Mini, not a universal device ID. There is no installed command-line binary
alias in package.json yet.

## What each command establishes

| Command | Behavior and limits |
| --- | --- |
| discover | Broadcasts on local IPv4 interfaces for about 4 seconds; prints responding IP/MAC/type IDs |
| auth | Attempts a session handshake with one specified device |
| learn | Enters IR learning and polls for up to 30 seconds |
| sensors | Requests native temperature/humidity; model and cable support vary |
| send | Authenticates as needed and transmits the supplied hex |

The Homebridge learning switch has a 20-second window, unlike the CLI's 30
seconds. CLI operational errors are printed inside catch blocks and do not
reliably set a nonzero exit code. Check the actual output; do not use the current
CLI's exit status alone as an automated health check.

## Discovery finds nothing

Check that the RM is powered and reachable from the machine/container running
Homebridge, not only from your laptop. Broadcasts may not cross VLANs or isolated
Wi-Fi networks. The driver uses UDP port 80 for device commands and a local UDP
socket for replies. Network routing, firewall and container settings must permit
that exchange; adding a static host does not bypass those requirements.

Try a static host with the correct IP/MAC and framing flags, or use the CLI with
the actual device ID. A static host appearing as registered only means a device
object exists; it is not proof of authentication. If a device moves addresses,
update/remove the static entry and restart: current deduplication does not refresh
an existing MAC from later discovery.

## Authentication or sends fail

Confirm the current IP, MAC and device ID. RM4 and legacy devices have different
payload framing. Session success is separate from discovery success. The driver
reports device errors and timeouts; include the exact error text when reporting
an issue. A cloud-lock error can require changing the device's local-control lock
setting in the Broadlink app; app navigation varies, so check the device's current
settings rather than relying on the historical screenshot.

A successful UDP transmission is not appliance feedback. Test that the IR emitter
can reach the appliance, that the code matches the intended button, and, for RF,
that the hardware supports the code's frequency. RF learning is not implemented
yet; a normal IR learning session is not an RF diagnostic.

## Missing or incorrect HomeKit controls

Inspect startup logs for skipped configurations and `Cannot configure` messages.
Each accessory needs a name and supported type. Window coverings require positive
open/close travel durations. An unsupported or invalid configuration is skipped,
and a stale cached accessory may be removed. Schema fields are shared across
accessory types; consult the matching guide for meaningful options.

Restart after changing config. An accessory's name and host determine its v5
identity. A newly configured host can also select a different physical device;
without a host, the first registered RM is used. With multiple RMs, set host
explicitly. TVs require [external pairing](v5-tv.md), while ordinary accessories
appear through the Homebridge bridge.

## Sensor readings fail or seem wrong

Not every RM has temperature/humidity sensors. Some RM4 models require a supported
sensor cable; legacy native reads may return temperature only. An empty CLI sensor
object is not a valid zero reading. New sensor accessories report absent values
as errors; confirm hardware support or configure a file source.

For files, confirm the path is accessible to the Homebridge service and the
content matches the documented format. Use tempSourceUnits for Fahrenheit file
values; native Broadlink temperature is already Celsius. Adjustments are applied
after file conversion. See [sensor formats](v5-remaining-accessories.md#sensors).
MQTT/1-wire/pseudo sources remain unported in the new reader.

Humidity Auto mode needs actual measurements. noHumidity disables Auto, not the
required HomeKit current-humidity characteristic; its getter reports an error
when no real source is available. The old Thermostat's initial temperature is an
assumption until polling succeeds, not a native measurement.

## Details for a useful bug report

Include the v5 package version/commit, Node and Homebridge versions, OS/container
setup, RM model and discovered type ID, whether hosts or discovery are used, the
accessory type, the command/characteristic that fails, and relevant logs. Provide
a minimal config with personal addresses and unnecessary remote codes removed.
State whether the CLI reproduces the problem and whether the appliance physically
responded. Never include pairing codes, authentication tokens, or unrelated
service credentials. Report issues in the
[project repository](https://github.com/mrclmrvn/homebridge-broadlink-rm/issues).
