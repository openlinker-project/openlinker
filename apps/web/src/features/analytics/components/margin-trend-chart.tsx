/**
 * Margin trend chart
 *
 * Plain SVG bars of gross margin per bucket, each labelled with its margin %.
 * A bucket with no covered revenue has a `null` margin % and renders an
 * absent label, never "0%". The repo has no chart library on /analytics
 * beyond the sparkline, so this stays a small hand-rolled SVG.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import type { MarginTrendPoint } from '../api/margin-analytics.types';
import { formatRatio } from '../lib/margin-copy';

interface MarginTrendChartProps {
  points: readonly MarginTrendPoint[];
  currency: string;
}

const WIDTH = 560;
const BASELINE = 150;
const PLOT_HEIGHT = 120;
const LEFT = 40;

function bucketLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function MarginTrendChart({ points, currency }: MarginTrendChartProps): ReactElement | null {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((point) => point.grossMargin), 0);
  const slot = (WIDTH - LEFT) / points.length;
  const barWidth = Math.min(56, slot * 0.6);
  const summary = points
    .map((point) => `${bucketLabel(point.date)}: ${Math.round(point.grossMargin)} ${currency}`)
    .join(', ');

  return (
    <div className="analytics-margin__trend" data-testid="margin-trend">
      <svg viewBox={`0 0 ${WIDTH} 196`} role="img" aria-label={`Gross margin per bucket. ${summary}`}>
        <line
          className="analytics-margin__grid"
          x1={LEFT}
          x2={WIDTH - 8}
          y1={BASELINE}
          y2={BASELINE}
        />
        {points.map((point, index) => {
          const height = max > 0 ? (Math.max(point.grossMargin, 0) / max) * PLOT_HEIGHT : 0;
          const x = LEFT + index * slot + (slot - barWidth) / 2;
          const y = BASELINE - height;
          return (
            <g key={point.date}>
              <rect
                className="analytics-margin__bar"
                x={x}
                y={y}
                width={barWidth}
                height={height}
                rx={2}
              />
              <text
                className="analytics-margin__bar-value"
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
              >
                {point.marginPct === null ? '—' : formatRatio(point.marginPct)}
              </text>
              <text x={x + barWidth / 2} y={168} textAnchor="middle">
                {bucketLabel(point.date)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
