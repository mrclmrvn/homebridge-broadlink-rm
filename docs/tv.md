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
writes are serialized. Automatic TV power timers and picture modes remain
unimplemented; full legacy compatibility remains a goal.

`npm test` checks controls, failure handling, input cleanup, external publishing,
and migration using mocks. Live Homebridge pairing and physical TV operation
still require validation.
