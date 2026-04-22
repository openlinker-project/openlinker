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
import { Link, type LinkProps } from 'react-router-dom';
import { Sparkline, type SparklineTone } from './sparkline';

/**
 * Small inline SVG icon paired with error/warning tones so operators have
 * a non-colour signal alongside the tint (see ui-components.md a11y rule:
 * "Color is never the only signal"). Neutral/success tones render no icon.
 */
function ToneIcon({ tone }: { tone: KpiCardTone }): ReactNode {
  if (tone === 'warning') {
    return (
      <span className="kpi-card__icon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 1.5 L14.5 13 H1.5 Z" />
          <line x1="8" y1="6" x2="8" y2="9.5" />
          <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  if (tone === 'error') {
    return (
      <span className="kpi-card__icon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.5" />
          <line x1="8" y1="4.5" x2="8" y2="8.5" />
          <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  return null;
}

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
  | (KpiCardBaseProps & { href?: undefined; to?: undefined })
  | (KpiCardBaseProps & { href: string; to?: undefined })
  | (KpiCardBaseProps & { href?: undefined; to: LinkProps['to'] });

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
        <span className="kpi-card__label-text">
          <ToneIcon tone={tone} />
          {label}
        </span>
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

  if ('to' in rest && rest.to !== undefined) {
    return (
      <Link ref={ref as React.Ref<HTMLAnchorElement>} to={rest.to} className={classes}>
        {body}
      </Link>
    );
  }

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
