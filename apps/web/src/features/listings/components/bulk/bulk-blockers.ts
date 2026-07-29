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

export type ChipDescriptor = { tone: StatusBadgeTone; label: string; fixable: boolean };

/** Host-neutral blocker chips - labels + tones verbatim from the design. */
export const NEUTRAL_BLOCKER_CHIPS: Record<string, ChipDescriptor> = {
  'no-variant': { tone: 'neutral', label: 'no variant', fixable: false },
  'no-ean': { tone: 'error', label: 'no EAN', fixable: true },
  'no-match': { tone: 'error', label: 'manual category', fixable: true },
  'multi-match': { tone: 'warning', label: 'choose category', fixable: true },
  'no-master-price': { tone: 'error', label: 'no master price', fixable: true },
  'no-master-stock': { tone: 'error', label: 'no master stock', fixable: true },
  'currency-mismatch': { tone: 'warning', label: 'currency mismatch', fixable: true },
  'already-listed': { tone: 'neutral', label: 'already listed', fixable: false },
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
 * Blockers that are a per-variant field editable in the variant scope panel
 * itself (so their fix CTA should stay on the variant, not jump to base).
 */
export function isVariantScopeFixable(blocker: string): boolean {
  return blocker === 'no-ean';
}
