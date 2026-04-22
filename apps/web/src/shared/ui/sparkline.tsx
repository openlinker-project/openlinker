/**
 * Sparkline
 *
 * Tiny SVG line chart for KPI cards. No charting library — just a
 * polyline fit to `values` with an optional filled area underneath.
 * Intended for trend indication, not precise data reading. Callers
 * decide what the values mean (count, duration, error rate, etc.).
 *
 * Renders nothing when `values` is empty or has fewer than 2 points —
 * the caller should gate on data availability separately.
 */
import type { ReactElement } from 'react';

export type SparklineTone = 'error' | 'neutral' | 'success' | 'warning';

interface SparklineProps {
  ariaLabel?: string;
  className?: string;
  filled?: boolean;
  height?: number;
  tone?: SparklineTone;
  values: readonly number[];
  width?: number;
}

const TONE_CLASS: Record<SparklineTone, string> = {
  neutral: 'sparkline--neutral',
  success: 'sparkline--success',
  warning: 'sparkline--warning',
  error: 'sparkline--error',
};

export function Sparkline({
  ariaLabel,
  className = '',
  filled = false,
  height = 24,
  tone = 'neutral',
  values,
  width = 80,
}: SparklineProps): ReactElement | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const areaPath = filled
    ? `${linePath} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`
    : null;

  const classes = ['sparkline', TONE_CLASS[tone], className].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      focusable="false"
    >
      {areaPath ? <path d={areaPath} className="sparkline__area" /> : null}
      <path d={linePath} className="sparkline__line" fill="none" />
    </svg>
  );
}
