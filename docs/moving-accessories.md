# v5 window coverings, garage doors, and locks

Add these objects to the BroadlinkRM platform's `accessories` array. Replace
placeholders with learned codes and set `host` when selecting a specific RM unit.
These accessories use bridged HomeKit services and do not require separate pairing.

## Window covering

```json
{
  "name": "Living Room Blinds",
  "type": "window-covering",
  "totalDurationOpen": 15,
  "totalDurationClose": 14,
  "initialPosition": 0,
  "initialDelay": 0.1,
  "data": {
    "open": "YOUR_OPEN_HEX",
    "close": "YOUR_CLOSE_HEX",
    "stop": "YOUR_STOP_HEX"
  }
}
```

`totalDurationOpen` and `totalDurationClose` are required positive full-travel
durations in seconds. Position is an estimate based on elapsed movement time:
0 means closed and 100 means open. Startup assumes `initialPosition` (default 0);
it does not read or persist the physical position. Align this value with the
covering before using intermediate targets. Getters estimate position during
movement; completion publishes the final position and stopped state.

Intermediate targets require `data.stop`, sent when the calculated travel time
expires. Hold Position also sends stop and freezes the estimate. Retargeting a
moving covering first sends stop, then starts the new movement from the updated
estimate. The stop code is therefore also required to retarget while moving.

At endpoints, optional `data.openCompletely` / `data.closeCompletely` take
precedence over `open` / `close`, but still use the configured travel duration.
`sendStopAt0` and `sendStopAt100` (default false) send a stop code at the respective
endpoint; otherwise the motor is assumed to stop at its mechanical limit.

Duplicate targets are ignored unless `allowResend` is true. Resending an endpoint
at its assumed position performs a full-duration movement for recalibration.
This option also allows a close command at startup when the assumed position is
already 0. `initialDelay` defaults to 0.1 seconds and delays target commands;
Hold Position stops immediately. Shutdown cancels pending delays and travel timers.

A failed move does not commit its target. If a successful stop is followed by a
failed reversal, state remains at the stopped estimate. If an automatic stop
fails, the error is logged and PositionState stays moving; Hold Position can
retry the stop. Position remains an estimate, not sensor feedback.

## Garage door opener

```json
{
  "name": "Garage Door",
  "type": "garage-door-opener",
  "openDuration": 8,
  "closeDuration": 8,
  "data": {
    "open": "YOUR_OPEN_HEX",
    "close": "YOUR_CLOSE_HEX"
  }
}
```

Power commands are named `open` and `close`. HomeKit reports Opening/Closing after
a successful send and Open/Closed after the configured travel time. Each duration
falls back to `openCloseDuration`, then 8 seconds. A reversal cancels the earlier
completion timer and uses the full duration of the new direction.

Startup reports Stopped with a Closed target until a command succeeds; no close
command is sent automatically at startup. Optional `autoCloseDelay` schedules a
real `close` transmission after the door reaches the inferred open state.
It defaults to 0 (disabled). A failed automatic command is logged without
changing the previous target or current state.

Supplying both `data.lock` and `data.unlock` exposes the garage service's optional
lock controls. Lock state begins Unknown and is inferred immediately after a
successful code transmission. These controls do not interlock door movement.

The above behavior applies without endpoint sensors. Optional `closedSensor`,
`openSensor` and `obstructionSensor` accept file/MQTT sources; see
[physical feedback](power-and-feedback.md#file-and-mqtt-binary-feedback).
Configured endpoints confirm completion; a closed-only contact cannot confirm
Open. Configured obstruction feedback blocks closing when obstructed or
unavailable. Without it, ObstructionDetected reports false and does not establish
a clear doorway. Feedback-based auto-close requires an open endpoint sensor.
No automatic stop/reversal on obstruction or jam detection is implemented.

## Lock

```json
{
  "name": "Door Lock",
  "type": "lock",
  "lockDuration": 1,
  "unlockDuration": 1,
  "data": {
    "lock": "YOUR_LOCK_HEX",
    "unlock": "YOUR_UNLOCK_HEX"
  }
}
```

The LockMechanism service uses `data.lock` and `data.unlock`. Current state begins
Unknown; the initial Secured target does not indicate a verified locked state
and sends no code. A successful request sets the target and keeps current state
Unknown until its travel timer completes. Durations fall back to the legacy
`lockUnlockDuration`, then 1 second.

Optional `autoLockDelay` (seconds, default 0/disabled) starts after unlocking
completes and sends a real lock command. A successful new command cancels earlier
transition and automatic timers. Failed transmissions retain the last successful
state and target; automatic failures are logged. Optional `lockSensor` accepts
file/MQTT bolt feedback and requires confirmation rather than assuming completion
from a timer. With feedback, auto-lock starts after a confirmed requested unlock.
See [lock feedback](power-and-feedback.md#garage-and-lock-behavior-with-feedback).
Door contact state cannot establish bolt state; jam detection is not implemented.

## Configuration and validation

All durations must be finite numbers of seconds within the Node.js timer range
(maximum 2147483.647 seconds). Garage and lock travel durations may be 0;
window full-travel durations must be greater than 0. Optional automatic delays
of 0 disable the corresponding automatic action.

Commands are serialized per accessory. Timers that were cancelled or superseded
cannot apply stale state, including timers already waiting behind another send.
Platform shutdown cancels timers and prevents queued commands from sending.
Invalid accessory configuration is logged and skipped without preventing other
accessories from starting. Unsupported accessory types are not newly registered.

Command leaves accept strings, arrays and repetition objects through the
[shared command compiler](power-and-feedback.md#shared-structured-commands).
`npm test` covers transitions, time estimates, feedback confirmation/faults,
obstruction blocking, failed sends, stale timers, startup validation and shutdown.
Physical hardware, live Homebridge validation and full legacy compatibility
remain outstanding.
