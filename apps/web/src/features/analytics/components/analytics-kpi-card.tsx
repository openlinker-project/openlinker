/**
 * Analytics KPI card
 *
 * The richer KPI-card anatomy the #1990 design mockup calls for — headline
 * value + metric caption + delta line, one or more qualifier rows pinned to
 * the card floor, and a click-to-open (ⓘ) definitions popover — on top of
 * the existing `shared/ui/kpi-card.tsx` label/sparkline chrome. Kept
 * feature-local rather than folded into the shared `KpiCard` primitive: the
 * qualifier/delta/infotip anatomy is analytics-specific today, and widening
 * the shared component for a single consumer would be premature —
 * `shared/ui/kpi-card.tsx`'s own docstring already anticipates other pages
 * migrating onto it once a second consumer needs this shape.
 *
 * Every card always renders a delta line, but there is currently no
 * previous-period figure anywhere in `GET /analytics/sales` (#1987) — no
 * comparison range, no stored history — so `delta` is always the same
 * "not available yet" placeholder, never a computed number. Faking a
 * percentage here would be worse than showing nothing.
 *
 * @module features/analytics/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Sparkline, type SparklineTone } from '../../../shared/ui/sparkline';
import { AnalyticsInfotip, type AnalyticsInfotipDefinition } from './analytics-infotip';
import { GapMark } from './gap-mark';

const DELTA_GAP_REASON =
  'Period-over-period needs a comparison range — GET /analytics/sales takes a single from/to and stores no prior-period figure.';

export interface AnalyticsKpiQualifier {
  label: ReactNode;
  value: ReactNode;
}

export interface AnalyticsKpiTrend {
  values: readonly number[];
  tone: SparklineTone;
  ariaLabel: string;
}

interface AnalyticsKpiCardProps {
  label: string;
  infotipLabel: string;
  definitions: AnalyticsInfotipDefinition[];
  infotipAlign?: 'end' | 'start';
  /** Dashed "nothing here yet" treatment — reserved for a card with NO real figure at all. */
  planned?: boolean;
  /** Only the headline value is unavailable; qualifiers below are still real (e.g. Revenue: GMV is real, net sales isn't). */
  headlineUnavailable?: boolean;
  metric: ReactNode;
  value: ReactNode;
  valueSuffix?: ReactNode;
  trend?: AnalyticsKpiTrend;
  qualifiers?: AnalyticsKpiQualifier[];
}

export function AnalyticsKpiCard({
  definitions,
  headlineUnavailable = false,
  infotipAlign = 'start',
  infotipLabel,
  label,
  metric,
  planned = false,
  qualifiers = [],
  trend,
  value,
  valueSuffix,
}: AnalyticsKpiCardProps): ReactElement {
  const classes = [
    'kpi-card',
    planned ? 'kpi-card--planned' : '',
    headlineUnavailable && !planned ? 'kpi-card--planned-half' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="kpi-card__label">
        <span className="kpi-card__label-text">
          {label}
          <AnalyticsInfotip ariaLabel={infotipLabel} definitions={definitions} align={infotipAlign} />
        </span>
        {planned ? (
          <span className="kpi-card__planned-tag">Planned</span>
        ) : trend && trend.values.length >= 2 ? (
          <Sparkline
            values={trend.values}
            tone={trend.tone}
            width={72}
            height={20}
            ariaLabel={trend.ariaLabel}
            className="kpi-card__sparkline"
          />
        ) : null}
      </div>
      <div className="kpi-card__headline">
        <div className="kpi-card__value">
          <span>{value}</span>
          {valueSuffix ? <span className="kpi-card__value-suffix">{valueSuffix}</span> : null}
        </div>
        <div className="kpi-card__metric">{metric}</div>
        <span className="kpi-card__delta">
          <span className="kpi-card__delta-basis">— vs previous period</span>
          <GapMark title={DELTA_GAP_REASON} />
        </span>
      </div>
      {qualifiers.length > 0 ? (
        <div className="kpi-card__qualifiers">
          {qualifiers.map((qualifier, index) => (
            <div className="kpi-card__qualifier" key={index}>
              <span className="kpi-card__qualifier-label">{qualifier.label}</span>
              <span className="kpi-card__qualifier-value">{qualifier.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
