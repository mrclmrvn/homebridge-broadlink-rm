# v5 light support

Add `type: "light"` to the BroadlinkRM platform's accessories array:

```json
{
  "name": "Living Room Light",
  "type": "light",
  "defaultBrightness": 75,
  "useLastKnownBrightness": true,
  "onDelay": 0.1,
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "brightness25": "YOUR_DIM_HEX",
    "brightness75": "YOUR_BRIGHT_HEX",
    "brightness100": "YOUR_FULL_HEX",
    "hue0": "YOUR_RED_HEX",
    "hue120": "YOUR_GREEN_HEX",
    "hue240": "YOUR_BLUE_HEX",
    "white": "YOUR_WHITE_HEX"
  }
}
```

Replace placeholders with learned codes, and set `host` to select a specific
Broadlink device. An on/off-only light needs only `data.on` and `data.off`.

Controls appear when matching codes are configured:

- `brightnessXX`: percentages from 1 to 100. Zero sends `off`. Positive requests
  use the nearest configured level, with ties choosing the lower level. Turning
  on restores the last level when `useLastKnownBrightness` is true; otherwise it
  selects the nearest `defaultBrightness` (default 100).
- `hueXX`: degrees from 0 to 360. Selection wraps around the color wheel, so
  359 degrees can select `hue0`. Hue codes are assumed to select fully saturated
  colors. A `white` code handles saturation requests below 10%, reported as 0%.
- `saturationXX`: optional discrete percentages from 0 to 100, sent after a hue
  code. Without these codes, only 100% saturation and the white preset are
  supported; other saturation requests report an error. Saturation is exposed
  alongside hue controls.
- `colorTemperatureXX`: discrete HomeKit mired values from 140 to 500, such as
  `colorTemperature200` and `colorTemperature400`. The nearest preset is used.
  These are inverse-temperature values, not Kelvin.

When a brightness or color command needs to power on the light, `data.on` is
sent first if configured, followed by `onDelay` seconds (default 0.1). Without
`data.on`, the preset command is assumed to turn the light on. Writes are queued
per light to keep power delays and multi-command color changes in order.

State reflects successful sends, starts off after restart, and cannot detect
changes from another remote. Missing codes and failed sends report errors to
HomeKit. If power-on succeeds but a later preset fails, the light remains on in
the reported state. Similarly, a successful hue send is retained when a later
saturation send fails. Color temperature and hue/saturation are separate inferred
states; no physical color conversion or feedback is available.

`exclusives: ["Other Light Name"]` marks named lights Off locally when this
light turns on; the relationship is reciprocal and does not send their off
codes. Use it for alternate presets that physically replace one another, rather
than independent lights needing an off transmission.

`enableAutoOff` / `enableAutoOn` schedule real Off/On commands after `onDuration`
/ `offDuration` (default 60 seconds). Explicit legacy `disableAutomaticOff: false`
/ `disableAutomaticOn: false` also enable them. Durations must be positive when
enabled. No automatic command runs at startup; shutdown cancels timers and
power-on delays. Commands accept [structured sequences](power-and-feedback.md#shared-structured-commands).
Other advanced legacy options remain roadmap work. Restart Homebridge after
changing configuration; cached optional controls are removed when their
corresponding code groups are removed.

Run `npm test` for mocked control, queue ordering, and transmission failure tests.
Live Homebridge and physical light validation remain outstanding.
