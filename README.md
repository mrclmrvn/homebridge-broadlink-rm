# Homebridge Broadlink RM v5

Control IR/RF appliances from Apple Home and Siri through Homebridge and Broadlink
RM hardware. Configure accessories for your appliances and reuse their learned
remote-control codes.

This fork continues the Broadlink RM plugin as a TypeScript-based v5 rebuild,
packaged as `@mrclmrvn/homebridge-broadlink-rm`.

**v5.0.3 is the current stable release of the rebuild.** Every legacy accessory
type name has a v5 implementation. Full legacy option compatibility and broad
hardware coverage remain incomplete. Existing hex codes can be reused; advanced
options may need changes.

## Requirements and hardware

- **Homebridge:** declared support is `^1.6.0 || ^2.0.0`.
  [Automated version coverage](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/homebridge-compatibility.md) exercises
  1.6.0, 1.11.4, 2.0.0 and 2.5.0. One RM4/AC has live validation;
  other hardware and accessory types still need user feedback.
- **Node.js:** 22.12+ within 22.x, or Node 24/26. Choose a version supported by
  both this plugin and your Homebridge release; older Homebridge versions may
  exclude Node 26.
- **Broadlink hardware:** the driver includes RM2/RM3 and RM4 protocol paths,
  covering Mini/Pro variants in its device table. RF requires an RF-capable
  device and matching frequency; temperature/humidity readings require the
  relevant built-in or cable sensor. Model-specific operation needs validation.
