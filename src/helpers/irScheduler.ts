import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

interface Queue {
  tail: Promise<void>;
  last?: { transmitter: string; finishedAt: number };
}

function milliseconds(value: unknown, name: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2147483) {
    throw new Error(name + ' must be a nonnegative number of seconds within the timer range');
  }
  return value * 1000;
}

export function isIRCode(code: string | Buffer): boolean {
  if (Buffer.isBuffer(code)) return code[0] === 0x26;
  return /^26/i.test(code.replace(/\s+/g, '')) || /^0000\s/i.test(code.trim());
}

export class IRScheduler {
  private readonly devices = new Map<string, Queue>();
  private readonly groups = new Map<string, Queue>();
  private readonly commandDelay: number;
  private readonly groupDelay: number;

  constructor(commandDelay: unknown, groupDelay: unknown) {
    this.commandDelay = milliseconds(commandDelay, 'irCommandDelay');
    this.groupDelay = milliseconds(groupDelay, 'irDeviceGroupDelay');
  }

  public async send(transmitter: string, group: string | undefined, signal: AbortSignal, send: () => Promise<void>): Promise<void> {
    signal.throwIfAborted();
    if (!group && !this.commandDelay) {
      await send();
      return;
    }

    const deviceQueue = this.getQueue(this.devices, transmitter);
    const groupQueue = group ? this.getQueue(this.groups, group) : undefined;
    const previous = Promise.all([deviceQueue.tail, groupQueue?.tail]);
    // Reserve both queues together so overlapping groups and devices cannot deadlock.
    const result = previous.then(async () => {
      signal.throwIfAborted();
      const deviceReady = deviceQueue.last ? deviceQueue.last.finishedAt + this.commandDelay : 0;
      const groupLast = groupQueue?.last;
      const groupReady = groupLast && groupLast.transmitter !== transmitter
        ? groupLast.finishedAt + this.groupDelay : 0;
      const readyAt = Math.max(deviceReady, groupReady);
      while (performance.now() < readyAt) {
        await delay(Math.max(1, Math.ceil(readyAt - performance.now())), undefined, { signal });
      }
      signal.throwIfAborted();
      try {
        await send();
      } finally {
        // A lost acknowledgement may still mean the unit transmitted.
        const completion = { transmitter, finishedAt: performance.now() };
        deviceQueue.last = completion;
        if (groupQueue) groupQueue.last = completion;
      }
    });
    deviceQueue.tail = result.catch(() => {});
    if (groupQueue) groupQueue.tail = deviceQueue.tail;
    await result;
  }

  private getQueue(queues: Map<string, Queue>, key: string): Queue {
    let queue = queues.get(key);
    if (!queue) {
      queue = { tail: Promise.resolve() };
      queues.set(key, queue);
    }
    return queue;
  }
}
