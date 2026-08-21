/**
 * Gap mark
 *
 * Inline dagger (†) that flags a specific figure or caveat as not backed by
 * data yet, with the reason in a native `title` tooltip. Distinct from a
 * whole-card "planned" treatment — a gap mark can sit on a caption or label
 * next to a real, rendered value (e.g. "Avg. daily orders†"), whereas a
 * planned card has no real figure to show at all.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';

export function GapMark({ title }: { title: string }): ReactElement {
  return (
    <span className="gap-mark" title={title}>
      &#8224;
    </span>
  );
}
