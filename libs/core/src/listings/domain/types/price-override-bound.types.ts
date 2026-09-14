/**
 * How far an operator-typed price may sit from the rule-computed one (#3222).
 *
 * The browser warns at >30% and lets the operator publish anyway. That is the
 * right shape for a warning, and the wrong place for the only bound: the same
 * endpoint is reachable by curl and by MCP, and `39900` for a `399` item
 * publishes a wrong price to a live marketplace on one click. #2610 set the
 * precedent in this exact situation — a value that silently produces a wrong
 * published price is refused SERVER-SIDE as well as in the form, because the
 * raw JSON editor, curl and MCP all bypass the form.
 *
 * The bound is PROPORTIONATE, not absolute. `EditPriceChangeDto` already
 * carries `@Max(1_000_000_000)`, a pathological-input guard sized to the
 * `numeric(14,4)` column and documented there as explicitly not
 * currency-aware; `39900` clears it trivially. A bound that means anything
 * has to compare the typed value against the episode's own computed price,
 * which only exists where the episode is loaded — hence a pure rule called
 * from `PriceChangesService.edit`, not another DTO decorator.
 *
 * It is DELIBERATELY WIDER than the browser's 30% warning. A mirror stricter
 * than the gate refuses work the destination would have accepted (#2240), and
 * the two numbers answer different questions: the form asks "did you mean
 * this?", the server asks "can this possibly be a real price?". The form must
 * never be able to submit something the server then refuses, so the server's
 * band must contain the form's — asserted by a test rather than left to
 * whoever edits one of the two constants next.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * The multiple of the rule-computed price past which an override is refused.
 *
 * 10× (and its reciprocal) is chosen against the failure it exists to catch:
 * a misplaced decimal point or a duplicated digit group, which move a price by
 * at least an order of magnitude. Anything tighter starts refusing legitimate
 * corrections — a genuinely mispriced catalogue item can need a 3× fix — and
 * anything looser stops catching the 1000×-too-high typo this is named for.
 */
export const PRICE_OVERRIDE_MAX_FACTOR = 10;

export const PriceOverrideBoundOutcomeValues = ['ok', 'too-high', 'too-low'] as const;
export type PriceOverrideBoundOutcome = (typeof PriceOverrideBoundOutcomeValues)[number];

/**
 * A discriminated union rather than `{ outcome; limit? }` (#3236 review): that
 * shape made `{ outcome: 'ok', limit: 5 }` and `{ outcome: 'too-high' }` both
 * type-check, and forced a `limit as number` cast at the one call site. The
 * arms are derived from `PriceOverrideBoundOutcome`, the
 * `TerminaliseRoutingDecisionInput` precedent, so a fourth outcome cannot be
 * added without deciding whether it carries a bound.
 */
export type PriceOverrideBoundResult =
  | { outcome: 'ok' }
  | {
      outcome: Exclude<PriceOverrideBoundOutcome, 'ok'>;
      /** The bound the value crossed, in the episode's own currency. */
      limit: number;
    };

/**
 * Pure, side-effect-free (the `applyPricingRule` / `checkRequiredToSell`
 * precedent, `engineering-standards.md § The pure-rule exception`).
 *
 * A non-finite `override` also yields `ok`, because both comparisons are false
 * — worth knowing since this is exported from the `@openlinker/core/listings`
 * barrel. `@IsNumber()` rejects `NaN` on the only route that reaches it today,
 * so the rule does not re-check it; a future caller without that guard must
 * (#3236 review).
 *
 * A non-finite or non-positive `computedAmount` yields `ok`: with no baseline
 * there is nothing to be disproportionate TO, and refusing on a baseline the
 * system failed to produce would block the operator from correcting exactly
 * the episode that needs it. `@IsPositive()` on the DTO still bounds the
 * override itself.
 */
export function checkPriceOverrideBound(
  override: number,
  computedAmount: number | null | undefined
): PriceOverrideBoundResult {
  if (
    computedAmount === null ||
    computedAmount === undefined ||
    !Number.isFinite(computedAmount) ||
    computedAmount <= 0
  ) {
    return { outcome: 'ok' };
  }
  const upper = computedAmount * PRICE_OVERRIDE_MAX_FACTOR;
  if (override > upper) return { outcome: 'too-high', limit: upper };
  const lower = computedAmount / PRICE_OVERRIDE_MAX_FACTOR;
  if (override < lower) return { outcome: 'too-low', limit: lower };
  return { outcome: 'ok' };
}
