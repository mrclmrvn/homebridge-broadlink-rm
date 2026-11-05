# Validation report: FILL_IN_BUILD_AND_DEVICE

Status: Not run. This is a blank template, not evidence of completed validation.
Copy it and replace the placeholders for each tested environment/device. Use the
case IDs from the [validation runbook](validation.md).

## Build and environment

| Field | Recorded value |
| --- | --- |
| Test date/time and timezone | Not recorded |
| Tester | Not recorded |
| Source commit | Not recorded |
| Working tree clean / modifications | Not recorded |
| Package name/version | Not recorded |
| Tarball filename and SHA-256 | Not recorded |
| Test host OS/architecture | Not recorded |
| Test host Node/npm | Not recorded |
| Running Homebridge version | Not recorded |
| Homebridge installation type | Not recorded |
| Development dependency version, if relevant | Not recorded |
| Automated test result / CI commit and run link | Not recorded |

## Device and source details

| Field | Recorded value |
| --- | --- |
| RM model and discovered type ID | Not recorded |
| Firmware, or Unknown | Not recorded |
| Discovery/static configuration | Not recorded |
| RF capability and tested frequency | Not recorded |
| Sensor cable/native quantities available | Not recorded |
| Appliance type and redacted configuration | Not recorded |
| MQTT broker/version and transport | Not recorded |
| Topic shape / field paths / sample interval | Not recorded |
| mqttMaxAge and retained-message use | Not recorded |
| Reference measurement method | Not recorded |

Keep actual addresses, MACs, pairing codes and credentials out of shared reports.
Attach only the minimal redacted config/logs needed to reproduce a result.

## Results

Use Pass, Fail, Not run, or Not applicable. Add one row per applicable D/H/M case,
and per accessory-specific action. A group status alone is not sufficient.

| Case ID / action | Preconditions and steps | Expected result | Observed software result | Observed physical result | Status | Redacted evidence / issue |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Not recorded | Same physical RM discovered consistently | Not recorded | Not recorded | Not run | Not recorded |
| H01 | Not recorded | Correct installed build starts | Not recorded | Not applicable | Not run | Not recorded |
| M01 | Not recorded | Known measurement is consumed correctly | Not recorded | Not recorded | Not run | Not recorded |
| Add remaining cases | Not recorded | Not recorded | Not recorded | Not recorded | Not run | Not recorded |

## Migration and recovery

- Previous package/version and backup reference: Not recorded.
- Startup/cache identity observations: Not recorded.
- External TV pairing observations: Not recorded.
- Shutdown/cancellation observations: Not recorded.
- Rollback procedure and actual result: Not recorded.

## Review

- Checks completed and exact scope: Not recorded.
- Failures and issue links: Not recorded.
- Not-run / not-applicable cases and reasons: Not recorded.
- Known limitations observed: Not recorded.
- Cases to repeat after changes: Not recorded.
- Release recommendation and supporting evidence: Not recorded.

Do not turn a software-only pass into a claim of hardware, firmware, live TLS or
HomeKit compatibility. Preserve the report's tested commit/artifact identity.
