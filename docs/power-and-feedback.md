# Power detection, shared commands and physical feedback

These options are implemented in the TypeScript plugin. Automated tests use
controlled probes, senders and sensor sources; live device validation is still
required. Keep the appliance address distinct from `host`, which selects the RM.

## Ping and ARP power estimates

Switch/outlet variants, TV, fan/Fan v1 and air purifier support these options:

```json
{
  "name": "TV Power",
  "type": "switch",
  "pingIPAddress": "192.0.2.20",
  "pingFrequency": 5,
  "pingTimeout": 2,
  "minimumPingFailures": 3,
  "pingGrace": 10,
  "data": { "on": "YOUR_POWER_TOGGLE_HEX", "off": "YOUR_POWER_TOGGLE_HEX" }
}
```

Replace the documentation address with the appliance's IPv4 address. Polling is
read-only: it updates HomeKit but never sends a power command. A requested power
change checks reachability and suppresses a command when the observed state
already matches. An indeterminate probe rejects the request without sending.
Set `minimumPingFailures` to tolerate transient missed pings during background
polling. A successful ping reports On immediately. An indeterminate result
leaves the last estimate in place and resets the consecutive-miss count.
This setting applies to ICMP polling. ARP observations and checks made for an
explicit power command use their existing behavior.

| Option | Default | Meaning |
| --- | --- | --- |
| `pingFrequency` | 1 | Seconds between completed poll and next poll |
| `pingTimeout` | 2 | Utility timeout in seconds, maximum 60 |
| `minimumPingFailures` | 1 | Consecutive ordinary ICMP misses before a background poll reports Off |
| `pingGrace` | 10 | Seconds to use the last successfully sent state before probing again; 0 disables |
| `pingUseArp` | false | Estimate from a cached neighbor/ARP entry instead of ICMP |
| `pingIPAddressStateOnly` | false | Observe state but always allow explicitly requested commands |

ARP mode inspects the OS cache; it does not actively resolve the neighbor or
expire old entries. A sleeping/disconnected appliance may still appear present.
Linux uses `ip neigh`, falling back to `arp`; macOS and Windows use `arp`. ICMP
uses `ping`. Utilities must be available to the Homebridge process. Arguments
are passed without a shell, utilities have bounded runtimes, and shutdown aborts
in-flight work. Unsupported platforms or utility errors are indeterminate.
Windows success requires a recognizable TTL response; ambiguous output faults a
guarded request. Poll failures retain the previous estimate rather than claiming
a newly verified state.

For outlets, state-only mode leaves `On` controlled by writes and updates
`OutletInUse` from reachability independently. This is not electrical load
measurement. Other supported types update their power characteristic from the
observation. State-only mode does not assume the sent state during a grace period.
AC, HeaterCooler, humidity controllers and lights do not use this power monitor.

## MQTT wattage power estimates

A metering plug or automation can publish an appliance's measured watts to MQTT.
Configure **MQTT Wattage Source** under **Settings → Power and timing** on the
accessory. Supply `powerSensor` in JSON Config if editing the raw configuration.

```json
{
  "name": "TV Power",
  "type": "switch",
  "powerSensor": {
    "mqttURL": "mqtt://broker.example",
    "mqttTopic": "living-room/tv/watts",
    "mqttMaxAge": 30,
    "onThresholdWatts": 5
  },
  "data": { "on": "YOUR_POWER_TOGGLE_HEX", "off": "YOUR_POWER_TOGGLE_HEX" }
}
```

Publish live, nonnegative watts as a number or as JSON with a `power`, `watts`,
or `wattage` field. For another JSON layout, use a topic entry such as
`{"identifier":"power","topic":"living-room/tv","path":"meter.watts"}`.
The appliance is considered On at or above the threshold. Choose a threshold
above standby draw and below normal operating draw. Use either `powerSensor`
or `pingIPAddress` on an accessory.

