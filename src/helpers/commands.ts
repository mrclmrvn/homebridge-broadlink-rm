export type CommandStep = { code: string | Buffer } | { delay: number };

/** Join independently timed command leaves, without adding gaps between controller stages. */
export function compileCommandPlan(commands: unknown[]): CommandStep[] {
  if (!commands.length) throw new Error('Code sequence must not be empty');
  const steps: CommandStep[] = [];
  for (const command of commands) {
    const compiled = compileCommands(command);
    if (steps.length + compiled.length > 10000) throw new Error('Code sequence is too long');
    steps.push(...compiled);
  }
  return steps;
}

/** Compile the entire sequence before any transmission, with bounded expansion. */
export function compileCommands(value: unknown, arrayInterval = 0.1): CommandStep[] {
  const steps: CommandStep[] = [];
  const seconds = (value: unknown, fallback: number) => {
    const result = value === undefined ? fallback : value;
    if (typeof result !== 'number' || !Number.isFinite(result) || result < 0 || result > 2147483) throw new Error('Invalid command delay');
    return result;
  };
  seconds(arrayInterval, 0.1);
  const append = (step: CommandStep) => {
    if (steps.length >= 10000) throw new Error('Code sequence is too long');
    steps.push(step);
  };
  const visit = (item: any, depth: number) => {
    if (depth > 20) throw new Error('Code sequence is nested too deeply');
    if (typeof item === 'string' && item.trim().length || Buffer.isBuffer(item) && item.length) {
      append({ code: item }); return;
    }
    if (Array.isArray(item)) {
      if (!item.length) throw new Error('Code sequence must not be empty');
      item.forEach((child, index) => {
        visit(child, depth + 1);
        if (index < item.length - 1 && !child?.pause && arrayInterval > 0) append({ delay: arrayInterval });
      });
      return;
    }
    if (!item || typeof item !== 'object' || item.data === undefined) throw new Error('Invalid IR/RF code sequence');
    const count = item.sendCount ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('sendCount must be an integer between 1 and 10000');
    const gap = seconds(item.interval, 0.1);
    const pause = seconds(item.pause, 0);
    for (let i = 0; i < count; i++) {
      visit(item.data, depth + 1);
      if (i < count - 1 && gap > 0) append({ delay: gap });
    }
    if (pause > 0) append({ delay: pause });
  };
  visit(value, 0);
  return steps;
}
