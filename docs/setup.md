# v5 installation and configuration

Version 5.0.1 is the current stable release of the rebuild. Back up your configuration and
review [migration limits](migration.md) before replacing a working v4 setup.
One RM4/AC has recorded live checks; broader hardware coverage remains
outstanding. The development repository is private, while the npm package is public.

## Install from npm

Install `@mrclmrvn/homebridge-broadlink-rm` through your Homebridge plugin manager,
or use the npm environment that runs your Homebridge service:

```bash
npm install -g @mrclmrvn/homebridge-broadlink-rm@5.0.1
```

Use `-g` only for a global installation. For the native Ubuntu service layout
with Node under `/opt/homebridge/bin` and local plugins in `/var/lib/homebridge`,
the equivalent command is:

```bash
sudo /opt/homebridge/bin/npm --prefix /var/lib/homebridge install @mrclmrvn/homebridge-broadlink-rm@5.0.1
```

When replacing v4, back up full Homebridge storage, stop the service, uninstall
`homebridge-broadlink-rm-pro` in that same npm environment, install v5, and restart.
Preserve the full configuration and pairing files. Accessory identities differ
between versions, so scenes and automations may need reassignment.

## Build and install a local package (repository access required)

Use Node 22.12+ within 22.x, or Node 24/26, for the locked development dependency
set. The Node engine declaration matches that range. Representative Homebridge
1.6.0/1.11.4/2.0.0/2.5.0 releases have [automated coverage](homebridge-compatibility.md);
choose a Node version supported by both packages. Broader live integration
remains outstanding. From your selected v5 checkout:

```bash
npm ci
npm test
npm pack
```

`npm test` compiles TypeScript and runs `test/v5/*.test.js`. The prepack script
also builds automatically before `npm pack`. The current version
produces `mrclmrvn-homebridge-broadlink-rm-5.0.1.tgz`.

Transfer that tarball to the Homebridge host if you built elsewhere. Install it
in the environment used by Homebridge, then restart Homebridge:

```bash
npm install -g ./mrclmrvn-homebridge-broadlink-rm-5.0.1.tgz
```

Container, managed UI, and global npm installations may use different package
locations. Confirm which environment runs your service before installing. These
local-build instructions do not publish anything to npm.

## Platform options

Add a platform object to the existing `platforms` array. Do not replace your
whole Homebridge config with a platform fragment. [config-v5-sample.json](../config-v5-sample.json)
is an example platforms array: only the learning button is enabled; example
controls contain placeholders and stay disabled until configured.

| Key | Behavior |
| --- | --- |
| `platform` | Required alias: `BroadlinkRM` |
| `name` | Platform display name |
| `disableDiscovery` | Defaults to false; true skips UDP discovery |
| `hosts` | Optional static RM device definitions |
| `accessories` | Accessory configurations with name and type |

A static RM4 Mini example follows. Replace the documentation-only address and
MAC with your device's values:

```json
{
  "platform": "BroadlinkRM",
  "name": "Broadlink RM",
  "disableDiscovery": true,
  "hosts": [
    {
      "address": "192.0.2.10",
      "mac": "02:00:00:00:00:01",
      "isRM4": true,
      "isRFSupported": false
    }
  ],
  "accessories": [
    {
      "name": "Learn IR",
      "type": "learn-code",
      "host": "02:00:00:00:00:01"
    }
  ]
}
```

Host entries require `address` (IPv4) and `mac`. Set `devType`, for example
`"0x520c"`, for the exact ID reported by discovery; it takes precedence over
`isRM4`/`isRFSupported`. Without devType those flags select representative
Mini/Pro models. Optional `port` defaults to UDP 80. Model-specific operation
still needs hardware validation.

If hosts and discovery are both enabled, static entries are registered first.
Discovery refreshes a device when the same MAC appears at a different address,
type or port, closing the old socket. Exact duplicates are discarded and their
unused sockets are closed.

Automatic discovery repeats every 60 minutes after startup, including with static
hosts. Set `rediscoveryInterval: 0` to disable the schedule, or
`disableDiscovery: true` to disable all automatic discovery. MAC-selected
accessories follow a device found at a changed IP on a later sweep; IP-selected
accessories do not. See [rediscovery](rediscovery.md) for lifecycle and limits.

## Shared accessory options

Every accessory needs `name` and `type`. Set `disabled: true` to skip it. `host`
selects the RM by IP or MAC address; MAC matching ignores separators and case.
Without host, the first registered device is used. With multiple RMs, specify
host explicitly so discovery ordering cannot change the selected device.

The v5 UUID is generated from `name:host`, with `default` for an omitted host.
Changing name or host changes the identity. An absent, disabled, unsupported,
or invalid cached accessory can be removed during startup cleanup. Restart after
configuration changes; continuous hot reload is not implemented.

