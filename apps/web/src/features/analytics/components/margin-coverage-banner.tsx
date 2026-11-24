/**
 * Margin coverage banner (#3588, M30 state `analytics`)
 *
 * A warning above the Analytics page when less than 98% of the range's net
 * sales is covered by a cost. It reads the same margin query the Margin panel
 * does (identical key), so it costs no extra request. Warning, never error:
 * a missing cost blocks nothing, it only leaves a line out of margin.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useMarginAnalyticsQuery } from '../hooks/use-margin-analytics-query';
import { useMarginPanelVisible } from '../hooks/use-margin-panel-visible';
import { ANALYTICS_MARGIN_ANCHOR_ID } from './margin-panel';
import { formatRatio } from '../lib/margin.lib';
import type { MarginFilters } from '../api/margin-analytics.types';

/** Below this share of net sales with a cost, the banner shows. */
export const MARGIN_COVERAGE_BANNER_THRESHOLD = 0.98;

export function MarginCoverageBanner({ filters }: { filters: MarginFilters }): ReactElement | null {
  const copy = useMessages('analytics').marginCoverageBanner;
  const format = useFormat();
  const visible = useMarginPanelVisible();
  const query = useMarginAnalyticsQuery(filters, 'week');
  const data = query.data;
  if (!visible || !data) return null;

  const { headline, currency } = data;
  const coverage = headline.costCoveragePct;
  if (coverage === null || coverage >= MARGIN_COVERAGE_BANNER_THRESHOLD) return null;

  const amountFor = (reason: string): number =>
    headline.gaps.find((gap) => gap.reason === reason)?.netAmount ?? 0;
  const noCost = amountFor('no-cost');
  const afterSale = amountFor('cost-entered-after-sale');
  const other = headline.gaps
    .filter((gap) => gap.reason === 'no-variant' || gap.reason === 'currency-mismatch')
    .reduce((sum, gap) => sum + gap.netAmount, 0);
  const leftOut = headline.netRevenue - headline.coveredNetRevenue;

  const parts: string[] = [];
  if (noCost > 0) {
    parts.push(interpolate(copy.reasons.noCost, { amount: format.money(noCost, currency) }));
  }
  if (afterSale > 0) {
    parts.push(interpolate(copy.reasons.afterSale, { amount: format.money(afterSale, currency) }));
  }
  if (other > 0) {
    parts.push(interpolate(copy.reasons.other, { amount: format.money(other, currency) }));
  }
  const leftOutAmount = format.money(leftOut, currency);

  function goToMargin(): void {
    document.getElementById(ANALYTICS_MARGIN_ANCHOR_ID)?.scrollIntoView?.({ block: 'start' });
  }

  return (
    <Alert
      tone="warning"
      data-testid="cost-coverage-banner"
      title={interpolate(copy.title, { ratio: formatRatio(coverage) })}
      action={
        <>
          <Link
            className="button button--secondary button--sm"
            to="/products/cost-prices"
            data-testid="cost-coverage-banner-open"
          >
            {copy.addCostPrices}
          </Link>
          <Button
            type="button"
            tone="ghost"
            className="button--sm"
            onClick={goToMargin}
            data-testid="cost-coverage-banner-margin"
          >
            {copy.goToMargin}
          </Button>
        </>
      }
    >
      {parts.length > 0
        ? interpolate(copy.leftOutWithReasons, {
            amount: leftOutAmount,
            reasons: format.list(parts),
          })
        : interpolate(copy.leftOut, { amount: leftOutAmount })}
    </Alert>
  );
}
