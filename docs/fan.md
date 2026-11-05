# v5 fan support

The TypeScript platform supports `type: "fan"` using HomeKit Fanv2.

```json
{
  "name": "Turbo Fan",
  "type": "fan",
  "speedSteps": 3,
  "hideRotationDirection": true,
  "data": {
    "on": "YOUR_ON_HEX",
    "off": "YOUR_OFF_HEX",
    "fanSpeed33": "YOUR_LOW_HEX",
    "fanSpeed66": "YOUR_MEDIUM_HEX",
    "fanSpeed99": "YOUR_HIGH_HEX",
    "swingToggle": "YOUR_SWING_HEX"
  }
}
```

Place this object in the BroadlinkRM platform's `accessories` array. Set `host`
when selecting a specific Broadlink device. Replace placeholders with learned codes.

Positive speed requests select the nearest configured `fanSpeedXX` percentage.
Ties select the lower speed. A positive speed request powers on an inactive fan
before sending its speed code. Zero sends `data.off` and resets speed to zero.
`speedSteps: 3` sets HomeKit's percentage increment to 33; alternatively configure
`stepSize` from 1 to 100. Direct power-on sends only `data.on` unless default reset is enabled.

Direction uses `data.clockwise` and `data.counterClockwise`. Swing uses
`data.swingOn` / `data.swingOff`, falling back to `data.swingToggle`.
Repeated direction and swing requests do not transmit duplicate toggle codes.
Hide controls using `hideRotationDirection` / `hideSwingMode`, or set the legacy
`showRotationDirection` / `showSwingMode` options to false. Missing codes report
an error to HomeKit; failed sends do not commit the affected control's state.

For a single speed-cycle button, set `speedCycle: true`, integer `speedSteps`
(1–100), and `data.fanSpeed`. The plugin assumes power-on starts at
`defaultSpeedStep` (default 1), then sends the forward pulse count, wrapping
at the last speed. `speedCycleInterval` defaults to 0.1 seconds between pulses.
Configure the assumed startup step to match the appliance. An external power-on
or failed pulse leaves cycle position unknown; turn off/on to establish it again.
Power cycling must actually reset the appliance to that step.

`alwaysResetToDefaults: true` applies `defaultFanSpeed` (default 100), or
`defaultSpeedStep * stepSize` when supplied, on direct power-on. A speed request
uses its requested speed instead. Successful power changes remain reported if a
later default-speed command fails. `enableAutoOff` / `enableAutoOn` send actual
power commands after `onDuration` / `offDuration` (default 60 seconds). Explicit
legacy `disableAutomaticOff: false` / `disableAutomaticOn: false` also enable
them. Durations must be positive when enabled; no automatic command starts at
plugin startup. Shutdown cancels owned timers.

State starts off and otherwise follows successful sends or optional
[Ping/ARP observations](power-and-feedback.md#ping-and-arp-power-estimates).
Each command accepts [structured sequences](power-and-feedback.md#shared-structured-commands).
Speed, direction and swing remain inferred; full legacy configuration parity
and physical device validation remain roadmap work.

Run `npm test` to build and run the v5 tests. These tests use an accessory mock
and a fake Broadlink sender; hardware and live Homebridge validation remain
necessary before release. The legacy tests in `test/` are separate from this suite.
