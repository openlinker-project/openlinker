/**
 * Auto-Applied Count Label (#3168 review)
 *
 * `GET /listings/price-changes/auto-applied` (#3145) is deliberately not
 * paginated — it is a plain "most recent N" log read (`DEFAULT_AUTO_APPLIED_LIMIT`
 * in `apps/api/src/listings/http/price-changes.controller.ts`, currently 20).
 * Rendering `items.length` verbatim therefore states a wrong number flatly
 * once more than the limit have actually auto-applied: 40 real auto-applies
 * would render "20 price changes", asserting the capped figure as if it were
 * the true total.
 *
 * `AUTO_APPLIED_ITEM_LIMIT` here MUST match the backend's
 * `DEFAULT_AUTO_APPLIED_LIMIT` — there is no shared-package seam between the
 * two (the frontend cannot import backend code across the process boundary),
 * so this is a deliberate mirror, not a coincidence. When the page comes back
 * exactly at the limit, that is itself evidence there may be more, so the
 * label renders "20+" rather than a capped figure presented as exact — the
 * same convention `docs/frontend-architecture.md`'s paginated-totals
 * discipline uses elsewhere (never assert a total a capped read cannot back).
 *
 * @module apps/web/src/features/price-changes/lib
 */

export const AUTO_APPLIED_ITEM_LIMIT = 20;

export interface AutoAppliedCountLabel {
  /** e.g. "3" or "20+" — never a bare capped number presented as exact. */
  label: string;
  /** Whether "price change" should read plural — true whenever the label is capped. */
  plural: boolean;
}

export function formatAutoAppliedCount(count: number): AutoAppliedCountLabel {
  if (count >= AUTO_APPLIED_ITEM_LIMIT) {
    return { label: `${AUTO_APPLIED_ITEM_LIMIT}+`, plural: true };
  }
  return { label: String(count), plural: count !== 1 };
}
