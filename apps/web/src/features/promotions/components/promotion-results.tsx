/**
 * PromotionResults (#3935, mockups "Wyniki")
 *
 * What the promotion gave in the last 30 days: the share of the piece limit
 * used (when there is one), how many pieces and orders, and what the gifts cost
 * at purchase prices. The cost keeps its currency and its caveat (pieces without
 * a purchase price), never summing across currencies. Read from the gift report,
 * which is why a failed read says so instead of drawing zeros.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import type { Promotion } from '../api/promotions.types';
import { averageUnitCost, type GiftResultCost, type PromotionResults as Results } from '../lib/promotion-stats';
import { promotionUsage } from '../lib/promotion-view';

const costText = (costs: readonly GiftResultCost[], digits: boolean): string =>
  costs.length === 0
    ? '0'
    : costs
        .map((c) =>
          digits ? formatAmount(c.costNet, c.currency ?? undefined) : formatAmount(Math.round(c.costNet), c.currency ?? undefined),
        )
        .join(' + ');

export interface PromotionResultsProps {
  promotion: Promotion;
  /** `null` while loading. */
  results: Results | null;
  failed: boolean;
  /** Last order time text, e.g. "today". */
  lastOrder?: string | null;
}

export function PromotionResultsBody({ promotion, results, failed }: PromotionResultsProps): ReactElement {
  const copy = useMessages('promotions').results;
  const usage = promotionUsage(promotion);
  if (failed) {
    return (
      <Alert tone="warning" density="compact" data-testid="promotion-results-failed">
        {copy.failed}
      </Alert>
    );
  }
  if (results === null) return <p className="text-muted">…</p>;
  const average = averageUnitCost(results);
  return (
    <>
      {usage.cap !== null && usage.percent !== null ? (
        <div className="pm-meter">
          <div className="pm-meter__row">
            <span>{copy.usage}</span>
            <span className="mono tabular">
              {usage.given} / {usage.cap} {copy.pcs}
            </span>
          </div>
          <span
            className={['pm-bar', usage.full ? 'pm-bar--full' : ''].filter(Boolean).join(' ')}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usage.percent}
            aria-label={copy.usage}
          >
            <i style={{ width: `${usage.percent}%` }} />
          </span>
        </div>
      ) : null}
      <div className="pm-kpis" data-testid="promotion-results">
        <div className="pm-kpi">
          <span className="pm-kpi__l">{copy.given}</span>
          <span className="pm-kpi__n mono tabular" data-testid="promotion-results-given">
            {results.units} <small>{copy.pcs}</small>
          </span>
          <span className="pm-kpi__s">
            {promotion.effectiveCap !== null ? interpolate(copy.givenOf, { cap: String(promotion.effectiveCap) }) : ' '}
          </span>
        </div>
        <div className="pm-kpi">
          <span className="pm-kpi__l">{copy.orders}</span>
          <span className="pm-kpi__n mono tabular" data-testid="promotion-results-orders">
            {results.orders}
          </span>
          <span className="pm-kpi__s">{' '}</span>
        </div>
        <div className="pm-kpi">
          <span className="pm-kpi__l">{copy.cost}</span>
          <span className="pm-kpi__n mono tabular" data-testid="promotion-results-cost">
            {costText(results.costs, false)}
          </span>
          <span className="pm-kpi__s">
            {results.unknownCostUnits > 0
              ? interpolate(copy.costPartial, { n: String(results.unknownCostUnits) })
              : average === null
                ? copy.costBasis
                : interpolate(copy.costAverage, { avg: costText(average, true) })}
          </span>
        </div>
      </div>
    </>
  );
}
