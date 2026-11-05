# Homebridge Broadlink RM v5

A TypeScript rebuild of the Broadlink RM Homebridge plugin, packaged as
`@mrclmrvn/homebridge-broadlink-rm`. The plugin implements Broadlink UDP
communication using Node.js standard libraries. MQTT sensor integration uses
MQTT.js, without mandatory native compilation.
The package entry point is `dist/index.js`; legacy JavaScript files remain in this
repository for reference.

**Alpha status:** every legacy accessory type name now has a v5 implementation,
but full legacy configuration compatibility and physical-device validation remain
incomplete. Existing hex codes can be reused; advanced options may need changes.
Read the [migration guide](docs/migration.md) before replacing an installation.

## Start here

1. From the v5 checkout you want to test, build and check the package:

   ```bash
   npm ci
   npm test
   npm pack
   ```

2. On the machine running Homebridge, install the resulting local tarball using
   the same installation environment as your Homebridge service:

   ```bash
   npm install -g ./mrclmrvn-homebridge-broadlink-rm-5.0.0-alpha.1.tgz
   ```

3. Add a `BroadlinkRM` platform block. Start with discovery and an IR learning
   button, then add accessories with your actual codes:

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

This is a source/tarball installation path, not confirmation that an npm release
or alpha dist-tag has been published. Source development uses Node 22.12+ on the
22.x line, or Node 24/26, matching the locked Homebridge development dependency.
The declared Homebridge range still needs a compatibility audit beyond the
current development dependency before release.

See [installation and configuration](docs/setup.md) for static hosts, multiple
RM devices, platform options, and a [v5 sample config](config-v5-sample.json).

## Accessory guides

| Accessories | Configuration |
| --- | --- |
| Air conditioner / Thermostat, switches, IR learning | [Setup guide](docs/setup.md) |
| Fan / Fanv2 | [Fan](docs/fan.md) |
| Television, inputs, remote, volume | [TV and pairing](docs/tv.md) |
| Light, brightness, color presets | [Light](docs/light.md) |
| Window covering, garage door, lock | [Movement and lock controls](docs/moving-accessories.md) |
| Humidifier/dehumidifier, purifier, sensors, HeaterCooler | [Remaining types](docs/remaining-accessories.md) |
| Outlet, Window, Fan v1, switch variants | [Remaining types](docs/remaining-accessories.md#type-coverage) |

Reported power, movement, and lock state are generally inferred from successful
commands and timers. Real sensor readings are available only from supported
Broadlink hardware, file sources, or MQTT measurements. See each guide for failure
handling and unsupported options.

## Diagnostics and development

- [MQTT sensors](docs/mqtt.md): legacy topics, Zigbee2MQTT JSON, credentials,
  freshness, and integration with AC, HeaterCooler and humidity controllers.

- [Driver and protocol update](docs/protocol.md): RF learning, Pronto conversion,
  corrected authentication/framing, exact device IDs, and packaging changes.

- [CLI and troubleshooting](docs/troubleshooting.md): discovery, authentication,
  IR learning, sending codes, sensor checks, and useful issue details.
- [Development and release](docs/development.md): source layout, tests, CI,
  packaging, and release validation still needed.
- [Validation runbook](docs/validation.md) and [report template](docs/validation-report-template.md):
  reproducible hardware, Homebridge, MQTT, and rollback checks.
- [Roadmap](docs/roadmap.md): outstanding integrations, compatibility, testing,
  and packaging work.
- [Changelog](CHANGELOG.md): unreleased v5 work and historical v4 releases.

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

The [legacy README](docs/v4-readme.md) retains the v4 reference material and
acknowledgments with an updated introduction explaining the continuation. The root
`config-sample.json`, `config-multiple-rm-devices-sample.json`, and
`config-sample.json-W1` files are legacy references, not v5 compatibility examples.

License: [ISC](LICENSE).
