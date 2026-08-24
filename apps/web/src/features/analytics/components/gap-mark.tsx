/**
 * Gap mark
 *
 * Inline dagger (†) that flags a specific figure or caveat as not backed by
 * data yet, with the reason in a native `title` tooltip. Distinct from a
 * whole-card "planned" treatment — a gap mark can sit on a caption or label
 * next to a real, rendered value (e.g. "Avg. daily orders†"), whereas a
 * planned card has no real figure to show at all.
 *
 * `role="img"` + `aria-label={title}` (#2120 review, IMPORTANT): the dagger
 * glyph is the span's entire content, so without an explicit accessible
 * name a screen reader announces "dagger" or nothing useful, and a native
 * `title` on a non-interactive, non-focusable element never surfaces for a
 * keyboard user either. This is not the `.listing-cell__reason` precedent
 * (#2231), where `title` duplicates text already rendered in full
 * elsewhere — here the reason has no other surface, so the mark itself
 * must carry it. `aria-label` alone is proportionate for a footnote marker
 * (not a control); a focus-reachable `Tooltip` upgrade is a fine follow-up
 * if the reason is ever worth showing on keyboard focus too.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';

export function GapMark({ title }: { title: string }): ReactElement {
  return (
    <span className="gap-mark" role="img" aria-label={title} title={title}>
      &#8224;
    </span>
  );
}
