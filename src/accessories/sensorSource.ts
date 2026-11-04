import { readFile } from 'node:fs/promises';
import type { RMDevice } from '../broadlink';

type Quantity = 'temperature' | 'humidity';

/** File or native Broadlink measurements, without invented fallback readings. */
export class SensorSource {
  constructor(private readonly config: Record<string, any>, private readonly device: () => RMDevice | undefined) {
    if (config.mqttURL || config.w1DeviceID || config.w1Device || config.pseudoDeviceTemperature) {
      throw new Error('MQTT, 1-wire and pseudo-device sensor sources are not implemented in v5 yet');
    }
  }

  public async read(quantity: Quantity): Promise<number> {
    const path = this.config[`${quantity}FilePath`] || (quantity === 'humidity' ? this.config.temperatureFilePath : undefined);
    let value: unknown;
    if (path) {
      const contents = (await readFile(path, 'utf8')).trim();
      if (!contents) throw new Error(`Empty ${quantity} sensor file`);
      try {
        const parsed = JSON.parse(contents);
        value = typeof parsed === 'number'
          ? quantity === 'humidity' && !this.config.humidityFilePath ? undefined : parsed
          : parsed?.[quantity];
      } catch {
        const line = contents.split(/\r?\n/).find(line => line.trim().startsWith(`${quantity}:`));
        const raw = line ? line.slice(line.indexOf(':') + 1).trim() : contents;
        value = raw ? Number(raw) : undefined;
        if (quantity === 'humidity' && !this.config.humidityFilePath && !line) value = undefined;
      }
    } else {
      const device = this.device();
      if (!device) throw new Error('No Broadlink sensor device is available');
      const reading = await device.checkSensors();
      value = reading[quantity];
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`No valid ${quantity} reading`);
    // Native Broadlink temperature is always Celsius; file readings may use F.
    if (quantity === 'temperature' && path && String(this.config.tempSourceUnits || 'c').toLowerCase() === 'f') {
      value = (value - 32) * 5 / 9;
    }
    const adjustment = this.config[`${quantity}Adjustment`] ?? 0;
    if (typeof adjustment !== 'number' || !Number.isFinite(adjustment)) throw new Error(`Invalid ${quantity} adjustment`);
    const adjusted = (value as number) + adjustment;
    if (adjusted < (quantity === 'humidity' ? 0 : -270) || adjusted > (quantity === 'humidity' ? 100 : 100)) {
      throw new Error(`${quantity} reading is outside HomeKit's range`);
    }
    return adjusted;
  }
}
