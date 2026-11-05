import { readFile } from 'node:fs/promises';
import { MQTTSensor, type Quantity } from '../sensors/mqtt';
import type { RMDevice } from '../broadlink';

type Measurement = 'temperature' | 'humidity' | 'battery';

/** Explicit sensor sources; pseudo temperature is an opt-in constant, never a fallback. */
export class SensorSource {
  private readonly mqtt?: MQTTSensor;
  private disposed = false;
  private readonly abort = new AbortController();
  private readonly w1Path?: string;
  public readonly temperatureOnly: boolean;
  constructor(private readonly config: Record<string, any>, private readonly device: () => RMDevice | undefined) {
    const w1 = config.w1DeviceID !== undefined ? config.w1DeviceID : typeof config.w1Device === 'string' ? config.w1Device : undefined;
    if (w1 !== undefined) {
      if (typeof w1 !== 'string' || !/^[0-9a-f]{2}-[0-9a-f]{12}$/i.test(w1)) throw new Error('Invalid w1DeviceID');
      this.w1Path = `/sys/bus/w1/devices/${w1}/w1_slave`;
    } else if (config.w1Device) throw new Error('w1Device requires a w1DeviceID or a device-ID string');
    if (config.pseudoDeviceTemperature !== undefined && (typeof config.pseudoDeviceTemperature !== 'number'
      || !Number.isFinite(config.pseudoDeviceTemperature) || config.pseudoDeviceTemperature < -270
      || config.pseudoDeviceTemperature > 100)) throw new Error('Invalid pseudoDeviceTemperature');
    if (config.mqttURL || config.mqttTopic) this.mqtt = new MQTTSensor(config);
    this.temperatureOnly = !this.mqtt && !config.humidityFilePath && !config.temperatureFilePath
      && (this.w1Path !== undefined || config.pseudoDeviceTemperature !== undefined);
  }

  public onUpdate(listener: (quantity?: Quantity) => void): () => void {
    return this.mqtt?.onUpdate(listener) || (() => {});
  }

  public dispose(): void { this.disposed = true; this.abort.abort(); this.mqtt?.dispose(); }

  public async read(quantity: Measurement): Promise<number> {
    if (this.disposed) throw new Error('Sensor source is closed');
    const path = quantity === 'battery'
      ? this.config.batteryFilePath || this.config.temperatureFilePath || this.config.humidityFilePath
      : this.config[`${quantity}FilePath`] || (quantity === 'humidity' ? this.config.temperatureFilePath : undefined);
    let value: unknown;
    let celsius = true;
    if (quantity === 'temperature' && this.config.pseudoDeviceTemperature !== undefined) {
      value = this.config.pseudoDeviceTemperature;
    } else if (this.mqtt) {
      value = this.mqtt.read(quantity);
      celsius = false;
    } else if (path) {
      const contents = (await readFile(path, { encoding: 'utf8', signal: this.abort.signal })).trim();
      if (!contents) throw new Error(`Empty ${quantity} sensor file`);
      let parsed: any;
      let json = true;
      try { parsed = JSON.parse(contents); } catch { json = false; }
      const explicit = Boolean(this.config[`${quantity}FilePath`]);
      if (json) value = typeof parsed === 'number' ? explicit ? parsed : undefined : parsed?.[quantity];
      else {
        const line = contents.split(/\r?\n/).find(line => line.trim().startsWith(`${quantity}:`));
        const raw = line ? line.slice(line.indexOf(':') + 1).trim() : explicit ? contents : '';
        value = raw ? Number(raw) : undefined;
      }
      celsius = false;
    } else if (quantity === 'temperature' && this.w1Path) {
      const contents = await readFile(this.w1Path, { encoding: 'utf8', signal: this.abort.signal });
      const lines = contents.trim().split(/\r?\n/);
      if (!/\bcrc=[0-9a-f]{2}\s+YES\s*$/i.test(lines[0])) throw new Error('1-wire CRC validation failed');
      const match = lines[1]?.match(/(?:^|\s)t=(-?\d+)\s*$/);
      if (!match) throw new Error('Invalid 1-wire temperature reading');
      value = Number(match[1]) / 1000;
    } else if (quantity === 'battery' || quantity === 'humidity' && this.temperatureOnly) {
      throw new Error(`No ${quantity} source is configured`);
    } else {
      const device = this.device();
      if (!device) throw new Error('No Broadlink sensor device is available');
      const reading = await device.checkSensors();
      value = reading[quantity];
    }
    if (this.disposed) throw new Error('Sensor source is closed');
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`No valid ${quantity} reading`);
    // Native Broadlink temperature is Celsius; configured file/MQTT readings may use F.
    if (quantity === 'temperature' && !celsius && String(this.config.tempSourceUnits || 'c').toLowerCase() === 'f') {
      value = (value - 32) * 5 / 9;
    }
    const adjustment = quantity === 'battery' ? 0 : this.config[`${quantity}Adjustment`] ?? 0;
    if (typeof adjustment !== 'number' || !Number.isFinite(adjustment)) throw new Error(`Invalid ${quantity} adjustment`);
    const adjusted = (value as number) + adjustment;
    if (adjusted < (quantity === 'temperature' ? -270 : 0) || adjusted > 100) {
      throw new Error(`${quantity} reading is outside HomeKit's range`);
    }
    return quantity === 'battery' ? Math.round(adjusted) : adjusted;
  }
}
