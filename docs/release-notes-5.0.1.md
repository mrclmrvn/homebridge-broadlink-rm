# v5.0.1 — Apple Home AC tile activation

Fix Apple Home tile activation for cool-only air conditioners. Apple Home can
send Heat (1) when activating an Off thermostat; rejecting that value previously
caused “No response” before the plugin could receive the request.

With `coolOnly: true`, the plugin now automatically accepts that request and
routes it to Cool at the remembered or default temperature. No additional flag
is required. The reported and saved mode normalizes to Cool. Heat-only and
combined-mode accessories retain their normal Heat behavior.

HomeKit requires the accepted Heat alias to be advertised, so a cool-only mode
picker may also show Heat. That alias sends cooling commands. See
[AC configuration](air-conditioner.md) for details.

Live testing confirmed Apple Home tile activation with a retained 23 C target.
Regression coverage includes actual HAP client writes, mode normalization and
remembered-temperature Off/On cycles. The local Homebridge suite passes 253
tests. GitHub Actions jobs could not start because of the account billing or
spending limit; the cross-platform CI matrix was not rerun for this release.

Update using the Homebridge plugin manager or install this version in the same
npm environment as your existing plugin:

```bash
npm install -g @mrclmrvn/homebridge-broadlink-rm@5.0.1
```

Use `-g` only for global installations; see [setup](setup.md) for managed Ubuntu
installations. Keep your configuration, storage and pairing data. Existing
`coolOnly` configurations require no new option. See the [changelog](../CHANGELOG.md)
and [live validation record](live-validation-2026-11-17.md).
