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
import type { OfferBlockerField } from '../../../../shared/plugins';
import type { BulkRowBlocker } from './bulk-wizard.types';

export type ChipDescriptor = {
  tone: StatusBadgeTone;
  label: string;
  fixable: boolean;
  /**
   * `true` for a chip that reports a risk we cannot confirm (#2243) - it shows
   * on the row but does NOT make it unready, so it never gates the batch.
   * Absent ⇒ blocking, so a chip that forgets the flag fails safe.
   */
  advisory?: boolean;
  /** Field the edit modal opens focused on when the chip is clicked (#2243). */
  field?: OfferBlockerField;
  /**
   * The chip is a LINK out of the app rather than a dotted-underline button
   * that opens the row editor (#2255). Used where the fix is not in OpenLinker
   * at all - a rate managed on the channel is set in the channel's own panel.
   *
   * Rendered underlined solid, the same carve-out `AlreadyListedChip` makes, so
   * it does not read as the editor affordance it is not.
   */
  link?: boolean;
};

/** Host-neutral blocker chips - labels + tones verbatim from the design. */
export const NEUTRAL_BLOCKER_CHIPS: Record<string, ChipDescriptor> = {
  'no-variant': { tone: 'neutral', label: 'no variant', fixable: false },
  'no-ean': { tone: 'error', label: 'no barcode', fixable: true, field: 'ean' },
  'invalid-barcode': { tone: 'error', label: 'invalid barcode', fixable: true, field: 'ean' },
  'no-match': { tone: 'error', label: 'no catalog match', fixable: true, field: 'category' },
  'multi-match': { tone: 'warning', label: 'multiple matches', fixable: true, field: 'category' },
  'unknown-category-result': {
    tone: 'error',
    label: 'unknown result',
    fixable: true,
    field: 'category',
  },
  'no-master-price': { tone: 'error', label: 'no master price', fixable: true, field: 'price' },
  'no-master-stock': { tone: 'error', label: 'no master stock', fixable: true },
  'currency-mismatch': { tone: 'warning', label: 'currency mismatch', fixable: true },
  'already-listed': { tone: 'neutral', label: 'already listed', fixable: false },
  // The category schema could not be fetched, so no bound could be checked
  // (#2243). Advisory: the marketplace stays the last word on those fields, and
  // refusing to submit over OUR failed request would be the wrong penalty.
  'params-not-checked': {
    tone: 'info',
    label: 'params not checked',
    fixable: false,
    advisory: true,
  },
  // #2255 - SOFT, like every other blocker here: the flagged rows are excluded
  // and the rest publish. A hard block would be a behaviour change to a shipped
  // component for no gain, since the document gate catches a rate-less sale
  // later anyway.
  'no-tax-rate': { tone: 'error', label: 'No tax rate', fixable: true },
  // Not fixable in OpenLinker: the rate lives on the channel, so the chip is a
  // link out rather than an editor affordance.
  'tax-rate-on-channel': {
    tone: 'neutral',
    label: 'rate managed on the channel',
    fixable: false,
    link: true,
  },
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
 * Collapse a row's blockers onto `invalid-barcode` as the single category cause
 * (#2240).
 *
 * A supplied-but-invalid barcode IS the cause, so it replaces the downstream
 * category cause rather than joining it: one cause chip per row keeps the Review
 * table readable, and `no catalog match` beside it would restate what the
 * operator's own typo already explains. `no-match` and `no-ean` are the two
 * outcomes a bad barcode produces upstream, and they are the two this drops.
 *
 * Lives here rather than at either call site because BOTH the Resolve step and
 * `recomputeVariantBlockers` apply it - the same policy expression written twice
 * is what `productCategoryIdOf` was extracted to stop one screen earlier.
 */
export function collapseToInvalidBarcode(blockers: readonly string[]): BulkRowBlocker[] {
  return [...blockers.filter((b) => b !== 'no-match' && b !== 'no-ean'), 'invalid-barcode'];
}

/**
 * The blockers that actually gate a row (#2243) - everything except the advisory
 * ones. One helper, because the same predicate decides the ready count, the
 * submit gate, the "only flagged" filter and the jump-to-next-flagged cursor;
 * four copies of it would drift the moment a fifth surface appears.
 */
export function gatingBlockers(
  blockers: readonly string[],
  chips: Record<string, ChipDescriptor>,
): readonly string[] {
  return blockers.filter((id) => chips[id]?.advisory !== true);
}

/**
 * Blockers that are a per-variant field editable in the variant scope panel
 * itself (so their fix CTA should stay on the variant, not jump to base).
 */
export function isVariantScopeFixable(blocker: string): boolean {
  return blocker === 'no-ean' || blocker === 'invalid-barcode';
}
