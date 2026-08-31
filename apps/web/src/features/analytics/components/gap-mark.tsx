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
 * `onActivate` (#2480, epic #2452 Phase 8) — optional. When the gap is
 * caused by an open Data Coverage category (#2474 Phase 7), the mark
 * becomes a real affordance: a `<button>` that opens that category's own
 * detail modal, rather than an inert tooltip-only `<span>`. Every existing
 * call site that never passes it (Units/Cancellations/Returns cards) keeps
 * rendering the plain, inert span byte-identically — this prop is additive,
 * never a behavior change for a caller that doesn't opt in. `role="img"` is
 * dropped on the clickable branch: a genuinely interactive element takes
 * its accessible name from its own `aria-label`, and `role="img"` on a
 * `<button>` would misdescribe it to assistive tech as a non-interactive
 * image.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';

interface GapMarkProps {
  title: string;
  /** Opens the category's detail modal on click/Enter/Space; omit for the plain inert tooltip mark. */
  onActivate?: () => void;
}

export function GapMark({ title, onActivate }: GapMarkProps): ReactElement {
  if (onActivate) {
    return (
      <button type="button" className="gap-mark gap-mark--clickable" aria-label={title} title={title} onClick={onActivate}>
        &#8224;
      </button>
    );
  }

  return (
    <span className="gap-mark" role="img" aria-label={title} title={title}>
      &#8224;
    </span>
  );
}
