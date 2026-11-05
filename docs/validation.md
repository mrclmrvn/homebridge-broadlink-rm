# Hardware and release validation

Use this runbook to validate a selected source revision and its packed artifact
in an isolated Homebridge environment. The automated suite and temporary package
install establish software behavior; they do not confirm operation on a physical
RM, appliance, or live HomeKit bridge. This guide records a process, not completed
hardware results.

Copy the [report template](validation-report-template.md) for each tested
combination of device, firmware and Homebridge environment. Use Pass, Fail,
Not run, or Not applicable for every case, with an explanation for Not applicable.
A skipped or unavailable capability is not a pass.

## Identify the exact build and environment

From the checkout being evaluated, capture:

```bash
git rev-parse HEAD
git status --short
node --version
npm --version
npm ls homebridge --depth=0
npm test
npm pack
```

Record any uncommitted modifications. The Homebridge version reported by npm ls
here is the development dependency; separately record the version actually
running on the test host, its Node version, OS/architecture and installation type.
A green workflow run must reference the tested commit, not an earlier revision.

Record the filename returned by npm pack and its SHA-256. For the current package
version, this portable Node command computes the digest:

```bash
node -e 'const fs=require("node:fs");const c=require("node:crypto");console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' ./mrclmrvn-homebridge-broadlink-rm-5.0.0-alpha.1.tgz
```

Preserve that artifact for the test. Packing runs a build automatically. If the
source changes, regenerate the tarball and start a new report or identify which
cases were repeated. For installation, use [setup](setup.md); for replacement
and recovery, use [migration](migration.md). No deployment or npm publication is
performed by this runbook itself.

## Prepare the test environment

Use one test instance to control an appliance at a time. Back up configuration
and cache before migration tests. Record whether the RM is discovered or static,
its reported device ID, model/firmware if available, and whether it has RF and a
sensor cable. A firmware value that cannot be obtained should be marked Unknown,
not guessed from the model. Use redacted labels rather than publishing actual
addresses, MACs, pairing codes or credentials.

Start with discovery and one ordinary switch. Add only the accessory types used
by the installation, supplying actual recorded codes and explicit host selection
when multiple RMs are present. Enable automatic close/relock or timed movement
only for the corresponding supervised test. Configure explicit endpoint/bolt and
obstruction sources if present; otherwise state remains inferred. Jam detection
and automatic obstruction reversal are not provided. Validate sensor polarity,
freshness, missing-source handling and actual mechanical outcomes separately.

## Driver checks

Run the [CLI diagnostics](troubleshooting.md) on the test host/network using the
actual endpoint and device ID. Capture the command, output and physical outcome.

| ID | Procedure | Evidence required |
| --- | --- | --- |
| D01 | Discover the RM, then restart and discover again | Canonical MAC/type match the same physical device |
| D02 | Authenticate with the discovered type | CLI success and no handshake timeout/decrypt error |
| D03 | Send a known, discrete IR command twice | Each intended appliance action is observed; no duplicate/unintended action |
| D04 | Start an unauthenticated process and send directly | Automatic authentication completes without hanging |
| D05 | Learn IR, copy the result, then replay it | Captured hex causes the intended physical action |
| D06 | Learn RF on an RF-capable Pro model, following both prompts | Frequency and packet phases complete; replay works on the intended RF appliance |
| D07 | Cancel learning and send a normal command afterward | Cancellation completes and ordinary operation recovers |
| D08 | Convert and send a known Pronto 0000 code | Conversion succeeds and the physical action matches the source code |
| D09 | Read each supported native sensor | Measurement is plausible against a reference; missing quantities are not treated as zero |
| D10 | Make the RM unreachable, attempt a command, then restore reachability | Failure terminates, subsequent commands recover, and a failed toggle is not replayed automatically |
| D11 | Test a static host with its exact devType | Same successful operation as the discovery-selected model |
| D12 | Keep a stale static address, enable discovery, and restart after the RM moves, where feasible | The discovered address replaces the stale entry and later commands reach the device |

Separate RF results by actual frequency/device capability. A Pro model name does
not establish support for both 315 and 433 MHz. Repeat device-level checks for
each RM family being claimed, rather than treating one RM4 result as validation
for RM2/3 or every RM4 variant.

## Homebridge and accessory checks

| ID | Procedure | Evidence required |
| --- | --- | --- |
| H01 | Start the installed tarball with a minimal config | Correct plugin/version loads; no unexpected characteristic or configuration warnings |
| H02 | Restart with unchanged name/host config | Cached accessory restores without a duplicate identity |
| H03 | Disable/remove one test accessory | Expected stale entry is removed; unrelated accessories remain |
| H04 | Introduce an invalid accessory alongside a valid one | Invalid config is reported without leaking credentials or blocking the valid accessory |
| H05 | Pair an external TV and restart | TV inputs, remote and speaker controls remain usable with the expected identity |
| H06 | Change a test accessory name/host | Identity change matches the migration guide; no preservation of old automations is assumed |
| H07 | Stop Homebridge during a timer or learning operation | Owned work stops, connections close, and no delayed automatic command is observed afterward |
| H08 | Exercise the visual config form and save/reload | String/array switch data and MQTT topic entries survive correctly; secret fields are not unnecessarily exposed |
| H09 | Restore the previous package/config/cache in the isolated environment | Previous accessories and assignments recover as recorded in the backup |

