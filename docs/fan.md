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
`stepSize` from 1 to 100. Direct power-on sends only `data.on`.

Direction uses `data.clockwise` and `data.counterClockwise`. Swing uses
`data.swingOn` / `data.swingOff`, falling back to `data.swingToggle`.
Repeated direction and swing requests do not transmit duplicate toggle codes.
Hide controls using `hideRotationDirection` / `hideSwingMode`, or set the legacy
`showRotationDirection` / `showSwingMode` options to false. Missing codes report
an error to HomeKit; failed sends do not commit the affected control's state.

State is inferred from successful transmissions and starts off on plugin startup.
External remote changes cannot be detected. Legacy `speedCycle`, automatic power
timers, default speed/reset options, ping/ARP detection, and structured code
sequences are not implemented in this v5 fan port yet. Full legacy configuration
compatibility remains a roadmap goal.

Run `npm test` to build and run the v5 tests. These tests use an accessory mock
and a fake Broadlink sender; hardware and live Homebridge validation remain
necessary before release. The legacy tests in `test/` are separate from this suite.
