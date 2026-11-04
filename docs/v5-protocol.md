# Driver, learning and packaging update

This implementation adds protocol-level regression tests and completes the RF
learning and raw Pronto conversion paths from the handoff. Tests use in-memory UDP
sockets; real device and live Homebridge validation remain outstanding.

## Driver corrections

Commands authenticate within the existing command queue instead of enqueueing a
second authentication operation behind themselves. Authentication reads the
session ID and AES key, retaining the fixed IV. AES payloads use zero padding to
the block boundary rather than PKCS padding, without adding a full block when
already aligned.

Responses are checked for endpoint, minimum size, magic, request sequence and
expected response command. Packet and decrypted payload checksums are validated.
Stale/unrelated datagrams are ignored, while matching malformed responses fail
the request. Socket errors, timeouts, aborts and close release pending requests
and listeners. Authorization errors invalidate the session for the next command;
they are not automatically replayed, to avoid repeating a toggle transmission.

Sensor commands now differ correctly between legacy RM and RM4. Signed native
temperature components are preserved. RM4 response lengths trim zero padding
before learned-code and sensor parsing. Native sensor support still depends on
the actual model/cable.

The protocol behavior was cross-checked with the primary
[python-broadlink device implementation](https://github.com/mjg59/python-broadlink/blob/master/broadlink/device.py)
and [remote implementation](https://github.com/mjg59/python-broadlink/blob/master/broadlink/remote.py).
The code is an independent TypeScript implementation. These references do not
replace testing the supported devices. In particular, the handoff's abbreviated
RF sequence did not include all the commands required by the reference flow.

## RF learning

Use an RF-capable Pro model with its actual device ID:

```bash
node dist/cli.js learn-rf 192.0.2.10 02:00:00:00:00:01 0x520b
```

Replace the documentation-only endpoint before running. Hold the remote button
for frequency detection, then release and press it again when prompted. The
workflow sweeps frequency, polls for a lock, starts packet capture, and polls for
the resulting code. It attempts to cancel the sweep on completion, timeout or
abort. The default RF deadline is 60 seconds with 500 ms polling; individual
network commands can add their packet timeout. Supported frequencies depend on
the physical device and remote; the software does not make a model support both
315 and 433 MHz.

In Homebridge, configure an explicit learning switch:

```json
{ "name": "Learn RF", "type": "learn-rf", "host": "02:00:00:00:00:01" }
```

`learn-code` / `learn-ir` still learn IR. HomeKit writes acknowledge immediately
while learning runs in the background. Off aborts learning, and platform shutdown
aborts it as well. A device rejects overlapping learning operations, ordinary
sends and sensor polling during a learning workflow. Sensor polls may therefore
log a temporary learning-related failure and retry afterward. Run one learning
button at a time for each device.

## Pronto

A quoted raw modulated Pronto code can be converted without hardware:

```bash
node dist/cli.js convert-pronto "0000 006d 0001 0000 0010 0100"
```

`send` and accessory strings also recognize `0000` followed by whitespace and
convert it before transmission. Conversion accepts four-digit words, validates
frequency/burst counts and pulse bounds, and writes the Broadlink pulse length
in little-endian order. It preserves the legacy converter's IR terminator and
command-relative alignment, with corrected multi-byte lengths.

Only raw modulated `0000` is supported; compact/learned hex continues to be treated
as Broadlink data. Unsupported Pronto formats are not implemented. The converter
does not generate RF codes. A converted code still needs verification on the
actual appliance.

## Discovery and static hosts

Discovery now includes timestamp, local endpoint and checksum fields, handles
socket errors, and deduplicates responses. Duplicate device sockets are closed.
When the same MAC is found at a new address/type/port, the manager closes the old
socket and replaces its lookup entry. Stale IP lookup entries are removed.

Static hosts accept `devType` as a hexadecimal string (or an integer in manually
written configuration) and optional UDP `port`. An exact devType takes precedence
over model-selection flags. Without it, isRM4/isRFSupported select representative
Mini/Pro IDs. The old bitwise heuristic that misclassified some legacy IDs as
RM4 has been removed. Device hosts must be IPv4 addresses.

## CLI, package and support range

The CLI returns nonzero status for operational failures and invalid commands.
SIGINT aborts learning; the device socket is closed during CLI cleanup. The
installed command is `broadlink-rm`; `node dist/cli.js` remains supported.

`npm pack` now builds automatically through prepack, and publication runs tests
through prepublishOnly. An explicit file allowlist includes dist, the schema,
v5 sample, documentation, README, changelog and license while excluding legacy
runtime source and test trees. No npm publication has been performed.

The Node engine range is now `^22.12.0 || ^24 || ^26`, matching the development
dependency and CI majors. The declared Homebridge range still needs testing
beyond the current development dependency. Hardware validation, MQTT, ping/ARP,
Eve history and the other compatibility gaps remain on the roadmap.
