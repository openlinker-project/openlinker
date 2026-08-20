/**
 * Bulk wizard blocker chip descriptors (#1741, vocabulary reworked in #2240)
 *
 * Host-neutral labels + tones for the per-variant blocker chips, shared by the
 * Review step and the Edit modal so the two never drift (#1741 review #11).
 * Extracted into its own module (rather than exported from a component) to keep
 * the Review step <-> Edit modal import graph acyclic.
 *
 * The map stays one descriptor per blocker id, and #2240 keeps it that way. A
 * category failure has a CAUSE (which of four things went wrong) and an EFFECT
 * (no category was resolved). The cause is the blocker id and therefore the
 * chip; the effect is `CATEGORY_EFFECT_CHIP`, rendered only in the editor beside
 * the cause. Emitting the effect as a second blocker id would double the
 * vocabulary, add a chip present in 100% of category failures to a Review row
 * that already carries up to four, and - on a destination that resolves the
 * category server-side at submit - state something false.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { StatusBadgeTone } from '../../../../shared/ui';

export type ChipDescriptor = { tone: StatusBadgeTone; label: string; fixable: boolean };

/** Host-neutral blocker chips - labels + tones verbatim from the design. */
export const NEUTRAL_BLOCKER_CHIPS: Record<string, ChipDescriptor> = {
  'no-variant': { tone: 'neutral', label: 'no variant', fixable: false },
  'no-ean': { tone: 'error', label: 'no barcode', fixable: true },
  'invalid-barcode': { tone: 'error', label: 'invalid barcode', fixable: true },
  'no-match': { tone: 'error', label: 'no catalog match', fixable: true },
  'multi-match': { tone: 'warning', label: 'multiple matches', fixable: true },
  'unknown-category-result': { tone: 'error', label: 'unknown result', fixable: true },
  'no-master-price': { tone: 'error', label: 'no master price', fixable: true },
  'no-master-stock': { tone: 'error', label: 'no master stock', fixable: true },
  'currency-mismatch': { tone: 'warning', label: 'currency mismatch', fixable: true },
  'already-listed': { tone: 'neutral', label: 'already listed', fixable: false },
};

/**
 * The consequence chip that accompanies a category cause in the variant editor.
 * Deliberately NOT a blocker id - see the module header.
 */
export const CATEGORY_EFFECT_CHIP: ChipDescriptor = {
  tone: 'error',
  label: 'category not set',
  fixable: true,
};

export const FALLBACK_CHIP: ChipDescriptor = {
  tone: 'warning',
  label: 'needs attention',
  fixable: true,
};

/**
 * Friendly label for a blocker key, falling back to the generic "needs
 * attention" for platform-specific keys not in the neutral map.
 */
export function blockerLabel(blocker: string): string {
  return (NEUTRAL_BLOCKER_CHIPS[blocker] ?? FALLBACK_CHIP).label;
}

/**
 * Blockers that leave the row without a resolved category. Call sites use this
 * to route the fix CTA at the category (product tier first) and to decide
 * whether the `category not set` consequence applies.
 */
export function isCategoryBlocker(blocker: string): boolean {
  return (
    blocker === 'no-match' ||
    blocker === 'multi-match' ||
    blocker === 'no-ean' ||
    blocker === 'invalid-barcode' ||
    blocker === 'unknown-category-result'
  );
}

/**
 * Blockers that are a per-variant field editable in the variant scope panel
 * itself (so their fix CTA should stay on the variant, not jump to base).
 */
export function isVariantScopeFixable(blocker: string): boolean {
  return blocker === 'no-ean' || blocker === 'invalid-barcode';
}
