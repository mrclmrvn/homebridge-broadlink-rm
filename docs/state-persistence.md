# Accessory state persistence

`persistState` defaults to true for stateful accessories. Accepted settings are
saved during normal operation, not only during shutdown. Restarting Homebridge
or recovering from a process crash restores the last saved settings without
replaying IR/RF, learning, movement, repeats or automatic power timers.

| Accessory | Restored settings and limits |
| --- | --- |
| AC/Thermostat | Mode, target temperature and last active mode; older target-only caches start Off until a mode is saved. See [AC details](air-conditioner.md#saved-state-and-legacy-defaults). |
| HeaterCooler | Active state, supported mode, heat/cool thresholds, rotation speed and swing preset. |
| Switch/outlet and multi/repeat variants | Latched On state. Virtual automation gates are included. Outlet use is inferred from the saved latch only without a live power probe. |
| Fan/Fanv1 | Active/On, supported speed, direction and swing settings. Relative speed-cycle position is not trusted after a restart: switch Off/On before selecting a new cycle speed. |
| Light | On, mapped brightness, last brightness, hue, saturation and color-temperature presets. A stateless light stays Off but may retain presets. |
| TV | Active, mute, input and confirmed picture mode. Changed input definitions invalidate the old input selection; unsupported picture modes become unconfirmed. Relative volume/remote-key presses are not state and are never replayed. |
| Air purifier | Fan settings, supported target mode and optional physical-controls lock. |
| Humidifier/dehumidifier | Fan settings, supported target mode, ordered humidity thresholds, last commanded activity and optional physical-controls lock. Fresh measurements continue to drive configured automatic control. |
| Window/covering | Last completed or held position estimate and target. Interrupted movement starts Stopped with current position unavailable; select endpoint 0 or 100 to recalibrate before requesting partial positions. Movement never resumes automatically. |
| Garage door | Door and optional lock targets. Current door state starts Stopped and lock state Unknown; configured live feedback can establish their physical state. No transition, automatic close or relock timer resumes. |
| Lock | Requested lock target. Current state starts Unknown until fresh feedback or a new command completes. No transition or automatic relock resumes. |
| Temperature/humidity sensors and battery telemetry | Read fresh data. Measurements, freshness timestamps, connection state and faults are not restored as current readings. |
| Learning switches and momentary/action-only switches | Start idle/Off. Learning sessions and button/repeat actions are never resumed. |

Snapshot fields are allowlisted and validated against the current accessory
type/configuration. Unsupported or malformed values fall back to defaults.
State from a different accessory type is ignored. Successful changes and timed
local resets update the snapshot; failed commands do not save their requested
target. A partially completed multi-command sequence may still change the
physical appliance, so verify it after a failure.

Explicit `persistState: false` ignores saved settings and skips further state
writes. It does not erase older snapshots: re-enabling may restore older values.
It does not disable live sensors, probes or configured automation.

## Storage and recovery

Bridged accessories use their Homebridge accessory context/cache. External TVs
are recreated rather than registered in that bridged cache, so their state uses
an atomically replaced JSON file under:

```text
<Homebridge storage>/broadlink-rm-state/<bridge-scope hash>/<accessory UUID hash>.json
```

TV files contain state only, not full configuration, credentials or learned IR
codes. Their scope uses the child-bridge username when configured, otherwise the
platform name. Keep the same platform/bridge identity for restoration. A missing
file uses defaults; a malformed or unreadable file warns and uses defaults. A
failed TV write warns without failing a successful device command and is retried
on a subsequent accepted operation. Files are retained when persistence is
disabled; stop Homebridge and remove that TV's file to clear its saved state.
Include this directory in backups alongside the normal Homebridge storage.

Storage failures, removal of state files/cache, or termination before a write
completes can lose the latest change. This is not a power-loss durability
guarantee. A remote control or appliance power interruption can also make saved
state differ from reality. Fresh configured feedback takes precedence over
saved assumptions. Restoration does not physically power an appliance back on.

Configured sensor/probe polling and automation still start normally. For example,
a restored active humidity controller may send a new control command after a
fresh reading requires it; the saved action itself is never replayed at startup.

Coverage is automated across accessory families, including an external TV disk
round-trip. Live hardware validation of the expanded persistence remains pending.
