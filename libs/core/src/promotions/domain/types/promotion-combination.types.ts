/**
 * Promotion Combination (#3935, ADR-084)
 *
 * Which other promotions a promotion may stack with. Replaces the old
 * `combinable` boolean.
 *
 * - `all`: stacks with every other promotion.
 * - `none`: stacks with nothing.
 * - `selected`: stacks only with the listed promotion ids.
 *
 * MUTUAL CONSENT is the rule: two promotions stack only when EACH allows the
 * other. `A allows B` is not enough; if B does not allow A, whichever comes
 * later in the list (and only when the earlier one actually applied) is skipped
 * as superseded. `none` allows nothing, so it never stacks with anything.
 *
 * @module libs/core/src/promotions/domain/types
 */
export const PromotionCombinationModeValues = ['all', 'none', 'selected'] as const;
export type PromotionCombinationMode = (typeof PromotionCombinationModeValues)[number];

export type PromotionCombination =
  | { readonly mode: 'all' }
  | { readonly mode: 'none' }
  | { readonly mode: 'selected'; readonly promotionIds: readonly string[] };

export const COMBINES_WITH_ALL: PromotionCombination = { mode: 'all' };

/**
 * Coerces an untrusted (jsonb) value. Anything unrecognised reads as `none`:
 * the fail-closed direction, since a promotion we cannot read must not stack.
 * Selected ids are deduped and sorted so the stored shape is canonical.
 */
export function readPromotionCombination(value: unknown): PromotionCombination {
  if (typeof value !== 'object' || value === null) return { mode: 'none' };
  const v = value as { mode?: unknown; promotionIds?: unknown };
  if (v.mode === 'all') return { mode: 'all' };
  if (v.mode === 'none') return { mode: 'none' };
  if (v.mode === 'selected' && Array.isArray(v.promotionIds)) {
    const ids = v.promotionIds.filter((id): id is string => typeof id === 'string');
    return { mode: 'selected', promotionIds: [...new Set(ids)].sort() };
  }
  return { mode: 'none' };
}

/** Does `owner` allow stacking with the promotion `otherId`? One side of the mutual-consent rule. */
export function combinationAllows(owner: PromotionCombination, otherId: string): boolean {
  switch (owner.mode) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'selected':
      return owner.promotionIds.includes(otherId);
  }
}