For each configured accessory, record at least one positive command, one missing
or unreachable-device failure, and restart behavior. Add the relevant cases:

| Accessory group | Additional observations |
| --- | --- |
| Switch/outlet | Sequence order, repeat/pause timing, stateless reset, automatic commands; OutletInUse remains an estimate |
| Fan/purifier | Nearest speed, cycle wrap/reset assumptions, defaults/timers, supported mode and direction/swing/control lock; repeated toggles do not reverse accidentally |
| Light | Brightness/white/color presets, power-on delay, exclusives, automatic timers and supported saturation requests |
| Thermostat/HeaterCooler | Correct mode/temperature code, Celsius/configured unit handling, measured temperature versus target, and failed-send state |
| Humidity controller | Humidify/idle/dehumidify selection and no new automatic command on unavailable measurements |
| Window/covering | Calibrated full travel, intermediate stop, reversal, hold, endpoint resend and initial-position assumption |
| Garage/lock | Actual actions, timer estimates without sources, endpoint/bolt confirmation with sources, obstruction blocking, stale/missing feedback, automatic commands and cancellation |
| Sensors | Native/file/MQTT/1-wire readings, explicit pseudo constants, offsets, CRC failures, battery telemetry, missing values and shutdown cleanup |

## 1-wire, pseudo and battery checks

On a Linux test host, confirm the intended w1_device ID and file access from the
actual Homebridge process/container. Record a valid signed reading against a
reference, a CRC failure, missing file and shutdown during a read. Check that
failures never produce a synthetic zero or native fallback. A fixture test alone
does not establish sensor/bus compatibility.

For pseudo temperatures, record the configured Celsius constant separately from
physical measurements. Test zero and offsets, and verify any separate humidity
source independently. For `batteryAlerts`, test file and MQTT percentages at 0,
20, 21 and 100, invalid/missing data, receipt expiry and reconnect. Confirm
battery-only MQTT messages do not refresh climate readings or transmit appliance
commands, low status matches the rounded percentage, charging remains unavailable,
and removing the option removes the dedicated Battery service after restart.

## Power and feedback checks

Test configured power detection with a reachable appliance, genuine no reply,
missing utility, stale ARP entry and shutdown during a probe. Confirm polling
alone sends no IR, matching state suppresses a guarded toggle, and unknown state
blocks it. Observe physical power separately; reachability alone is an estimate.

For configured feedback, exercise each endpoint and bolt, contradictory endpoints,
obstruction, invalid payloads, expiry and disconnect. Confirm a closed-only contact
never establishes Open or Secured, source failure blocks new guarded commands,
and automatic close/relock waits for the required confirmation. Obstruction
updates during travel do not stop or reverse the motor automatically. Repeat
these checks using the actual producer and its signal polarity.

## MQTT checks

Use a test topic or dedicated test sensor so each publication has a known meaning.
Do not publish test measurements to a shared automation topic unintentionally.
Record broker software/version, transport, topic shape and source sample interval,
without recording credentials. See [MQTT setup and semantics](mqtt.md).

| ID | Procedure | Evidence required |
| --- | --- | --- |
| M01 | Receive combined JSON and separate scalar topics | Correct temperature/humidity, including valid zero and nested paths |
| M02 | Set background poll interval to zero, then publish | HomeKit receives pushed updates |
| M03 | Publish an invalid measurement | Affected quantity faults rather than keeping an apparently valid zero or driving a new command |
| M04 | Stop publications past mqttMaxAge | Age expiry becomes visible and does not issue a new humidity-driven command |
| M05 | Disconnect and reconnect the broker | Unavailable readings during disconnect; subscriptions recover and new messages restore readings |
| M06 | Reconnect with retained messages | Behavior matches receipt-age semantics; retained payload age is not represented as measured sampling age |
| M07 | Try denied subscriptions or incorrect credentials | Unavailable readings, no credentials/payloads in integration logs, manual appliance Off still works |
| M08 | Connect using a trusted TLS broker | Valid certificate succeeds; an untrusted certificate is rejected |
| M09 | Stop the accessory/platform | Broker connection and consumer/age timers are released; no late controller action occurs |

Receipt-age freshness is not proof of physical measurement age. Record whether
payloads were retained and whether their original timestamps were known.

## Review results before a release

Summarize failures and cases not run, with links to reports or issues. Record the
scope that actually passed: software checks, temporary package installation,
live Homebridge, hardware models, and broker transports are separate claims.
Recheck the package version, changelog, file inventory and declared compatibility
against that evidence. A successful local check does not publish an alpha or
establish Homebridge verification. Follow [release preparation](development.md#release-work-still-required)
only after the intended validation is complete.
