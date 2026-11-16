# v5.0.0 — first stable rebuild

The Broadlink RM plugin is distributed publicly on npm as
`@mrclmrvn/homebridge-broadlink-rm`. The development repository remains private.

This release rebuilds the plugin as a TypeScript Homebridge dynamic platform,
with a native Node.js Broadlink driver and no mandatory native compilation.
It implements every legacy accessory type name, IR/RF learning, Pronto codes,
scheduled rediscovery and native/file/MQTT/1-wire sensor sources. Validated state
persistence restores settings across stateful accessory families without
replaying startup commands or timers. See [state persistence](state-persistence.md)
for movement, lock, transient-action and live-telemetry limits.

Live RM4 testing identified and fixed authentication-response opcode handling.
One AC has confirmed sensor reads, Homebridge UI control, Apple Home power-on
with an explicit On code and target-temperature persistence. The newly expanded
state persistence is covered automatically; broader live feedback is welcome.
The release suite passes 248 tests. Merged-source CI covers Node 22/24/26 on
Linux, Windows and macOS, plus representative Homebridge 1.x/2.x boundaries.

## Install and migrate

Use your Homebridge plugin manager, or install in its npm environment:

```bash
npm install -g @mrclmrvn/homebridge-broadlink-rm@5.0.0
```

Use `-g` only for global installations. Managed native Ubuntu installations may
use the local `/var/lib/homebridge` prefix; see [setup](setup.md). No GitHub
checkout or repository access is required to install the public npm package.

Back up full Homebridge storage before replacing v4. Stop Homebridge, uninstall
`homebridge-broadlink-rm-pro`, install v5 in the same environment, and restart.
Retain full configuration and pairing data. Do not run both plugins against the
same `BroadlinkRM` platform. Scene and automation links may need reassignment.
Existing learned codes can be reused, but advanced options may need changes.

ACs whose temperature codes do not power them on need `turnOnWhenOff: true`
and an explicit `data.on`. Older target-only v5 snapshots initially start Off;
select a mode once to save it for subsequent restart restoration. Persistence
does not detect external remotes or physically restart an appliance after its
own power loss.

## Scope

Full v4 option parity and broad hardware coverage are not claimed. Custom UI
and optional Eve history are excluded. Homebridge verification has not been
claimed. Continue hardware validation and report the plugin/Homebridge/Node
versions, model/device type, expected behavior and redacted logs when sharing
feedback. See [migration](migration.md), [troubleshooting](troubleshooting.md)
and the [roadmap](roadmap.md).

Thanks to the previous maintainers and contributors credited in the README.
