import { PlatformAccessory } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { BaseAccessory } from './base';
import { AirConditionerAccessory } from './airConditioner';
import { SwitchAccessory } from './switch';
import { LearnCodeAccessory } from './learnCode';

import { WindowCoveringAccessory } from './windowCovering';
import { GarageDoorOpenerAccessory } from './garageDoorOpener';
import { LockAccessory } from './lock';
import { LightAccessory } from './light';
import { TelevisionAccessory } from './tv';

import { FanAccessory } from './fan';

export * from './windowCovering';
export * from './garageDoorOpener';
export * from './lock';
export * from './light';
export * from './tv';
export * from './fan';
export * from './base';
export * from './airConditioner';
export * from './switch';
export * from './learnCode';

export function createAccessoryInstance(
  platform: BroadlinkRMPlatform,
  accessory: PlatformAccessory,
): BaseAccessory | null {
  const type = accessory.context.config?.type?.toLowerCase();

  switch (type) {
    case 'air-conditioner':
    case 'airconditioner':
    case 'heater-cooler':
      return new AirConditionerAccessory(platform, accessory);

    case 'window-covering':
      return new WindowCoveringAccessory(platform, accessory);

    case 'garage-door-opener':
      return new GarageDoorOpenerAccessory(platform, accessory);

    case 'lock':
      return new LockAccessory(platform, accessory);

    case 'light':
      return new LightAccessory(platform, accessory);

    case 'tv':
    case 'television':
      return new TelevisionAccessory(platform, accessory);

    case 'fan':
      return new FanAccessory(platform, accessory);

    case 'switch':
    case 'switch-multi':
    case 'switch-repeat':
      return new SwitchAccessory(platform, accessory);

    case 'learn-code':
    case 'learn-ir':
      return new LearnCodeAccessory(platform, accessory);

    default:
      platform.log.warn(`[AccessoryFactory] Unsupported or pending accessory type: "${type}".`);
      return null;
  }
}

