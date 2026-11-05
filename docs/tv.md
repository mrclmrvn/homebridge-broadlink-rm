# v5 television support

Use `type: "tv"` (or `"television"`) in the platform accessories array:

```json
{
  "name": "Living Room TV",
  "type": "tv",
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "inputs": [
      { "name": "HDMI 1", "type": "hdmi", "data": "YOUR_HDMI1_HEX" },
      { "name": "Apple TV", "type": "hdmi", "data": "YOUR_HDMI2_HEX" }
    ],
    "remote": {
      "arrowUp": "YOUR_UP_HEX",
      "arrowDown": "YOUR_DOWN_HEX",
      "arrowLeft": "YOUR_LEFT_HEX",
      "arrowRight": "YOUR_RIGHT_HEX",
      "select": "YOUR_SELECT_HEX",
      "back": "YOUR_BACK_HEX",
      "exit": "YOUR_EXIT_HEX",
      "playPause": "YOUR_PLAY_PAUSE_HEX",
      "info": "YOUR_INFO_HEX"
    },
    "volume": {
      "up": "YOUR_VOLUME_UP_HEX",
      "down": "YOUR_VOLUME_DOWN_HEX",
      "mute": "YOUR_MUTE_TOGGLE_HEX"
    }
  }
}
```

Replace placeholders with learned codes. Set `host` when selecting a specific
Broadlink device. Input identifiers preserve legacy zero-based array indices.
Additional remote keys are `rewind`, `fastForward`, `nextTrack`, and
`previousTrack`. Optional `data.powerMode.show` and `.hide` control TV settings.

TVs are published as external accessories. After restarting Homebridge, add each
TV separately in the Home app using Add Accessory / More Options and the
Homebridge pairing code. An older bridged TV cache entry with the same name and
host is removed during migration. Renaming the TV or changing its host changes
its accessory identity. Restart Homebridge after configuration changes.
Entries resolving to the same name/host identity are duplicates, even when one
uses `tv` and another uses `television`. The first enabled entry is used and later
duplicates are skipped with a warning, preventing repeated external publication.

If the TV is absent from More Options, first confirm that its configuration loaded
without errors and check Homebridge's external-accessory publication/listening
logs. Publication through the plugin API alone does not establish that mDNS is
advertising successfully. Record the running Homebridge/Node/iOS versions, whether
a child bridge is used, and any network, advertiser or host-migration changes.
Capture redacted logs before changing pairing or cache state. Follow the
[validation runbook](validation.md#upstream-reliability-checks) when checking a
migration; the original upstream pairing report remains unverified on hardware.

Power and mute state are inferred from successful sends and reset on startup.
Repeated identical power or mute requests do not resend toggle codes. Volume
uses relative up/down commands; absolute volume is not exposed. Input selection
does not automatically power on the TV. Missing codes and transmission failures
are reported to HomeKit.

Optional [Ping/ARP power detection](power-and-feedback.md#ping-and-arp-power-estimates)
updates Active and checks observed state before a power command. Monitoring sends
no IR. Without detection, toggle-only remotes can lose synchronization after
changes from another remote or plugin restart. All command leaves accept
[structured sequences](power-and-feedback.md#shared-structured-commands), and
writes are serialized. Automatic power timers and explicit picture-mode mappings
are described below. Full legacy compatibility remains a goal.

## Automatic power and picture modes

`enableAutoOff` / `enableAutoOn` schedule actual Off/On commands using positive
`onDuration` / `offDuration` seconds (default 60). Explicit
`disableAutomaticOff` / `disableAutomaticOn` override those flags: false enables,
true disables. Timers start after a successful request, never at startup.
Observed power changes cancel a pending timer; shutdown cancels all owned work.
Automatic command failure is logged and preserves the previous power estimate.

Optional picture mappings use `data.pictureMode`:

```json
{
  "pictureMode": {
    "standard": "YOUR_STANDARD_HEX",
    "game": { "data": "YOUR_GAME_HEX", "sendCount": 2, "interval": 0 }
  }
}
```

Names map to HomeKit values: other=0, standard=1, calibrated=2, calibratedDark=3,
vivid=4, game=5, computer=6, custom=7. Numeric string keys 0–7 are also accepted;
only configured values are offered. Each is a discrete command/sequence, not an
inferred cycle count. Until a preset is successfully selected, PictureMode is
unavailable. Failed sends retain the last successful selection and repeated
identical selections are suppressed. Selecting a picture mode does not power on
the TV. Removing the map removes the cached optional control. The old plugin's
picture-mode callback was a placeholder; this mapping is an explicit v5 extension.

`npm test` checks controls, failure handling, input cleanup, external publishing,
and migration using mocks. Live Homebridge pairing and physical TV operation
still require validation.
