/**
 * FX Rate Rule Types
 *
 * The rule that decides WHICH published day's rate an order is stamped
 * against. Kept as an open-ended `as const` union so a future `same-day`
 * rule is one array entry plus one branch in `resolveRateDate`, with no
 * schema change on `order_records.fxRule`.
 *
 * @module libs/core/src/currency/domain/types
 */

/**
 * Rate rules OpenLinker can stamp against.
 *
 * `prev-business-day` is the only shipped rule: it yields the calendar day
 * before the order was placed, and each provider adapter resolves that
 * candidate onto a day its own source actually published on. See
 * `resolveRateDate` for why the rule is deliberately calendar-neutral.
 */
export const FX_RATE_RULES = ['prev-business-day'] as const;

export type FxRateRule = (typeof FX_RATE_RULES)[number];

/** The rule applied when a caller does not pick one explicitly. */
export const DEFAULT_FX_RATE_RULE: FxRateRule = 'prev-business-day';

/** Runtime narrowing for a value read back out of the database or an env var. */
export function isFxRateRule(value: string): value is FxRateRule {
  return (FX_RATE_RULES as readonly string[]).includes(value);
}
