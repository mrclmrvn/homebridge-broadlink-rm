> Historical v4 documentation, preserved for attribution and migration reference. For the current rebuild, use the [v5 README](../README.md).

# Homebridge Broadlink RM Pro

## Project continuation and credits

After more than seven years maintaining the previous plugin,
[@kiwi-cam](https://github.com/kiwi-cam) stepped back when they could no longer
test it with their own hardware. Their farewell encouraged the community to
continue the project and consider a full rebuild.

This fork carries that work forward with a TypeScript-based v5 rebuild maintained
by [@mrclmrvn](https://github.com/mrclmrvn). It is still in alpha; see the
[current README](../README.md) for supported behavior and remaining limitations.
The sections below describe the legacy plugin.

Thank you to previous maintainers [@kiwi-cam](https://github.com/kiwi-cam) and
[@lprhodes](https://github.com/lprhodes) for building and sustaining the project.
Credit also goes to [@tattn](https://github.com/tattn/homebridge-rm-mini3),
[@PJCzx](https://github.com/PJCzx/homebridge-thermostat), and
[@momodalo](https://github.com/momodalo/broadlinkjs) for the earlier projects
acknowledged by the plugin, and to [@Cloudore](https://github.com/Cloudore),
[@Faisalthe01](https://github.com/Faisalthe01), and the wider community for their
contributions, testing, and bug reports.

## Introduction
Welcome to the Broadlink RM Mini and Broadlink RM Pro plugin for [Homebridge](https://github.com/nfarina/homebridge).

This plugin allows you to control your RM Mini and RM Pro with HomeKit using the Home app and Siri.

## Like this plugin?

If you would like to support the project, please star the repository, report bugs, or contribute improvements.

Thank you!

## Installation

This plugin can be added via the Web interface, or if you perfer the terminal:
   `npm install -g homebridge-broadlink-rm-pro`
For more information, refer to the [documentation](https://broadlink.kiwicam.nz/#installation).

## Documentation

**Documentation can be found [here](https://broadlink.kiwicam.nz).** If you have any trouble after reading through the information please raise an issue and we'll help out as best we can.

If the plugin is unable to discover your device, it's likely you've locked the device with the cloud so it no longer accepts local connections. In this case, follow these steps:
1. Open the [Broadlink app](https://apps.apple.com/us/app/broadlink/id1450257910)
2. From the Home screen, tap on your Broadlink device
3. Tap the ... in the top right
4. Scroll down and toggle "Lock device" to Off
5. Tap OK when prompted "Confirm to unlock the device"

<img src="https://i.imgur.com/DMTUbDo.png" width="40%" height="40%">

This plugin should now be able to discover your device.

## Thanks
Original: Thanks to @tattn (https://github.com/tattn/homebridge-rm-mini3), @PJCzx (https://github.com/PJCzx/homebridge-thermostat), @momodalo (https://github.com/momodalo/broadlinkjs), and @lprhodes (https://github.com/lprhodes/homebridge-broadlink-rm) whose time and effort got this started.

In this fork: Thanks to @kiwi-cam (https://github.com/kiwi-cam), @Cloudore (https://github.com/Cloudore) and @Faisalthe01 (https://github.com/Faisalthe01) for your work!
