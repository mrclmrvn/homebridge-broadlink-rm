export interface TemperatureCode {
  temperature: number;
  code: unknown;
}

/** Exact mode/generic lookup, followed only by the explicitly selected fallback policy. */
export function selectTemperatureCode(config: Record<string, any>, mode: 'heat' | 'cool' | 'auto', requested: number, currentTarget: number): TemperatureCode | undefined {
  const data = config.data || {};
  const exact = data[`${mode}${requested}`] ?? data[`temperature${requested}`];
  if (exact !== undefined) return { temperature: requested, code: exact };
  if (!config.fallbackToDefaultTemperature) return undefined;

  const legacy = config.fallbackToDefaultTemperature === 'legacy';
  const temperature = legacy
    ? requested >= (config.heatTemperature ?? 22) ? config.defaultHeatTemperature ?? 30 : config.defaultCoolTemperature ?? 16
    : config[mode === 'heat' ? 'defaultHeatTemperature' : mode === 'auto' ? 'defaultAutoTemperature' : 'defaultCoolTemperature'] ?? currentTarget;
  const min = config.minTemperature ?? 16;
  const max = config.maxTemperature ?? 30;
  const step = config.tempStepSize ?? 1;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < min || temperature > max
    || Math.abs((temperature - min) / step - Math.round((temperature - min) / step)) > 0.000001) {
    throw new Error('Fallback temperature is outside the configured range or step');
  }
  // The legacy rule deliberately retries only the generic temperature key.
  const code = legacy ? data[`temperature${temperature}`] : data[`${mode}${temperature}`] ?? data[`temperature${temperature}`];
  if (code === undefined) throw new Error(`No IR/RF fallback code configured for temperature${temperature}`);
  return { temperature, code };
}
