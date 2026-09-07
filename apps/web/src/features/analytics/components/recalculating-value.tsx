/**
 * Recalculating Value
 *
 * The "a currency recalculation is in flight, don't trust this figure yet"
 * placeholder — renders wherever `AnalyticsKpiStrip`, `ChannelSalesTable`, or
 * `ProductSalesTable` would otherwise show a bare `0.00` for the duration of
 * a currency remediation run. Extracted after three components carried an
 * identical inline `<span>` (tech-review finding, PR #2781) — one copy means
 * the wording can't drift between surfaces.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';

export function RecalculatingValue(): ReactElement {
  return (
    <span
      className="text-muted"
      role="status"
      title="A currency recalculation is running in the background for this range — figures will update once it completes. Safe to navigate away."
    >
      Recalculating…
    </span>
  );
}
