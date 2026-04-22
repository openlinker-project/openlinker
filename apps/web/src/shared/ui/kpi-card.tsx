/**
 * KpiCard
 *
 * Severity-aware KPI card with an optional sparkline slot. Wraps the
 * concept's `.kpi` + `.kpi--error` / `.kpi--warning` chrome while keeping
 * the Button / Link composition story for "actionable" KPIs — the outer
 * element is a native `<a>` when `href` is provided, otherwise a `<div>`.
 *
 * Intended to replace `MetricCard` on the Dashboard in Phase 3. The
 * legacy `MetricCard` stays in place for spots that don't need severity
 * tinting or a sparkline.
 */
import { forwardRef, type ReactElement, type ReactNode } from 'react';
import { Sparkline, type SparklineTone } from './sparkline';

export type KpiCardTone = 'error' | 'neutral' | 'success' | 'warning';

interface KpiCardBaseProps {
  className?: string;
  description?: ReactNode;
  label: ReactNode;
  sparkline?: readonly number[];
  sparklineAriaLabel?: string;
  tone?: KpiCardTone;
  value: ReactNode;
  valueSuffix?: ReactNode;
}

type KpiCardProps =
  | (KpiCardBaseProps & { href?: undefined })
  | (KpiCardBaseProps & { href: string });

const TONE_CLASS: Record<KpiCardTone, string> = {
  neutral: '',
  error: 'kpi-card--error',
  warning: 'kpi-card--warning',
  success: 'kpi-card--success',
};

const SPARKLINE_TONE: Record<KpiCardTone, SparklineTone> = {
  neutral: 'neutral',
  error: 'error',
  warning: 'warning',
  success: 'success',
};

export const KpiCard = forwardRef<HTMLElement, KpiCardProps>(function KpiCard(
  {
    className = '',
    description,
    label,
    sparkline,
    sparklineAriaLabel,
    tone = 'neutral',
    value,
    valueSuffix,
    ...rest
  },
  ref,
): ReactElement {
  const classes = ['kpi-card', TONE_CLASS[tone], className].filter(Boolean).join(' ');

  const body = (
    <>
      <div className="kpi-card__label">
        <span className="kpi-card__label-text">{label}</span>
        {sparkline && sparkline.length >= 2 ? (
          <Sparkline
            values={sparkline}
            tone={SPARKLINE_TONE[tone]}
            width={72}
            height={20}
            ariaLabel={sparklineAriaLabel}
            className="kpi-card__sparkline"
          />
        ) : null}
      </div>
      <div className="kpi-card__value">
        <span>{value}</span>
        {valueSuffix ? <span className="kpi-card__value-suffix">{valueSuffix}</span> : null}
      </div>
      {description ? <div className="kpi-card__description">{description}</div> : null}
    </>
  );

  if ('href' in rest && rest.href) {
    return (
      <a ref={ref as React.Ref<HTMLAnchorElement>} href={rest.href} className={classes}>
        {body}
      </a>
    );
  }

  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className={classes}>
      {body}
    </div>
  );
});
