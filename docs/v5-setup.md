# v5 installation and configuration

The plugin is an alpha rebuild. Use a backup of your existing configuration and
review [migration limits](v5-migration.md) before replacing a working v4 setup.
This guide describes the code in this repository; live hardware and Homebridge
validation remain outstanding.

## Build and install a local package

Use Node 22.12+ within 22.x, or Node 24/26, for the locked development dependency
set. package.json still advertises broader runtime compatibility that has not
been validated by this suite. From your selected v5 checkout:

```bash
npm ci
npm test
npm pack
```

`npm test` compiles TypeScript and runs `test/v5/*.test.js`. Build before packing:
`npm pack` does not run the package's prepublishOnly script. The current version
produces `mrclmrvn-homebridge-broadlink-rm-5.0.0-alpha.1.tgz`.

Transfer that tarball to the Homebridge host if you built elsewhere. Install it
in the environment used by Homebridge, then restart Homebridge:

```bash
npm install -g ./mrclmrvn-homebridge-broadlink-rm-5.0.0-alpha.1.tgz
```

Container, managed UI, and global npm installations may use different package
locations. Confirm which environment runs your service before installing. These
instructions do not publish anything to npm or assert that a registry release
exists.

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

Host entries require `address` and `mac`. `isRM4` selects RM4 framing, and
`isRFSupported` identifies an RF-capable model. These flags currently select
representative device IDs rather than allowing an exact device ID in config.
Discovery reads the ID reported by hardware; the CLI accepts an exact hexadecimal
ID for diagnostics. Model-specific static host selection still needs hardware
validation. There is no configurable UDP port or exact devType host field yet.

If hosts and discovery are both enabled, static entries are registered first;
devices are deduplicated by MAC. The current manager does not refresh the address
or type of an already registered MAC from a later discovery response. Use the
correct static address or remove a stale static entry before restarting.

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
sequences are currently implemented by switch/outlet types only.

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
Target temperatures are rounded to integer Celsius code keys (`temperature16`,
etc.). Entries can be a string or an object with a single `data` code. Turning
on prefers the current temperature code, falling back to on. Changing the target
while active sends its temperature code when present; missing codes are logged.
Set bounds and supply all temperature codes you intend to expose.

`coolOnly` restricts modes to Off/Cool. It defaults to false in code, while the
visual schema defaults to true; set it explicitly. The current port does not
select separate heat/cool code trees. Current activity is inferred from requests,
and current temperature initially uses the default target until sensor polling
succeeds. Polling uses the RM sensor when its model metadata advertises sensors;
0 disables it. This older Thermostat implementation does not use the new file
sensor reader and has less strict transmission/state handling than the newer
controllers. Full legacy AC options remain pending.

For distinct mode-specific `data.heat` / `data.cool`, use
[HeaterCooler](v5-remaining-accessories.md#heatercooler).

## Switches and IR learning

A normal switch uses `data.on` and `data.off`. See
[switch variants and sequences](v5-remaining-accessories.md#switch-variants-and-sequences)
for stateless buttons, automatic actions, repeat counts, and array data.

Add `type: "learn-code"` or `"learn-ir"` to expose a learning switch. Turn it on,
press one IR remote button toward the RM, and copy the logged hex code. The
Homebridge button waits up to 20 seconds and resets off when done. Capture one
button at a time. Turning the switch off resets its displayed state but does not
currently cancel an already running device learning operation. RF frequency-sweep
learning and the legacy scan-frequency button are not implemented.

Existing learned IR/RF hex can be sent without converting it. Actual RF
transmission depends on the device hardware and code frequency; accepting the
configuration is not hardware verification. Pronto conversion is not implemented.

## Pairing and next steps

Ordinary accessories are bridged. TV accessories are external and must be added
separately in HomeKit; see [TV pairing](v5-tv.md). v5 does not promise to preserve
v4 UUIDs or room/automation assignments. See [migration](v5-migration.md) and
[troubleshooting](v5-troubleshooting.md) for the next checks.
