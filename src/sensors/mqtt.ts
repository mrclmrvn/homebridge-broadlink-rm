import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { MqttClient, IClientOptions, IPublishPacket } from 'mqtt';

export type Quantity = 'temperature' | 'humidity' | 'contact' | 'lock' | 'obstruction' | 'battery' | 'jam' | 'power';
type Identifier = Quantity | 'combined' | 'unknown';
interface Topic { identifier: Identifier; topic: string; path?: string }
interface Reading { value?: number; received: number; error?: string }
export type ConnectMQTT = (url: string, options: IClientOptions) => MqttClient;

const quantities: Quantity[] = ['temperature', 'humidity', 'contact', 'lock', 'obstruction', 'battery', 'jam', 'power'];
const aliases: Record<Quantity, string[]> = {
  temperature: ['temperature', 'temp', 'local_temperature'],
  humidity: ['humidity', 'hum', 'relativehumidity', 'relative_humidity'],
  contact: ['contact', 'closed', 'door_closed'],
  lock: ['locked', 'lock'],
  obstruction: ['obstruction', 'obstructed'],
  jam: ['jam', 'jammed'],
  power: ['power', 'watts', 'wattage'],
  battery: ['battery', 'batterylevel', 'battery_level', 'batterypercentage', 'battery_percentage'],
};

export function binaryValue(value: unknown, quantity: Quantity): number | undefined {
  if (typeof value === 'boolean') return Number(value);
  if (value === 0 || value === 1 || value === '0' || value === '1') return Number(value);
  if (typeof value === 'string') {
    const normal = value.trim().toLowerCase();
    if (normal === 'true' || normal === (quantity === 'lock' ? 'locked' : quantity === 'contact' ? 'closed' : quantity === 'jam' ? 'jammed' : 'detected')) return 1;
    if (normal === 'false' || normal === (quantity === 'lock' ? 'unlocked' : quantity === 'contact' ? 'open' : 'clear')) return 0;
  }
  return undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validFilter(filter: string): boolean {
  if (!filter || filter.includes('\0') || Buffer.byteLength(filter) > 65535 || filter.startsWith('$share/')) return false;
  return filter.split('/').every((part, index, parts) =>
    (!part.includes('#') || part === '#' && index === parts.length - 1) && (!part.includes('+') || part === '+'));
}

export function matchesTopic(filter: string, topic: string): boolean {
  if (topic.startsWith('$') && !filter.startsWith('$')) return false;
  const actual = topic.split('/');
  const parts = filter.split('/');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '#') return true;
    if (i >= actual.length || parts[i] !== '+' && parts[i] !== actual[i]) return false;
  }
  return actual.length === parts.length;
}

function field(object: unknown, quantity: Quantity, path?: string): unknown {
  if (path) {
    let current: any = object;
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
      current = current[part];
    }
    return current;
  }
  // Legacy aliases can occur in nested JSON. Bound traversal for untrusted data.
  const pending: unknown[] = [object];
  for (let index = 0; index < pending.length && index < 1000; index++) {
    const current = pending[index];
    if (!current || typeof current !== 'object') continue;
    const entries = Object.entries(current);
    for (const alias of aliases[quantity]) {
      const entry = entries.find(([key]) => key.toLowerCase() === alias);
      if (entry) return entry[1];
    }
    for (const [, value] of entries) if (value && typeof value === 'object' && pending.length < 1000) pending.push(value);
  }
  return undefined;
}

/** One read-only broker connection per sensor source. No appliance MQTT publishes. */
export class MQTTSensor {
  private readonly topics: Topic[];
  private readonly maxAge: number;
  private readonly primary: Quantity;
  private readonly brokerURL: string;
  private readonly username?: string;
  private readonly password?: string;
  private client?: MqttClient;
  private connected = false;
  private disposed = false;
  private generation = 0;
  private expiry?: NodeJS.Timeout;
  private readonly readings = new Map<Quantity, Reading>();
  private readonly listeners = new Set<(quantity?: Quantity) => void>();