Background checks use `pingFrequency`. Explicit power requests use the latest
valid reading and honor `pingGrace` after a successful send. Retained MQTT
messages are ignored on subscription. A missing, invalid, stale, or disconnected
reading leaves the last displayed state in place and blocks guarded toggles
once the grace period ends. `pingIPAddressStateOnly` allows explicit commands
regardless of the reading. MQTT expiry defaults to 300 seconds. Set
`mqttUsername` and `mqttPassword` inside `powerSensor` if required.

## Shared structured commands

Each command leaf, such as a fan's `data.on`, a TV input's `data`, a light preset,
or a lock's `data.unlock`, accepts a string, array, or repetition object:

```json
{
  "data": {
    "unlock": [
      { "data": "YOUR_FIRST_HEX", "sendCount": 2, "interval": 0.2, "pause": 0.5 },
      "YOUR_SECOND_HEX"
    ]
  }
}
```

Nested arrays are ordered. Shared arrays default to 0.1 seconds between entries;
a positive trailing `pause` replaces that gap. Repetition objects default to one
send, 0.1 seconds between repeats and no trailing pause. Switch/outlet array gaps
instead use their top-level `interval` (default 1 second), as documented in
[switch sequences](remaining-accessories.md#switch-variants-and-sequences).

The entire selected sequence is validated before sending: counts are integers
1–10000, expansion is limited to 10000 code/delay steps and depth to 20 levels.
Delays must be finite nonnegative seconds within the timer range. Explicit zero
intervals work. Shutdown cancels sequence delays and prevents later sends.
Already transmitted commands cannot be rolled back; a failed sequence does not
claim full completion. Hardware acknowledgments do not verify appliance action.

## File and MQTT binary feedback

Garage doors accept `closedSensor`, `openSensor` and `obstructionSensor`. Standalone
locks accept `lockSensor`. Each is an independent source object with exactly one
`filePath` or `mqttURL`; MQTT also requires `mqttTopic`. These are explicit
physical sensor inputs, separate from Ping/ARP power estimates.

```json
{
  "name": "Garage Door",
  "type": "garage-door-opener",
  "openDuration": 8,
  "closeDuration": 8,
  "closedSensor": { "filePath": "/path/to/closed-contact.json", "maxAge": 30 },
  "openSensor": {
    "mqttURL": "mqtt://broker.local",
    "mqttTopic": [{ "identifier": "contact", "topic": "garage/open", "path": "activated" }],
    "maxAge": 30
  },
  "obstructionSensor": { "filePath": "/path/to/obstruction.json", "maxAge": 30 },
  "data": { "open": "YOUR_OPEN_HEX", "close": "YOUR_CLOSE_HEX" }
}
```

True/1 means that endpoint is activated, the doorway is obstructed, or the bolt
is secured, respectively. False/0 means inactive, clear, or unsecured. Normalize
opposite-polarity sensors upstream; there is no inversion option. Files accept
JSON booleans/numbers, plain words, or objects with `contact`/`closed`,
`lock`/`locked`, or `obstruction`/`obstructed` fields. Accepted words are
`true`/`false`, `closed`/`open` for contacts, `locked`/`unlocked` for bolts, and
`detected`/`clear` for obstruction. Other values, including null or numeric 2,
are errors. A contact at the open endpoint must report true when that endpoint
is activated; the word `open` by itself is parsed as a false contact value.

Sources use `pollInterval` seconds (default 1; 0 disables background polling).
MQTT updates and expiry still push with polling disabled. `maxAge` defaults to
300 seconds; 0 disables expiry. Files use modification time and must be updated
by the producer. MQTT uses local receipt age, including for retained messages;
it cannot prove original sampling time. `mqttMaxAge` is also accepted when
`maxAge` is omitted. Broker credentials, paths, TLS and reconnect semantics are
described in [MQTT](mqtt.md). These sources subscribe only, without publishing
commands. Missing, invalid, expired or disconnected readings fault HomeKit.

## Garage and lock behavior with feedback

With endpoint sensors, garage completion comes from activated contacts rather
than elapsed time. Both endpoints activated is an error; neither activated is
Opening/Closing during a command and Stopped otherwise. A closed-only contact
cannot establish that the door is fully open. Failure to reach a configured
endpoint by the travel deadline is logged and ends the movement estimate;
the plugin does not invent endpoint confirmation. Opening/closing requests
require usable configured endpoint feedback. Closing also reads an optional
obstruction source immediately before sending; obstructed or unavailable blocks
the command. An obstruction update during movement reports its state but does
not issue a stop/reversal command. Optional explicit jam feedback is described
below; no automatic motor stop/reversal interlock is provided.

With endpoint feedback, `autoCloseDelay` requires an `openSensor` and starts only
after that sensor confirms Open. Without endpoint sensors, the original timer
estimate remains. Without an obstruction source, ObstructionDetected is false
and does not establish a clear doorway. Optional garage lock controls remain
inferred; use a standalone lock with `lockSensor` for bolt feedback.

```json
{
  "name": "Door Bolt",
  "type": "lock",
  "lockSensor": { "filePath": "/path/to/bolt.json", "maxAge": 30 },
  "lockDuration": 2,
  "unlockDuration": 2,
  "data": { "lock": "YOUR_LOCK_HEX", "unlock": "YOUR_UNLOCK_HEX" }
}
```

The standalone lock reports the observed bolt, not the requested target, while
waiting for confirmation. Missing feedback blocks new commands; unconfirmed
completion faults the current-state characteristic. `autoLockDelay` starts only
after a requested unlock is confirmed. A door-closed contact cannot establish
that a bolt is secured. Without `lockSensor`, the legacy timer estimate remains.


## Explicit jam feedback

Standalone locks and garage doors accept `jamSensor`, using the same explicit
file/MQTT source object, poll interval and freshness rules as other binary sources:

```json
{
  "jamSensor": {
    "mqttURL": "mqtt://broker.local",
    "mqttTopic": [{ "identifier": "jam", "topic": "motor/state", "path": "jammed" }],
    "maxAge": 30
  }
}
```

True/1/`jammed` means jammed; false/0/`clear` means clear. Files accept a `jam`
or `jammed` field, and combined MQTT JSON recognizes either alias. A missing,
stale or invalid configured source blocks new movement/lock commands. Without
an explicit source, a missed endpoint/bolt deadline remains a confirmation fault;
it is never labeled a verified jam.

A jammed standalone lock reports HomeKit LockCurrentState.JAMMED and cancels
transition/auto-lock timers. After clearing, a bolt source supplies the physical
state; without one, state becomes Unknown until a new inferred operation completes.
A jammed garage faults CurrentDoorState and cancels travel/auto-close estimates;
after clearing, endpoint sensors determine position or the unsensed door remains
Stopped. Jam is not copied into ObstructionDetected. Source failure also cancels
these automatic actions and faults the current-state characteristic.

Jam updates send no IR/RF stop, reversal, unlock or retry. Clearing a fault does
not resume cancelled actions. The software reports sensor state and guards new
commands; the appliance's physical controller remains responsible for motor
protection and recovery. Optional garage lock controls remain separately inferred.

## IR scheduling for HomeKit scenes

When a scene triggers several accessories at once, some IR receivers need time
between commands. Set `irCommandDelay` on the BroadlinkRM platform to enforce a
minimum gap between IR commands sent by the same Broadlink.

When nearby Broadlinks can interfere with each other, set the same
`irDeviceGroup` on each accessory that sends IR through those Broadlinks.
Grouped transmissions run one at a time and wait for the Broadlink response
or timeout before the next transmission. Set `irDeviceGroupDelay` on the platform
to add a gap when switching transmitters in the same group.

For example, set both platform delays to `0.15` seconds and set
`"irDeviceGroup": "living-room"` on each affected accessory. In Plugin Config,
the group field is under **Settings → Power and timing**. Set the platform
delays in **JSON Config**. Both delays default to zero. Independent groups can
transmit in parallel. RF transmissions keep their existing behavior.
