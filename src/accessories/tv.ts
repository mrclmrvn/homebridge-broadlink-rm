import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { BaseAccessory } from './base';

const remoteKeys = [
  'rewind', 'fastForward', 'nextTrack', 'previousTrack', 'arrowUp', 'arrowDown',
  'arrowLeft', 'arrowRight', 'select', 'back', 'exit', 'playPause',
];
const inputTypes = ['other', 'home_screen', 'tuner', 'hdmi', 'composite_video',
  's_video', 'component_video', 'dvi', 'airplay', 'usb', 'application'];

export class TelevisionAccessory extends BaseAccessory {
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
      .onSet(async value => {
        const target = Number(value) ? 1 : 0;
        if (target === this.active) return;
        await this.transmit(target ? this.config.data?.on : this.config.data?.off, target ? 'on' : 'off');
        this.active = target;
      });
    const inputs = Array.isArray(this.config.data?.inputs) ? this.config.data.inputs : [];
    this.television.getCharacteristic(C.ActiveIdentifier).onGet(() => this.input)
      .onSet(async value => {
        const index = Number(value);
        if (!Number.isInteger(index) || !inputs[index]) throw new Error(`Unknown TV input: ${index}`);
        await this.transmit(inputs[index].data, `inputs[${index}].data`);
        this.input = index;
      });
    this.television.getCharacteristic(C.RemoteKey).onSet(async value => {
      const key = Number(value) === C.RemoteKey.INFORMATION ? 'info' : remoteKeys[Number(value)];
      await this.transmit(key && this.config.data?.remote?.[key], `remote.${key ?? value}`);
    });
    this.television.getCharacteristic(C.PowerModeSelection).onSet(async value => {
      const key = Number(value) === C.PowerModeSelection.SHOW ? 'show' : 'hide';
      await this.transmit(this.config.data?.powerMode?.[key], `powerMode.${key}`);
    });

    const speaker = accessory.getService(S.TelevisionSpeaker)
      || accessory.addService(S.TelevisionSpeaker, `${this.name} Speaker`, 'speaker');
    speaker.setCharacteristic(C.Active, C.Active.ACTIVE)
      .setCharacteristic(C.VolumeControlType, C.VolumeControlType.RELATIVE);
    speaker.getCharacteristic(C.VolumeSelector).onSet(async value => {
      const key = Number(value) === C.VolumeSelector.INCREMENT ? 'up' : 'down';
      await this.transmit(this.config.data?.volume?.[key], `volume.${key}`);
    });
    speaker.getCharacteristic(C.Mute).onGet(() => this.muted).onSet(async value => {
      const target = Boolean(value);
      if (target === this.muted) return;
      await this.transmit(this.config.data?.volume?.mute, 'volume.mute');
      this.muted = target;
    });
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
  }

  private async transmit(code: string | Buffer | undefined, key: string): Promise<void> {
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.sendCode(code);
  }
}
