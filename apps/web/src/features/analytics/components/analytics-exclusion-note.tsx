/**
 * Analytics Exclusion Note
 *
 * The `.excl-note` per-row annotation (#2481, epic #2452 Phase 8) shown on
 * a `ChannelSalesTable` row whose own figures are under-counted by an open
 * Data Coverage category (#2474 Phase 7). One instance per affected
 * category on a row — a row belonging to more than one open category
 * (e.g. some of its orders un-stamped AND some un-rated) renders one note
 * per category rather than merging them into a single ambiguous line, so
 * an operator always knows which fix applies.
 *
 * Copy is sourced from `deriveCoverageRowCopy` (Phase 7's single source of
 * category copy) rather than hand-written here — the mockup's own found
 * bug class was a row carrying the *wrong* category's copy, and repeating
 * the string here instead of deriving it would reopen exactly that risk
 * the moment either copy changes.
 *
 * Renders on top of the shared `Chip` primitive (`shared/ui/chip.tsx`)
 * rather than a one-off styled `<button>` — `tone="warning"` already gives
 * the exact pill treatment this note needs
 * (`docs/frontend-ui-style-guide.md` § CSS Implementation Standard: "add
 * or extend shared primitives before introducing page-specific one-off
 * styling"). `Chip`'s `aria-pressed` toggle semantics don't fit a
 * fire-and-navigate action, so it's explicitly cleared here; the `excl-note`
 * class only ADDS the truncation behavior a table cell needs on top of
 * `Chip`'s own tone/spacing/border, never re-declares them.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { Chip } from '../../../shared/ui/chip';
import { deriveCoverageRowCopy } from '../lib/data-coverage-copy.lib';
import type { CoverageCategory } from '../api/analytics-coverage.types';

interface AnalyticsExclusionNoteProps {
  category: CoverageCategory;
  /** This row's own affected-order count for `category` — drives singular/plural copy only. */
  affectedCount: number;
  onOpenCategory: (category: CoverageCategory) => void;
}

export function AnalyticsExclusionNote({
  category,
  affectedCount,
  onOpenCategory,
}: AnalyticsExclusionNoteProps): ReactElement {
  const copy = deriveCoverageRowCopy({ category, status: 'open', affectedCount, sampleOrderIds: [] });

  return (
    <Chip
      tone="warning"
      className="excl-note"
      aria-pressed={undefined}
      onClick={() => onOpenCategory(category)}
    >
      {copy.headline}
    </Chip>
  );
}
