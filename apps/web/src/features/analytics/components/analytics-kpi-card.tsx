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
 * Every card renders a delta line, but not every card can compute one — the
 * caller passes `delta: null` (with `deltaGapReason` explaining why: no
 * comparison range covered by data, a headline that's itself unavailable,
 * a currency mismatch between the two periods) rather than this component
 * ever fabricating a percentage. Period-over-period comparison itself is
 * computed by the caller (`AnalyticsKpiStrip`) from a second
 * `GET /analytics/sales` call over the immediately-preceding period — this
 * component stays presentational and receives an already-formatted string.
 *
 * @module features/analytics/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Sparkline, type SparklineTone } from '../../../shared/ui/sparkline';
import type { DeltaGlyphDirection, TrendTone } from '../lib/sales-analytics-view-model';
import { AnalyticsInfotip, type AnalyticsInfotipDefinition } from './analytics-infotip';
import { GapMark } from './gap-mark';

const DEFAULT_DELTA_GAP_REASON =
  'Period-over-period needs a full previous-period range covered by order history.';

/** aria-hidden — the direction is also stated in `AnalyticsKpiDelta.spokenText` for a screen reader. */
const DELTA_GLYPH: Record<DeltaGlyphDirection, string> = {
  up: '↑',
  down: '↓',
  flat: '→',
};

export interface AnalyticsKpiQualifier {
  label: ReactNode;
  value: ReactNode;
}

export interface AnalyticsKpiTrend {
  values: readonly number[];
  tone: SparklineTone;
  ariaLabel: string;
}

export interface AnalyticsKpiDelta {
  /** Already formatted by the caller (e.g. "8.7%", "0.5 pp") — this component does no number formatting. */
  formatted: string;
  tone: TrendTone;
  /** Arrow glyph direction — independent of `tone` (e.g. a RISING cancellation rate is `up` but `error`-toned). */
  direction: DeltaGlyphDirection;
  /** e.g. "vs previous 7 days". */
  basisLabel: string;
  /** Full sentence for a screen reader — "↑ 8.7%" read aloud loses the direction, so this states it in words. */
  spokenText: string;
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
  /** `undefined`/`null` renders a `GapMark` with `deltaGapReason` instead of a figure. */
  delta?: AnalyticsKpiDelta | null;
  /** Ignored when `delta` is provided. */
  deltaGapReason?: string;
}

export function AnalyticsKpiCard({
  definitions,
  delta,
  deltaGapReason = DEFAULT_DELTA_GAP_REASON,
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
          {delta ? (
            <>
              <span className={`kpi-card__delta-value kpi-card__delta-value--${delta.tone}`}>
                <span className="kpi-card__delta-glyph" aria-hidden="true">
                  {DELTA_GLYPH[delta.direction]}
                </span>{' '}
                <span aria-hidden="true">{delta.formatted}</span>
                <span className="sr-only">{delta.spokenText}</span>
              </span>
              <span className="kpi-card__delta-basis">{delta.basisLabel}</span>
            </>
          ) : (
            <>
              <span className="kpi-card__delta-basis">— vs previous period</span>
              <GapMark title={deltaGapReason} />
            </>
          )}
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
