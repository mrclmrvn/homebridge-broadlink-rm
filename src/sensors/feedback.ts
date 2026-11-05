import { readFile, stat } from 'node:fs/promises';
import { MQTTSensor, binaryValue, type Quantity } from './mqtt';

/** Binary endpoint/bolt/obstruction feedback from explicit file or MQTT sources. */
export class FeedbackSource {
  private readonly mqtt?: MQTTSensor;
  public readonly interval: number;
  private disposed = false;
  private readonly maxAge: number;

  constructor(private readonly config: Record<string, any>, private readonly quantity: Extract<Quantity, 'contact' | 'lock' | 'obstruction' | 'jam'>) {
    if (!config || typeof config !== 'object' || Boolean(config.mqttURL) === Boolean(config.filePath)) {
      throw new Error('Feedback source requires exactly one of mqttURL or filePath');
    }
    const interval = config.pollInterval ?? 1;
    const maxAge = config.maxAge ?? config.mqttMaxAge ?? 300;
    if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 0 || interval > 2147483
      || typeof maxAge !== 'number' || !Number.isFinite(maxAge) || maxAge < 0 || maxAge > 2147483) throw new Error('Invalid feedback interval or age');
    this.interval = interval * 1000;
    this.maxAge = maxAge * 1000;
    if (config.mqttURL) this.mqtt = new MQTTSensor({ ...config, mqttMaxAge: maxAge,
      type: quantity === 'lock' ? 'lock' : quantity === 'obstruction' ? 'obstruction' : quantity === 'jam' ? 'jam' : 'garage-door-opener' });
    else if (typeof config.filePath !== 'string' || !config.filePath) throw new Error('Invalid feedback filePath');
  }

  public onUpdate(listener: () => void): void { this.mqtt?.onUpdate(listener); }

  public async read(): Promise<boolean> {
    if (this.disposed) throw new Error('Feedback source is closed');
    let value: unknown;
    if (this.mqtt) value = this.mqtt.read(this.quantity);
    else {
      const [text, info] = await Promise.all([readFile(this.config.filePath, 'utf8'), stat(this.config.filePath)]);
      if (this.maxAge && Date.now() - info.mtimeMs >= this.maxAge) throw new Error('Feedback file is stale');
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Empty feedback file');
      try { value = JSON.parse(trimmed); } catch { value = trimmed; }
      if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        value = object[this.quantity] ?? (this.quantity === 'lock' ? object.locked : this.quantity === 'contact' ? object.closed : this.quantity === 'jam' ? object.jammed : object.obstructed);
      }
    }
    if (this.disposed) throw new Error('Feedback source is closed');
    const parsed = binaryValue(value, this.quantity);
    if (parsed === undefined) throw new Error('Invalid binary feedback measurement');
    return parsed === 1;
  }

  public dispose(): void { this.disposed = true; this.mqtt?.dispose(); }
}
