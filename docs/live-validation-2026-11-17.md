# Apple Home tile validation — November 17, 2026

User-reported checks on Homebridge 2.5.0/HAP 2.3.0 with an existing cool-only AC.
Both configured ACs had working temperature and humidity readings during diagnosis.
No personal network addresses, pairing identifiers or raw logs are included here.

The original failure was a tile power-on attempt while the AC was Off. Direct
Cool selection reached the plugin, but the failing tile tap produced no plugin
mode log. Scoped HAP tracing established that Apple Home sent mode `1` (Heat),
while the characteristic accepted only `[0, 2]` (Off/Cool). HAP rejected the write
with `INVALID_VALUE_IN_REQUEST` before the plugin setter ran. Adjusting numeric
bounds alone did not fix the issue.

The tested compatibility behavior accepts that value for cool-only ACs and
routes it to Cool. An initial opt-in beta was confirmed working; beta.3 made
the behavior automatic under `coolOnly: true` and removed the temporary
`homeAppTileOn` configuration option.

The user confirmed beta.3 worked after removing the temporary option. The
captured sequence showed Off acknowledged, followed by a tile request of Heat
being routed to Cool at the retained 23 C target and acknowledged by Broadlink.
The user then removed temporary HAP debug logging. This records one AC's live
tile result; a separate result for the other AC is not established by these logs.

The operating modes remain Cool/Off. Heat is also advertised as an accepted
HomeKit alias so the request can reach the plugin; the visible Apple Home picker
may therefore show Heat. The plugin normalizes displayed and saved mode to Cool
and never selects heating-mode codes for that activation. Heat-only operation
retains Heat/Off behavior and is covered automatically, not by a new live check.

## November 25 follow-up

On iPhone, the user reported that both AC tiles opened accessory details on
5.0.2 and 5.0.6, including after re-pairing. Detail-screen writes for Off and
Cool reached Broadlink and the transmitter acknowledged the commands. A
separate trace also captured Heat being routed to Cool, but the log itself
cannot identify which gesture produced that write. The native tap-to-toggle
gesture remains unresolved. The November 17 observation records the original
test conditions.
