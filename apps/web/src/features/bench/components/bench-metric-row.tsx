/**
 * The bench metric row (#3413, mockup-parity epic #3401)
 *
 * Packed-today, its trend against the same elapsed portion of yesterday, and
 * the outstanding backlog across every connection routed to this bench's
 * packing executor. A background fact, not a primary read — absent on
 * loading or error, exactly like `BenchActivityPanel`, so a metrics hiccup
 * never crowds out the worklist a packer actually needs.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { useBenchMetricsQuery } from '../hooks/use-bench-activity-query';
import { benchWorkCopy } from '../lib/bench-work.copy';

export function BenchMetricRow(): ReactElement | null {
  const query = useBenchMetricsQuery();

  if (query.isLoading || query.isError || query.data === undefined) return null;
  const metrics = query.data;

  // The trend is the DIFFERENCE, signed — the mockup shows "+3 vs yesterday",
  // never a bare pair of numbers a packer has to subtract themselves.
  const trend = metrics.packedToday - metrics.packedYesterday;
  const trendText =
    trend === 0
      ? benchWorkCopy.metrics.trendFlat
      : trend > 0
        ? benchWorkCopy.metrics.trendUp(trend)
        : benchWorkCopy.metrics.trendDown(Math.abs(trend));

  return (
    <div className="bench-metric-row" data-testid="bench-metric-row">
      <div className="bench-metric-card">
        <span className="bench-metric-card__label">{benchWorkCopy.metrics.packedTodayLabel}</span>
        <span className="bench-metric-card__value">
          {metrics.packedToday}
          <span className="bench-metric-card__trend">{trendText}</span>
        </span>
      </div>
      <div className="bench-metric-card">
        <span className="bench-metric-card__label">{benchWorkCopy.metrics.toPackLabel}</span>
        <span className="bench-metric-card__value">{metrics.toPackAllBenches}</span>
      </div>
    </div>
  );
}