- **Network access:** Homebridge must be able to reach the RM on the local
  network. Discovery uses broadcasts; static hosts are available when needed.
  See [network troubleshooting](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/troubleshooting.md#discovery-finds-nothing).

## Start here

1. Back up your Homebridge configuration and storage. If you already use
   `homebridge-broadlink-rm-pro`, follow the migration steps below.

2. Install `@mrclmrvn/homebridge-broadlink-rm` through your Homebridge plugin
   manager, or in the npm environment used by your Homebridge service:

   ```bash
   npm install -g @mrclmrvn/homebridge-broadlink-rm@5.0.3
   ```

   Managed installations may use a local prefix instead of `-g`. See the setup
   guide for the correct installation environment.

3. Add this `BroadlinkRM` object to the existing `platforms` array in your
   Homebridge config. Start with discovery and an IR learning button, then add
   accessories with your actual codes:

   ```json
   {
     "platform": "BroadlinkRM",
     "name": "Broadlink RM",
     "disableDiscovery": false,
     "accessories": [
       { "name": "Learn IR", "type": "learn-code" }
     ]
   }
   ```

4. Restart Homebridge. Turn on Learn IR to capture a remote button and copy the
   logged hex code into an accessory's data configuration. TVs require separate
   HomeKit pairing; other types are bridged.

### Migrating from kiwi-cam's `homebridge-broadlink-rm-pro`

v5 uses the same `BroadlinkRM` platform name, so you can reuse the existing
platform entry in your Homebridge `config.json`, including accessory definitions
and learned IR/RF hex codes. Review the
[configuration differences](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/migration.md#configuration-differences-to-review)
for legacy options that need changes.

1. Back up Homebridge, including `config.json` and cached accessory data.
2. Stop Homebridge. Uninstall `homebridge-broadlink-rm-pro` and install
   `@mrclmrvn/homebridge-broadlink-rm` in the same Homebridge environment.
3. Keep your existing `BroadlinkRM` entry. If the plugin manager removes it
   during uninstall, restore that entry from your backup before restarting.
4. Restart Homebridge and verify your accessories. Apple Home room assignments,
   scenes, and automations may need to be reassigned if accessory identities change.

See the [migration guide](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/migration.md)
for pairing and rollback details.

Automatic discovery repeats hourly by default; [rediscovery settings](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/rediscovery.md)
explain interval, disable and MAC-selection behavior. Configure accessories using
the existing schema or JSON, and capture codes with learning accessories or the CLI.

An AC requiring a separate power-on code should set `"turnOnWhenOff": true`
and configure `data.on`. Otherwise v5 uses its selected mode/temperature code
when leaving Off. State persistence restores accepted settings without replaying
startup IR; live measurements always come from current sensor sources.

### AC tile behavior (5.0.1)

The operating-state pairs are:

| Configuration | Operating states |
| --- | --- |
| `"coolOnly": true` | Cool ↔ Off |
| `"heatOnly": true` | Heat ↔ Off |

Set only one of these flags. Returning from Off uses the remembered temperature,
or the configured startup default when no saved target exists. Keep
`turnOnWhenOff: true` and `data.on` if the appliance needs an explicit power-on
code before its temperature command.

Some Apple Home clients send Heat (1) when tapping an Off cool-only tile. From
5.0.1-beta.3, this request automatically routes to Cool, sends only cooling codes,
and normalizes the displayed/saved mode to Cool. No `homeAppTileOn` option is
needed. Heat-only ACs keep normal Heat behavior.

The HomeKit Thermostat service must advertise Heat as an accepted alias for this
cool-only compatibility behavior. Apple Home may therefore also show a Heat
selection, which routes to Cool; its visible picker is not guaranteed to contain
only Cool and Off. Removing that accepted alias would restore the rejected-write
failure. This fixes the confirmed tile activation issue without changing the
accessory's service type or identity.

The development repository is private. Additional guides and sample configuration
ship inside the installed package; the public documentation links below read
those files from the published npm package.

See [installation and configuration](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/setup.md) for static hosts, multiple
RM devices, platform options, and a [v5 sample config](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/config-v5-sample.json).

## Accessory guides

| Accessories | Configuration |
| --- | --- |
| Air conditioner / Thermostat | [Setup](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/setup.md), [mode/default options](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/air-conditioner.md) |
| Switches, IR learning | [Setup guide](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/setup.md) |
| Fan / Fanv2 | [Fan](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/fan.md) |
| Television, inputs, remote, volume | [TV and pairing](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/tv.md) |
| Light, brightness, color presets | [Light](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/light.md) |
| Window covering, garage door, lock | [Movement and lock controls](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/moving-accessories.md) |
| Humidifier/dehumidifier, purifier, sensors, HeaterCooler | [Remaining types](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/remaining-accessories.md) |
| Outlet, Window, Fan v1, switch variants | [Remaining types](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/remaining-accessories.md#type-coverage) |

Reported power, movement, and lock state are generally inferred from successful
commands and timers. Real sensor readings are available only from supported
Broadlink hardware, file sources, or MQTT measurements. See each guide for failure
handling and unsupported options.

## Troubleshooting and bug reports

Documentation is available in the [setup guide](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/setup.md) and
[accessory guides](#accessory-guides). If you still have trouble after reading
them, include the details listed below when reporting a problem to the maintainer.
The development repository and its issue tracker require repository access.

If discovery finds nothing, check reachability from the machine or container
running Homebridge and review [discovery troubleshooting](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/troubleshooting.md#discovery-finds-nothing).

### Unlock local control in the Broadlink app

The Broadlink device's cloud lock can prevent discovery or local connections.
If your device is locked, follow these steps:

1. Open the [Broadlink app](https://apps.apple.com/us/app/broadlink/id1450257910).
2. From the Home screen, tap your Broadlink device.
3. Tap **…** in the top right.
4. Scroll down and toggle **Lock device** to **Off**.
5. Tap **OK** when prompted **Confirm to unlock the device**.

<img src="https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/images/broadlink-unlock-device.png" alt="Broadlink app device settings showing Lock device switched off" width="375">

Screenshot retained from the [previous maintainer's documentation](https://github.com/kiwi-cam/homebridge-broadlink-rm#documentation).
App navigation may vary by version. Retry discovery or authentication after
unlocking; see [authentication troubleshooting](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/troubleshooting.md#authentication-or-sends-fail)
if local connections still fail.

For reproducible problems, include the plugin, Homebridge and Node versions; RM model/device ID; relevant
configuration; and logs showing the error and expected behavior. Redact passwords,
MQTT credentials and Homebridge pairing codes. Include whether the problem
occurs after restart or only with a particular command or sensor source.

## Diagnostics and development

- [Scheduled rediscovery](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/rediscovery.md): late-device recovery, DHCP address
  changes, static hosts and shutdown behavior.
- [Sensor sources](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/sensor-sources.md): 1-wire, explicit pseudo temperatures,
  source precedence and optional battery telemetry.
- [Power and feedback](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/power-and-feedback.md): Ping/ARP estimates, shared
  command sequences, garage endpoints/obstruction and lock-bolt sensors.
- [MQTT sensors](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/mqtt.md): legacy topics, Zigbee2MQTT JSON, credentials,
  freshness, and integration with AC, HeaterCooler and humidity controllers.
- [Driver and protocol update](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/protocol.md): RF learning, Pronto conversion,
  corrected authentication/framing, exact device IDs, and packaging changes.
- [CLI and troubleshooting](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/troubleshooting.md): discovery, authentication,
  IR learning, sending codes, sensor checks, and useful issue details.
- [Homebridge version coverage](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/homebridge-compatibility.md): exact targets,
  selected HAP dependencies, real API/cache tests and CI scope.
- [Development and release](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/development.md): source layout, tests, CI,
  packaging, and release validation still needed.
- [Validation runbook](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/validation.md) and [report template](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/validation-report-template.md):
  reproducible hardware, Homebridge, MQTT, and rollback checks.
- [Legacy compatibility audit](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/legacy-compatibility-audit.md): fallback rules,
  configuration differences and remaining concrete gaps.
- [Roadmap](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/roadmap.md): outstanding integrations, compatibility, testing,
  and packaging work.
- [Changelog](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/CHANGELOG.md): v5 changes and historical v4 releases.

The package entry point is `dist/index.js`, built from `src/`. The Broadlink
driver uses Node.js standard libraries; configured MQTT sources use MQTT.js,
without mandatory native compilation. Legacy JavaScript files remain as reference material in the private repository.
Contributors with repository access can build using `npm ci`, `npm run test:homebridge`
and `npm pack`. Contributions and regression tests are welcome; see the
[development guide](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/development.md) for the workflow and test expectations.

## Support the project

You can support the project by starring the repository, reporting bugs, testing
your hardware, or contributing code and documentation.

If you find this plugin useful, you can [buy me a drink on PayPal](http://paypal.me/mrclmrvn)
to support its continued development.

## Project history

This fork continues the plugin with a TypeScript-based v5 rebuild maintained by
[@mrclmrvn](https://github.com/mrclmrvn), following
[@kiwi-cam](https://github.com/kiwi-cam)'s invitation for the community to carry it
forward after more than seven years of maintenance.

Thank you to previous maintainers [@kiwi-cam](https://github.com/kiwi-cam) and
[@lprhodes](https://github.com/lprhodes), whose work made this continuation
possible. Credit also goes to the earlier projects by
[@tattn](https://github.com/tattn/homebridge-rm-mini3),
[@PJCzx](https://github.com/PJCzx/homebridge-thermostat), and
[@momodalo](https://github.com/momodalo/broadlinkjs), along with
[@Cloudore](https://github.com/Cloudore),
[@Faisalthe01](https://github.com/Faisalthe01), and everyone who contributed code,
testing, documentation, and bug reports.

The [legacy README](https://cdn.jsdelivr.net/npm/@mrclmrvn/homebridge-broadlink-rm@5.0.3/docs/v4-readme.md) retains the v4 reference material and
acknowledgments with an updated introduction explaining the continuation. The root
`config-sample.json`, `config-multiple-rm-devices-sample.json`, and
`config-sample.json-W1` files are legacy references, not v5 compatibility examples.

License: [ISC](LICENSE).
