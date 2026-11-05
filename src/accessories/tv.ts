import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';

const remoteKeys = [
  'rewind', 'fastForward', 'nextTrack', 'previousTrack', 'arrowUp', 'arrowDown',
  'arrowLeft', 'arrowRight', 'select', 'back', 'exit', 'playPause',
];
const inputTypes = ['other', 'home_screen', 'tuner', 'hdmi', 'composite_video',
  's_video', 'component_video', 'dvi', 'airplay', 'usb', 'application'];

export class TelevisionAccessory extends TimedAccessory {
  private active = 0;
  private input = 0;
  private muted = false;
  private readonly television: Service;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    const C = platform.Characteristic;
    const S = platform.Service;
    this.television = accessory.getService(S.Television)
      || accessory.addService(S.Television, this.name);
    this.television.setPrimaryService();
    this.television.setCharacteristic(C.ConfiguredName, this.name)
      .setCharacteristic(C.SleepDiscoveryMode, C.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    this.television.getCharacteristic(C.Active).onGet(() => this.active)
      .onSet(value => this.serialize(async () => {
        const target = Number(value) ? 1 : 0;
        const required = this.power ? await this.power.requiresSend(Boolean(target)) : target !== this.active;
        if (required) {
          await this.sendTVCode(target ? this.config.data?.on : this.config.data?.off, target ? 'on' : 'off');
          this.power?.recordSent(Boolean(target));
        }
        this.active = target;
        this.television.updateCharacteristic(C.Active, target);
      }));
    const inputs = Array.isArray(this.config.data?.inputs) ? this.config.data.inputs : [];
    this.television.getCharacteristic(C.ActiveIdentifier).onGet(() => this.input)
      .onSet(value => this.serialize(async () => {
        const index = Number(value);
        if (!Number.isInteger(index) || !inputs[index]) throw new Error(`Unknown TV input: ${index}`);
        await this.sendTVCode(inputs[index].data, `inputs[${index}].data`);
        this.input = index;
      }));
    this.television.getCharacteristic(C.RemoteKey).onSet(value => this.serialize(async () => {
      const key = Number(value) === C.RemoteKey.INFORMATION ? 'info' : remoteKeys[Number(value)];
      await this.sendTVCode(key && this.config.data?.remote?.[key], `remote.${key ?? value}`);
    }));
    this.television.getCharacteristic(C.PowerModeSelection).onSet(value => this.serialize(async () => {
      const key = Number(value) === C.PowerModeSelection.SHOW ? 'show' : 'hide';
      await this.sendTVCode(this.config.data?.powerMode?.[key], `powerMode.${key}`);
    }));

    const speaker = accessory.getService(S.TelevisionSpeaker)
      || accessory.addService(S.TelevisionSpeaker, `${this.name} Speaker`, 'speaker');
    speaker.setCharacteristic(C.Active, C.Active.ACTIVE)
      .setCharacteristic(C.VolumeControlType, C.VolumeControlType.RELATIVE);
    speaker.getCharacteristic(C.VolumeSelector).onSet(value => this.serialize(async () => {
      const key = Number(value) === C.VolumeSelector.INCREMENT ? 'up' : 'down';
      await this.sendTVCode(this.config.data?.volume?.[key], `volume.${key}`);
    }));
    speaker.getCharacteristic(C.Mute).onGet(() => this.muted).onSet(value => this.serialize(async () => {
      const target = Boolean(value);
      if (target === this.muted) return;
      await this.sendTVCode(this.config.data?.volume?.mute, 'volume.mute');
      this.muted = target;
    }));
    this.television.addLinkedService(speaker);

    const currentInputs = new Set<Service>();
    inputs.forEach((input: Record<string, any>, index: number) => {
      const subtype = `input${index}`;
      const service = accessory.getServiceById(S.InputSource, subtype)
        || accessory.addService(S.InputSource, input.name || `Input ${index + 1}`, subtype);
      service.setCharacteristic(C.Identifier, index)
        .setCharacteristic(C.ConfiguredName, input.name || `Input ${index + 1}`)
        .setCharacteristic(C.IsConfigured, C.IsConfigured.CONFIGURED)
        .setCharacteristic(C.InputSourceType, Math.max(0, inputTypes.indexOf(String(input.type || '').toLowerCase())));
      this.television.addLinkedService(service);
      currentInputs.add(service);
    });
    for (const service of [...accessory.services]) {
      if (service.UUID === S.InputSource.UUID && !currentInputs.has(service)) {
        this.television.removeLinkedService(service);
        accessory.removeService(service);
      }
    }
    this.watchPower(on => {
      this.active = on ? 1 : 0;
      this.television.updateCharacteristic(C.Active, this.active);
    });
  }

  private async sendTVCode(code: unknown, key: string): Promise<void> {
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.sendCode(code);
  }
}
