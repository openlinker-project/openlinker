/**
 * Bulk wizard blocker chip descriptors (#1741)
 *
 * Host-neutral labels + tones for the per-variant blocker chips, shared by the
 * Review step and the Edit modal so the two never drift (#1741 review #11).
 * Extracted into its own module (rather than exported from a component) to keep
 * the Review step <-> Edit modal import graph acyclic.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { StatusBadgeTone } from '../../../../shared/ui';
import type { OfferBlockerField } from '../../../../shared/plugins';

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
};

/** Host-neutral blocker chips - labels + tones verbatim from the design. */
export const NEUTRAL_BLOCKER_CHIPS: Record<string, ChipDescriptor> = {
  'no-variant': { tone: 'neutral', label: 'no variant', fixable: false },
  'no-ean': { tone: 'error', label: 'no EAN', fixable: true, field: 'ean' },
  'no-match': { tone: 'error', label: 'manual category', fixable: true, field: 'category' },
  'multi-match': { tone: 'warning', label: 'choose category', fixable: true, field: 'category' },
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
  return blocker === 'no-ean';
}
