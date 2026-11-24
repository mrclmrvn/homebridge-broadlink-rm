# Upstream issue checkpoint

Reviewed November 5, 2026 against kiwi-cam's open reports and the current rebuild.
This is a local assessment, not a claim that upstream issues were closed or
that real devices have been validated. The maintainer's farewell proposed
continuing maintenance and a rebuild; it did not provide an acceptance checklist.

| Original issue | Rebuild status | Remaining evidence or implementation |
| --- | --- | --- |
| [#788: temperature reads hang](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/788) | Native accessory reads now have a two-second end-to-end deadline, in-flight sharing, cancellation and recovery | Hardware loss/recovery and live Homebridge warning checks; unavailable readings are reported rather than the report's suggested stale-value fallback |
| [#781: crash/devices offline](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/781) | MAC address normalization/rediscovery routing and stale-IP isolation have regression coverage | Reproduce the reported crash and capture a stack; device loss and iOS child-bridge pairing remain live checks |
| [#782: TV missing during pairing](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/782) | External publication, stable restart identity and old bridged-cache migration have tests; duplicate identity publication is guarded | Real mDNS advertisement, initial pairing, migrated host and restart checks on iOS |
| [#784: Homebridge 2](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/784) | Automated Homebridge 2.0/2.5 coverage alongside 1.x boundaries | Live installations remain unvalidated; see the version coverage guide |
| [#776: HeaterCooler Auto](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/776) | HeaterCooler advertises configured Heat/Cool modes only | Actual HeaterCooler Auto support is absent; Thermostat-style AC Auto is separate |
| [#774: RM Max 0xaf8b](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/774) | No explicit device mapping or validated protocol fixture | Establish model capabilities/framing and test discovery, learning and transmission |
| [#783: fan direction/speed codes](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/783) | Not implemented | Combined direction-aware speed maps and selection semantics |
| [#785: IR groups and delays](https://github.com/kiwi-cam/homebridge-broadlink-rm/issues/785) | Opt-in per-transmitter cooldown and grouped IR transmission scheduling are implemented | Validate scene reliability and latency on overlapping physical transmitters |

## Related open pull requests

The open issue list contains eight reports, but proposed work in open PRs also
reveals gaps that should be tracked separately:

| Proposal | Rebuild assessment |
| --- | --- |
| [#786: MAC tracking and scheduled rediscovery](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/786) | Scheduled sweeps, late-device recovery, MAC/IP refresh, unusable-socket replacement and link-local diagnostics are implemented with overlap/shutdown tests. Actual DHCP/network recovery needs live validation. Optional failure-triggered sweeps and per-device health summaries remain absent. |
| [#787: configuration UI](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/787) | Deferred from the core upgrade by user decision. Implementation, UI dependency and tests are preserved on local branch `feat/custom-configuration-ui` at `24dc8ed`; they are absent from this branch. The existing schema, JSON, CLI and learning accessories remain available. Live UI and physical capture validation are part of the separate feature. |
| [#789: temperature callback timeout](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/789) | Addresses the same lost-response symptom as #788 in the legacy callback implementation. Our independent native-reader deadline cancels work and reports unavailable instead of substituting a last-known temperature. No upstream code was copied or PR merged. |

Scheduled rediscovery now runs hourly by default and honors both interval zero
and explicit discovery-disable configuration. See [rediscovery](rediscovery.md)
for implementation scope and credit to @arthur-moebios's proposal. Custom UI
work is deferred as described in the [roadmap](roadmap.md#deferred-custom-configuration-ui).
The original crash and pairing reports still
require their own reproduction and live validation.

The remaining five open PRs are dependency updates:
[lodash #773](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/773),
[qs #772](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/772),
[jws #771](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/771),
[glob #770](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/770), and
[js-yaml #769](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/769).
All five package names are absent from the rebuild's current package-lock.json
and installed dependency tree, so these specific bumps do not need porting.
This comparison is not a security audit of the rebuild's other dependencies.

The functional proposals target the legacy JavaScript architecture or add its
UI server. Our implementations are independent adaptations of the desired
behaviors to the TypeScript driver and accessory APIs; no upstream PR was merged.

## Reliability regression evidence

Build and all 192 tests pass locally on Node 24.14.1 with Homebridge 1.6.0,
1.11.4, 2.0.0 and locked 2.5.0. These results include the compatibility version
and engine preflight; CI for this branch has not run.

- Packet tests drop authentication or native sensor replies, expire the complete
  read, verify listener/deadline cleanup and then read successfully again.
- A queued native read expires before the queue resumes and never sends its
  cancelled sensor packet afterward.
- Concurrent temperature/humidity getters share one request per accessory;
  timeout, shutdown and late results cannot supply a stale successful reading.
- Real HAP standalone sensor, Thermostat, HeaterCooler and humidity-controller
  getters return communication failures on expiry and recover on fresh readings.
- Real Homebridge API tests preserve external TV identity across restart, skip
  duplicate TV aliases and keep unrelated bridged accessories registered.
- A MAC-selected switch follows a rediscovered device's new address; a stale-IP
  switch fails independently. Controlled sweeps also cover late devices,
  coalescing, interval validation and shutdown; no original crash is reproduced.

These tests use mocked networking and API events, without a running bridge,
advertiser or physical RM. Use the [validation runbook](validation.md) for those
checks and [version coverage](homebridge-compatibility.md) for exact runtimes.

Remaining migration differences such as light power probes, broader state
persistence and non-switch AC gates are tracked in the [roadmap](roadmap.md).
Optional Eve history remains excluded by user decision.
