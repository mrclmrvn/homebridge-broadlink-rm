export type StateValidator = (value: unknown, snapshot: Record<string, unknown>) => boolean;
export type StateFields = Record<string, StateValidator>;
export const stateBoolean: StateValidator = value => typeof value === 'boolean';
export const stateNumber = (min: number, max: number, integer = false): StateValidator => value =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
export const stateEnum = (...values: number[]): StateValidator => value => typeof value === 'number' && values.includes(value);
export function stateKind(type: unknown): string {
  const kind = String(type).toLowerCase();
  return ({ television: 'tv', airconditioner: 'air-conditioner' } as Record<string, string>)[kind] || kind;
}