Only options handled by the selected accessory should be relied upon. Visual
schema fields are shared across types and do not imply that every accessory
supports every field. Most controls accept single hex strings. Structured code
sequences are supported at command leaves across controllers; see
[shared commands](power-and-feedback.md#shared-structured-commands).

## Thermostat-style air conditioner

```json
{
  "name": "Room AC",
  "type": "air-conditioner",
  "coolOnly": true,
  "minTemperature": 16,
  "maxTemperature": 30,
  "defaultCoolTemperature": 24,
  "sensorPollInterval": 60,
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "temperature24": "YOUR_24_C_HEX"
  }
}
```

This creates a Thermostat, not HeaterCooler. `airconditioner` is also accepted.
Target temperatures use `tempStepSize` (default 1°C), rounded relative to the
configured minimum, and matching keys such as `temperature24` or
`temperature24.5`. Mode-prefixed `heatXX` / `coolXX` take precedence over generic
keys. Entries accept strings and structured commands. Mode changes can send a
separate `data.heat` / `data.cool` command before the temperature code; `on` remains
an activation fallback when no mode/temperature code is supplied. Changing an active target requires its temperature code. Missing/failed
commands retain the previous state; off-state temperature changes are deferred.
Set bounds and supply all temperature codes you intend to expose.

`coolOnly` restricts modes to Off/Cool. It defaults to false in code, while the
visual schema defaults to true; set it explicitly. Otherwise modes are Off,
Heat and Cool; `heatOnly` restricts to Off/Heat. Device Auto requires explicit
mappings, while optional ambient control uses configured thresholds and measured
temperature. Mode-specific flat codes, metadata and fixed Auto replacement
are described in [Thermostat modes](air-conditioner.md). Current activity is inferred from successful sends,
and temperature waits for a real reading instead of displaying the target as a
measurement. The shared reader supports MQTT, files, Linux 1-wire and native RM
sensors, plus an explicitly configured pseudo constant. Optional battery telemetry
comes from MQTT/files. See [sensor source selection](sensor-sources.md) and
[MQTT configuration](mqtt.md). Polling starts immediately; 0 disables
background polls, while MQTT messages still push updates. Poll timers and MQTT
connections are disposed on shutdown. Invalid modes/temperatures are rejected,
and repeated identical commands are suppressed unless `allowResend` is true.
Full legacy AC options remain pending.

Accepted AC mode/target changes are saved in the accessory's Homebridge cache,
including target edits made while Off, unless `persistState: false` disables
restore/cache updates. After a restart or process crash with the same accessory
identity/cache, the last saved mode and target are restored without sending IR.
Missing/older target-only snapshots start Off; explicitly configured ambient automation can subsequently act on a fresh
reading when its optional gate allows it.
For example, 18°C → Off → restart → Cool sends the 18°C code. Failed active
transmissions do not overwrite saved state. Missing, malformed, out-of-range
or step-incompatible saved values use `defaultCoolTemperature` (default 24) instead.
The configured default remains the fallback, not a forced reset at every restart.
Removing the accessory/cache or changing its name/host can lose this saved value.
Homebridge owns the cache write; a persistence error is logged and sudden process
or storage failure is not guaranteed to preserve the latest change.

See [Thermostat modes and legacy options](air-conditioner.md) for On/mode delays,
dry-off, power timers, resend aliases and opt-in default resets/fallback. Without
reset-on-mode-change, the saved setpoint behavior above remains unchanged.
Other stateful accessory types also restore validated settings. See
[state persistence](state-persistence.md) for storage, opt-out and the distinct
behavior of sensors, learning, momentary actions and interrupted movement.
See [ambient control and enable switches](air-conditioner.md#ambient-threshold-automation-and-linked-switches)
for opt-in regulation, manual overrides and virtual gates.
For nested setting maps under `data.heat` / `data.cool`, use
[HeaterCooler](remaining-accessories.md#heatercooler).

## Switches and IR learning

A normal switch uses `data.on` and `data.off`. See
[switch variants and sequences](remaining-accessories.md#switch-variants-and-sequences)
for stateless buttons, automatic actions, repeat counts, and array data.

Add `type: "learn-code"` or `"learn-ir"` to expose a learning switch. Turn it on,
press one IR remote button toward the RM, and copy the logged hex code. The
Homebridge IR button waits up to 20 seconds and resets off when done. Capture
one button at a time. Writes acknowledge immediately; Off and shutdown abort the
operation. `learn-rf` performs a Pro model's RF learning workflow with stage
prompts and a 60-second default deadline. The legacy separate scan-frequency
button is not recreated; see [RF learning](protocol.md#rf-learning).

Existing learned IR/RF hex can be sent without converting it. Actual RF
transmission depends on the device hardware and code frequency; accepting the
configuration is not hardware verification. Raw modulated Pronto strings are
converted automatically; see [Pronto support](protocol.md#pronto).

## Pairing and next steps

Ordinary accessories are bridged. TV accessories are external and must be added
separately in HomeKit; see [TV pairing](tv.md). v5 does not promise to preserve
v4 UUIDs or room/automation assignments. See [migration](migration.md) and
[troubleshooting](troubleshooting.md) for the next checks.
