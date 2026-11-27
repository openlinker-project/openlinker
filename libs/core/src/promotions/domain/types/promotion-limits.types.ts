/**
 * Promotion Limits (#3935)
 *
 * The caps a promotion carries, in benefit units (gift units today). `unitCap`
 * bounds the whole promotion and pauses it when reached; `customerLimit` bounds
 * what one resolved customer receives across all orders. `null` = no limit.
 *
 * @module libs/core/src/promotions/domain/types
 */
export interface PromotionLimits {
  readonly unitCap: number | null;
  readonly customerLimit: number | null;
}

export function isPromotionLimits(value: unknown): value is PromotionLimits {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const ok = (x: unknown): boolean => x === null || (typeof x === 'number' && Number.isInteger(x) && x > 0);
  return ok(v.unitCap) && ok(v.customerLimit);
}
