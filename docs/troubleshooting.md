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
an IR code; use `learn-rf` for a Pro model's frequency-sweep workflow. Do not run learning and other commands
concurrently while diagnosing a device.

The development form is also available, for example `npm run cli -- discover`.
The compiled CLI does not need ts-node. Use the exact device ID from discovery
when possible; the default when omitted is 0x520b. The examples use 0x520c for an
RM4 Mini, not a universal device ID. The installed CLI command is `broadlink-rm`.

## What each command establishes

| Command | Behavior and limits |
| --- | --- |
| discover | Broadcasts on local IPv4 interfaces for about 4 seconds; prints responding IP/MAC/type IDs |
| auth | Attempts a session handshake with one specified device |
| learn | Enters IR learning and polls for up to 30 seconds |
| sensors | Requests native temperature/humidity; model and cable support vary |
| send | Authenticates as needed and transmits the supplied hex |

The Homebridge learning switch has a 20-second window, unlike the CLI's 30
seconds. Operational failures and invalid commands return nonzero status.
A zero status for send/auth confirms the command result, not physical appliance
feedback. SIGINT aborts learning. See [the protocol update](protocol.md) for
RF prompts and the offline convert-pronto command.

## Discovery finds nothing

Check that the RM is powered and reachable from the machine/container running
Homebridge, not only from your laptop. Broadcasts may not cross VLANs or isolated
Wi-Fi networks. The driver uses UDP port 80 for device commands and a local UDP
socket for replies. Network routing, firewall and container settings must permit
that exchange; adding a static host does not bypass those requirements.

Try a static host with the correct IP/MAC and framing flags, or use the CLI with
the actual device ID. A static host appearing as registered only means a device
object exists; it is not proof of authentication. If a device moves addresses,
update its static entry or enable [scheduled rediscovery](rediscovery.md). A later
response for the same MAC refreshes its address/type and closes the replaced
socket. MAC-selected accessories follow the move; old IP selections do not.

## Authentication or sends fail

Confirm the current IP, MAC and device ID. RM4 and legacy devices have different
payload framing. Session success is separate from discovery success. The driver
reports device errors and timeouts; include the exact error text when reporting
an issue. A cloud-lock error can require changing the device's local-control lock
setting in the Broadlink app. Follow the [unlock steps and screenshot](../README.md#unlock-local-control-in-the-broadlink-app);
app navigation may vary by version.

A successful UDP transmission is not appliance feedback. Test that the IR emitter
can reach the appliance, that the code matches the intended button, and, for RF,
that the hardware supports the code's frequency. Use learn-rf with a supported
Pro model for RF learning; a normal IR learning session is not an RF diagnostic.

### Discovery works but authentication times out

RM4 firmware can reply with bytes `e9 03` at offsets `0x26`/`0x27`. The opcode is
byte `0x26` (`0xE9`); treating both bytes as an opcode caused v5 to ignore a valid
authentication reply. The fixed driver also accepts command replies `0xEE` and
`0xEF` with a nonzero adjacent byte, retaining sender, sequence and checksum checks.

For a native Ubuntu install under `/var/lib/homebridge/node_modules`, copy
`scripts/v5-diagnose-auth.js` from the checkout to the test host. It is a separate
source script, not included in the npm tarball. Stop Homebridge and wait for its
child processes to exit before running it, to avoid competing sessions:

```bash
sudo hb-service stop
ps -e -o pid=,unit=,comm= | awk '$2 == "homebridge.service"'
# Proceed only after the process listing is empty; substitute your RM's address.
sudo /opt/homebridge/bin/node v5-diagnose-auth.js 192.0.2.10
sudo hb-service start
```

Restart Homebridge even if the diagnostic fails. This stops all child bridges
temporarily. The script discovers the requested device, authenticates, then reads
sensors. It never sends IR or prints raw packets, session IDs, keys or credentials.
The trace includes request/reply command fields, counters and checksum validity.
A reply trace followed by a timeout can reveal a response-filter mismatch; no
reply trace means no datagram reached that device socket during the attempt.

### AC acknowledges Cool but stays physically Off

Some AC configurations require an explicit On code before the selected
temperature code. If `data.on` is configured, add `"turnOnWhenOff": true` to that
AC accessory and restart Homebridge. On transition from Off, v5 sends `data.on`,
waits `onDelay` (default 0.3 seconds), then sends the configured mode/temperature
sequence. Off-state target edits still send nothing with `ignoreTemperatureWhenOff`.
Enable this per appliance after checking its codes; a Broadlink acknowledgement
alone does not establish that the appliance responded.

AC operation logs distinguish incoming HomeKit writes, skipped duplicate
requests, saved off-state targets and commands acknowledged by Broadlink. They
do not establish physical AC state. Target-temperature persistence restores the
selected temperature and operating mode after restart without sending a startup
command. With `persistState: false`, or an older target-only snapshot, mode starts
Off. Select a mode once with the state-persistence build to save it for later
restarts. See [AC state persistence](air-conditioner.md#saved-state-and-legacy-defaults).

## Missing or incorrect HomeKit controls

Inspect startup logs for skipped configurations and `Cannot configure` messages.
Each accessory needs a name and supported type. Window coverings require positive
open/close travel durations. An unsupported or invalid configuration is skipped,
and a stale cached accessory may be removed. Schema fields are shared across
accessory types; consult the matching guide for meaningful options.

Restart after changing config. An accessory's name and host determine its v5
identity. A newly configured host can also select a different physical device;
without a host, the first registered RM is used. With multiple RMs, set host
explicitly. TVs require [external pairing](tv.md), while ordinary accessories
appear through the Homebridge bridge.

## Sensor readings fail or seem wrong

Not every RM has temperature/humidity sensors. Some RM4 models require a supported
sensor cable; legacy native reads may return temperature only. An empty CLI sensor
object is not a valid zero reading. New sensor accessories report absent values
as errors; confirm hardware support or configure a file source.

For files, confirm the path is accessible to the Homebridge service and the
content matches the documented format. Use tempSourceUnits for Fahrenheit file
values; native Broadlink temperature is already Celsius. Adjustments are applied
after file conversion. See [sensor formats](remaining-accessories.md#sensors).
MQTT sources are supported; see the [MQTT guide](mqtt.md) for missing-message,
subscription, reconnect and age-expiry behavior. 1-wire/pseudo sources remain
unported.

Humidity Auto mode needs actual measurements. noHumidity disables Auto, not the
required HomeKit current-humidity characteristic; its getter reports an error
when no real source is available. The Thermostat now also waits for a real
measurement; it does not substitute its target temperature at startup.

## Details for a useful bug report

Include the v5 package version/commit, Node and Homebridge versions, OS/container
setup, RM model and discovered type ID, whether hosts or discovery are used, the
accessory type, the command/characteristic that fails, and relevant logs. Provide
a minimal config with personal addresses and unnecessary remote codes removed.
State whether the CLI reproduces the problem and whether the appliance physically
responded. Never include pairing codes, authentication tokens, or unrelated
service credentials. Report issues in the
[project repository](https://github.com/mrclmrvn/homebridge-broadlink-rm/issues).