  constructor(private readonly config: Record<string, any>, private readonly connect?: ConnectMQTT) {
    let url: URL;
    try { url = new URL(config.mqttURL); } catch { throw new Error('Invalid mqttURL'); }
    if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname) throw new Error('Unsupported MQTT broker URL');
    for (const key of ['mqttUsername', 'mqttPassword']) {
      if (config[key] !== undefined && typeof config[key] !== 'string') throw new Error(`${key} must be a string`);
    }
    try {
      this.username = config.mqttUsername ?? (url.username ? decodeURIComponent(url.username) : undefined);
      this.password = config.mqttPassword ?? (url.password ? decodeURIComponent(url.password) : undefined);
    } catch { throw new Error('Invalid MQTT URL credentials'); }
    url.username = ''; url.password = '';
    this.brokerURL = url.toString();
    const raw = typeof config.mqttTopic === 'string' ? [{ identifier: 'unknown', topic: config.mqttTopic }] : config.mqttTopic;
    if (!Array.isArray(raw) || !raw.length) throw new Error('mqttTopic must be a topic string or a nonempty array');
    this.topics = raw.map(entry => {
      if (!entry || !([...quantities, 'combined', 'unknown']).includes(entry.identifier)
        || typeof entry.topic !== 'string' || !validFilter(entry.topic)) throw new Error('Invalid MQTT topic configuration');
      if (entry.path !== undefined && (typeof entry.path !== 'string' || !entry.path.length
        || !quantities.includes(entry.identifier)
        || entry.path.split('.').some((part: string) => !part || ['__proto__', 'constructor', 'prototype'].includes(part)))) {
        throw new Error('MQTT path requires an explicit measurement identifier and a safe dot-separated field path');
      }
      return { identifier: entry.identifier, topic: entry.topic, path: entry.path };
    });
    const seconds = config.mqttMaxAge ?? 300;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 2147483) throw new Error('Invalid mqttMaxAge seconds');
    this.maxAge = seconds * 1000;
    this.primary = config.type === 'power' ? 'power' : config.type === 'garage-door-opener' ? 'contact' : config.type === 'lock' ? 'lock' : config.type === 'obstruction' ? 'obstruction' : config.type === 'jam' ? 'jam' : ['humiditysensor', 'humidity-sensor', 'humidifier-dehumidifier'].includes(String(config.type).toLowerCase()) ? 'humidity' : 'temperature';
  }

  public onUpdate(listener: (quantity?: Quantity) => void): () => void {
    if (this.disposed) throw new Error('MQTT sensor is closed');
    this.listeners.add(listener);
    this.start();
    return () => this.listeners.delete(listener);
  }

  private notify(quantity?: Quantity): void {
    for (const listener of this.listeners) {
      try { listener(quantity); } catch { /* Isolate consumers from broker event delivery. */ }
    }
  }

  private invalidate = (): void => {
    if (this.disposed) return;
    this.connected = false;
    this.generation++;
    this.readings.clear();
    clearTimeout(this.expiry);
    this.notify();
  };

  private onConnect = (): void => {
    if (this.disposed || !this.client) return;
    this.connected = false;
    const generation = ++this.generation;
    this.readings.clear();
    clearTimeout(this.expiry);
    const filters = [...new Set(this.topics.map(topic => topic.topic))];
    this.client.subscribe(filters, { qos: 0 }, (error, granted) => {
      if (this.disposed || generation !== this.generation) return;
      if (error || !granted || granted.length !== filters.length || granted.some(item => item.qos >= 128)) {
        this.invalidate();
        return;
      }
      this.connected = true;
      this.notify();
    });
  };

  private onMessage = (topic: string, payload: Buffer, packet?: IPublishPacket): void => {
    if (this.disposed || this.primary === 'power' && packet?.retain) return;
    const matched = this.topics.filter(entry => matchesTopic(entry.topic, topic));
    if (!matched.length) return;
    let parsed: unknown;
    const text = payload.length <= 65536 ? payload.toString('utf8').trim() : '';
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    const changed = new Map<Quantity, Reading>();
    for (const entry of matched) {
      const targeted = quantities.includes(entry.identifier as Quantity);
      const wanted: Quantity[] = targeted ? [entry.identifier as Quantity]
        : parsed && typeof parsed === 'object' || entry.identifier === 'combined' || (['contact', 'lock', 'obstruction', 'jam'].includes(this.primary) ? binaryValue(parsed, this.primary) : numeric(parsed)) === undefined ? quantities : [this.primary];
      let found = false;
      for (const quantity of wanted) {
        const raw = entry.path || parsed && typeof parsed === 'object' ? field(parsed, quantity, entry.path)
          : entry.identifier === 'combined' ? undefined : parsed;
        // Combined partial objects leave omitted quantities unchanged.
        if (!targeted && parsed && typeof parsed === 'object' && raw === undefined) continue;
        found = true;
        let value = ['contact', 'lock', 'obstruction', 'jam'].includes(quantity) ? binaryValue(raw, quantity) : numeric(raw);
        if (quantity === 'battery' && value !== undefined && (value < 0 || value > 100)) value = undefined;
        if (quantity === 'power' && value !== undefined && value < 0) value = undefined;
        changed.set(quantity, { value, received: performance.now(), error: value === undefined ? 'Invalid MQTT measurement' : undefined });
      }
      // Status-only combined updates do not refresh or erase earlier measurements.
      if (!found && parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) continue;
      if (!found) {
        for (const quantity of targeted ? wanted : quantities) {
          changed.set(quantity, { received: performance.now(), error: 'No MQTT measurement in payload' });
        }
      }
    }
    for (const [quantity, reading] of changed) this.readings.set(quantity, reading);
    this.scheduleExpiry();
    for (const quantity of changed.keys()) this.notify(quantity);
  };

  private start(): void {
    if (this.client || this.disposed) return;
    // Load MQTT.js only when a configured source is used.
    const connect: ConnectMQTT = this.connect || (require('mqtt') as typeof import('mqtt')).connect;
    this.client = connect(this.brokerURL, {
      clientId: `brm_${randomBytes(8).toString('hex')}`, protocolVersion: 4, clean: true,
      reconnectPeriod: 1000, connectTimeout: 10000, keepalive: 30, resubscribe: false,
      rejectUnauthorized: true, username: this.username, password: this.password,
    });
    this.client.on('connect', this.onConnect);
    this.client.on('message', this.onMessage);
    this.client.on('offline', this.invalidate);
    this.client.on('close', this.invalidate);
    // Never expose broker errors/URLs or payloads, which can contain credentials.
    this.client.on('error', this.invalidate);
  }

  private scheduleExpiry(): void {
    clearTimeout(this.expiry);
    if (!this.maxAge || this.disposed) return;
    const pending = [...this.readings.values()].filter(reading => !reading.error);
    if (!pending.length) return;
    const next = Math.min(...pending.map(reading => reading.received + this.maxAge));
    this.expiry = setTimeout(() => {
      for (const [quantity, reading] of this.readings) {
        if (!reading.error && performance.now() - reading.received >= this.maxAge) {
          reading.error = 'MQTT measurement is stale';
          this.notify(quantity);
        }
      }
      this.scheduleExpiry();
    }, Math.max(1, next - performance.now()));
  }

  public read(quantity: Quantity): number {
    if (this.disposed) throw new Error('MQTT sensor is closed');
    this.start();
    if (!this.connected) throw new Error('MQTT sensor is not connected or subscriptions are unavailable');
    const reading = this.readings.get(quantity);
    if (!reading) throw new Error(`No MQTT ${quantity} measurement received`);
    if (reading.error) throw new Error(reading.error);
    if (this.maxAge && performance.now() - reading.received >= this.maxAge) throw new Error('MQTT measurement is stale');
    return reading.value!;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.expiry);
    this.readings.clear();
    this.listeners.clear();
    const client = this.client;
    if (client) client.end(true, {}, () => {
      client.removeListener('connect', this.onConnect);
      client.removeListener('message', this.onMessage);
      for (const event of ['offline', 'close', 'error'] as const) client.removeListener(event, this.invalidate);
    });
  }
}
