# Scheduled device rediscovery

When automatic discovery is enabled, the platform scans at startup and then
repeats discovery every 60 minutes. Static hosts seed the initial device list;
they do not suppress the scheduled scans. A device absent during startup can
therefore become available on a later sweep without restarting Homebridge.

```json
{
  "platform": "BroadlinkRM",
  "disableDiscovery": false,
  "rediscoveryInterval": 60
}
```

`rediscoveryInterval` is a nonnegative number of minutes. `0` disables only the
scheduled sweeps; startup discovery still runs. `disableDiscovery: true` disables
startup and scheduled automatic discovery, including when hosts are configured.
The standalone CLI discovery command is an explicit diagnostic action and is
independent of these platform settings.

The next interval begins when the previous sweep finishes. Concurrent discovery
requests share one sweep; broadcasts do not overlap. The interval must fit the
Node.js timer range (at most 2,147,483,647 milliseconds). Invalid intervals produce
a warning and leave scheduled discovery disabled. Shutdown cancels the schedule,
aborts an active discovery socket and prevents late replies from repopulating
the device manager or creating accessories after shutdown.

Devices are indexed by normalized MAC address and current IP. A reply with the
same MAC at a changed address/type/port replaces and closes the old device socket;
a known unusable socket is also replaceable. Healthy duplicate replies are
discarded and their temporary sockets closed. Link-local `169.254.*` replies are
reported with DHCP/network guidance and closed rather than replacing a usable
device. This does not continuously authenticate or probe all known devices.

Prefer MAC selection when an accessory should follow DHCP address changes.
An accessory pinned to the old IP does not follow the move. The manager resolves
the accessory's host on each operation; rediscovery does not re-register the
accessory or change its HomeKit identity. An in-flight command on the replaced
socket may fail; commands are not automatically replayed.

Periodic discovery is not continuous presence monitoring. Recovery waits until a
scheduled sweep sees the device. Immediate failure-triggered sweeps and per-device
health summaries from the original proposal are not implemented. Shorter intervals
reduce the wait but generate more broadcasts. Discovery still depends on local
network routing, interfaces, VLANs and device local-control settings.

Controlled tests cover late devices, moved addresses, unusable sockets,
coalescing, interval validation and shutdown. Physical DHCP changes and network
outages still require live validation. This behavior was informed by
[@arthur-moebios's upstream proposal #786](https://github.com/kiwi-cam/homebridge-broadlink-rm/pull/786)
and implemented independently against the native driver.
