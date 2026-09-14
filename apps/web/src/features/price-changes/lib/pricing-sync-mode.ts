/**
 * Pricing Sync Mode helpers (#3151 review fix)
 *
 * `anyConnectionAutomatic` mirrors
 * `docs/plans/mockups/price-changes-review-queue.html`'s
 * `anyConnectionAutomatic()` — "does at least one destination connection (or
 * one of its per-source overrides) publish without asking". Used to gate the
 * auto-applied note's visibility on the config that actually causes
 * auto-apply, rather than on "has anything ever landed in the log" (a proxy
 * that, with no retention sweep on `price_change_auto_applied_log`, never
 * goes back to false once true).
 *
 * A `summary` may be `undefined` while its query is still loading or has
 * failed — treated as "not automatic" rather than throwing, since the note
 * degrades to hidden on an unresolved read rather than guessing.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import type { ConnectionPricingSyncView } from '../api/pricing-sync.types';

export function anyConnectionAutomatic(
  summaries: readonly (ConnectionPricingSyncView | undefined)[],
): boolean {
  return summaries.some((summary) => {
    if (!summary) return false;
    if (summary.default.mode === 'automatic') return true;
    return summary.sources.some((source) => source.effective.mode === 'automatic');
  });
}
