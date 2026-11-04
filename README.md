# Homebridge Broadlink RM v5

A TypeScript rebuild of the Broadlink RM Homebridge plugin, packaged as
`@mrclmrvn/homebridge-broadlink-rm`. The plugin implements Broadlink UDP
communication using Node.js standard libraries and has no runtime npm dependencies.
The package entry point is `dist/index.js`; legacy JavaScript files remain in this
repository for reference.

**Alpha status:** every legacy accessory type name now has a v5 implementation,
but full legacy configuration compatibility and physical-device validation remain
incomplete. Existing hex codes can be reused; advanced options may need changes.
Read the [migration guide](docs/v5-migration.md) before replacing an installation.

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
The broader Node/Homebridge ranges in package.json still need a compatibility
audit before release.

See [installation and configuration](docs/v5-setup.md) for static hosts, multiple
RM devices, platform options, and a [v5 sample config](config-v5-sample.json).

## Accessory guides

| Accessories | Configuration |
| --- | --- |
| Air conditioner / Thermostat, switches, IR learning | [Setup guide](docs/v5-setup.md) |
| Fan / Fanv2 | [Fan](docs/v5-fan.md) |
| Television, inputs, remote, volume | [TV and pairing](docs/v5-tv.md) |
| Light, brightness, color presets | [Light](docs/v5-light.md) |
| Window covering, garage door, lock | [Movement and lock controls](docs/v5-moving-accessories.md) |
| Humidifier/dehumidifier, purifier, sensors, HeaterCooler | [Remaining types](docs/v5-remaining-accessories.md) |
| Outlet, Window, Fan v1, switch variants | [Remaining types](docs/v5-remaining-accessories.md#type-coverage) |

Reported power, movement, and lock state are generally inferred from successful
commands and timers. Real sensor readings are available only from supported
Broadlink hardware or the implemented file sources. See each guide for failure
handling and unsupported options.

## Diagnostics and development

- [CLI and troubleshooting](docs/v5-troubleshooting.md): discovery, authentication,
  IR learning, sending codes, sensor checks, and useful issue details.
- [Development and release](docs/v5-development.md): source layout, tests, CI,
  packaging, and release validation still needed.
- [Roadmap](docs/v5-roadmap.md): outstanding integrations, compatibility, testing,
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

The [legacy README](docs/legacy-readme.md) retains the v4 reference material and
acknowledgments with an updated introduction explaining the continuation. The root
`config-sample.json`, `config-multiple-rm-devices-sample.json`, and
`config-sample.json-W1` files are legacy references, not v5 compatibility examples.

License: [ISC](LICENSE).
