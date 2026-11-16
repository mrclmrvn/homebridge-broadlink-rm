import type { PlatformAccessory, Service } from 'homebridge';
import type { BroadlinkRMPlatform } from '../platform';
import { TimedAccessory } from './timed';
import { createHash } from 'node:crypto';
import { stateBoolean, stateEnum } from '../helpers/state';

const remoteKeys = [
  'rewind', 'fastForward', 'nextTrack', 'previousTrack', 'arrowUp', 'arrowDown',
  'arrowLeft', 'arrowRight', 'select', 'back', 'exit', 'playPause',
];
const pictureModes = ['other', 'standard', 'calibrated', 'calibratedDark', 'vivid', 'game', 'computer', 'custom'];
const inputTypes = ['other', 'home_screen', 'tuner', 'hdmi', 'composite_video',
  's_video', 'component_video', 'dvi', 'airplay', 'usb', 'application'];

export class TelevisionAccessory extends TimedAccessory {
  private active = 0;
  private input = 0;
  private muted = false;
  private pictureMode = 0;
  private pictureModeConfirmed = false;
  private inputSignature = '';
  private readonly television: Service;

  constructor(platform: BroadlinkRMPlatform, accessory: PlatformAccessory) {
    super(platform, accessory);
    this.validatePowerTimers();
    const C = platform.Characteristic;
    const S = platform.Service;
    const inputs = Array.isArray(this.config.data?.inputs) ? this.config.data.inputs : [];
    const picture = this.config.data?.pictureMode;
    const validPictures = pictureModes.flatMap((name, index) => picture?.[index] || picture?.[name] ? [index] : []);
    this.inputSignature = this.signature(inputs[this.input]);
    this.restoreState({ active: stateEnum(0, 1), muted: stateBoolean,
      inputSignature: value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
      input: (value, saved) => typeof value === 'number' && Number.isInteger(value) && Boolean(inputs[value])
        && saved.inputSignature === this.signature(inputs[value]),
      pictureMode: stateEnum(...validPictures),
      pictureModeConfirmed: (value, saved) => value === false || value === true && stateEnum(...validPictures)(saved.pictureMode, saved),
    });
    this.inputSignature = this.signature(inputs[this.input]);
    this.television = accessory.getService(S.Television)
      || accessory.addService(S.Television, this.name);
    this.television.setPrimaryService();
    this.television.setCharacteristic(C.ConfiguredName, this.name)
      .setCharacteristic(C.SleepDiscoveryMode, C.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    this.television.getCharacteristic(C.Active).onGet(() => this.active)
      .onSet(value => this.serialize(async () => {
        await this.setActive(Number(value));
      }));
    this.television.getCharacteristic(C.ActiveIdentifier).onGet(() => this.input)
      .onSet(value => this.serialize(async () => {
        const index = Number(value);
        if (!Number.isInteger(index) || !inputs[index]) throw new Error(`Unknown TV input: ${index}`);
        await this.sendTVCode(inputs[index].data, `inputs[${index}].data`);
        this.input = index;
        this.inputSignature = this.signature(inputs[index]);
      }));
    this.television.getCharacteristic(C.RemoteKey).onSet(value => this.serialize(async () => {
      const key = Number(value) === C.RemoteKey.INFORMATION ? 'info' : remoteKeys[Number(value)];
      await this.sendTVCode(key && this.config.data?.remote?.[key], `remote.${key ?? value}`);
    }));
    this.television.getCharacteristic(C.PowerModeSelection).onSet(value => this.serialize(async () => {
      const key = Number(value) === C.PowerModeSelection.SHOW ? 'show' : 'hide';
      await this.sendTVCode(this.config.data?.powerMode?.[key], `powerMode.${key}`);
    }));

    if (picture !== undefined) {
      if (!picture || typeof picture !== 'object' || Array.isArray(picture)) throw new Error('pictureMode requires a code map');
      const values = pictureModes.flatMap((name, index) => picture[index] || picture[name] ? [index] : []);
      if (!values.length || Object.keys(picture).some(key => !pictureModes.includes(key) && !/^[0-7]$/.test(key))) throw new Error('Invalid pictureMode code map');
      if (!this.pictureModeConfirmed) this.pictureMode = values[0];
      this.television.getCharacteristic(C.PictureMode)
        .setProps({ validValues: pictureModes.map((_, index) => index) }).updateValue(this.pictureMode)
        .setProps({ validValues: values })
        .onGet(() => { if (!this.pictureModeConfirmed) throw new Error('Picture mode has not been selected'); return this.pictureMode; }).onSet(value => this.serialize(async () => {
          const mode = Number(value);
          if (!values.includes(mode)) throw new Error('Unsupported picture mode');
          if (mode === this.pictureMode && this.pictureModeConfirmed) return;
          await this.sendTVCode(picture[mode] ?? picture[pictureModes[mode]], 'pictureMode');
          this.pictureMode = mode;
          this.pictureModeConfirmed = true;
          this.television.updateCharacteristic(C.PictureMode, mode);
        }));
      if (this.pictureModeConfirmed) this.television.updateCharacteristic(C.PictureMode, this.pictureMode);
      else this.television.updateCharacteristic(C.PictureMode, new Error('Picture mode has not been selected'));
    } else if (this.television.testCharacteristic(C.PictureMode)) {
      this.television.removeCharacteristic(this.television.getCharacteristic(C.PictureMode));
    }

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
    this.television.updateCharacteristic(C.Active, this.active);
    this.television.updateCharacteristic(C.ActiveIdentifier, this.input);
    speaker.updateCharacteristic(C.Mute, this.muted);

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
      if (this.active !== Number(on)) this.cancelTimer('power-auto');
      this.active = on ? 1 : 0;
      this.television.updateCharacteristic(C.Active, this.active);
    });
  }

  private signature(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
  }

  private async setActive(target: number): Promise<void> {
    if (![0, 1].includes(target)) throw new Error('Invalid TV power state');
    const required = this.power ? await this.power.requiresSend(Boolean(target)) : target !== this.active;
    if (required) {
      await this.sendTVCode(target ? this.config.data?.on : this.config.data?.off, target ? 'on' : 'off');
      this.power?.recordSent(Boolean(target));
    }
    this.active = target;
    this.television.updateCharacteristic(this.platform.Characteristic.Active, target);
    this.automaticPower(Boolean(target), on => this.setActive(Number(on)));
  }

  private async sendTVCode(code: unknown, key: string): Promise<void> {
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.sendCode(code);
  }
}
