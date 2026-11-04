import { BaseAccessory } from './base';

/** Serializes commands and owns cancellable timers for moving accessories. */
export abstract class TimedAccessory extends BaseAccessory {
  private queue: Promise<void> = Promise.resolve();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly delays = new Map<NodeJS.Timeout, () => void>();
  protected disposed = false;

  protected serialize(action: () => Promise<void>): Promise<void> {
    const result = this.queue.then(async () => {
      if (this.disposed) throw new Error(`[${this.name}] Accessory has shut down`);
      await action();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  protected schedule(key: string, milliseconds: number, action: () => Promise<void>): void {
    this.cancelTimer(key);
    if (this.disposed) return;
    const timer = setTimeout(() => {
      void this.serialize(async () => {
        // A superseded timer may already have entered the command queue.
        if (this.timers.get(key) !== timer) return;
        this.timers.delete(key);
        await action();
      }).catch(error => {
        if (!this.disposed) this.log.error(`[${this.name}] ${key}: ${error.message}`);
      });
    }, milliseconds);
    this.timers.set(key, timer);
  }

  protected cancelTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  protected async delay(seconds: number): Promise<void> {
    if (seconds > 0) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          this.delays.delete(timer);
          resolve();
        }, seconds * 1000);
        this.delays.set(timer, resolve);
      });
    }
    if (this.disposed) throw new Error(`[${this.name}] Accessory has shut down`);
  }

  protected seconds(value: unknown, fallback: number, positive = false): number {
    const seconds = value === undefined ? fallback : value;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)
      || seconds < 0 || (positive && seconds === 0) || seconds * 1000 > 2147483647) {
      throw new Error(`[${this.name}] Duration must be a finite ${positive ? 'positive' : 'nonnegative'} number of seconds within the Node.js timer range`);
    }
    return seconds;
  }

  protected async transmit(key: string): Promise<void> {
    const code = this.config.data?.[key];
    if (!code) throw new Error(`[${this.name}] No IR/RF code configured for "${key}"`);
    await this.sendCode(code);
    if (this.disposed) throw new Error(`[${this.name}] Accessory has shut down`);
  }

  public override dispose(): void {
    this.disposed = true;
    for (const key of this.timers.keys()) this.cancelTimer(key);
    for (const [timer, resolve] of this.delays) {
      clearTimeout(timer);
      resolve();
    }
    this.delays.clear();
  }
}
