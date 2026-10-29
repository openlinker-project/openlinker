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
import { formatAmount } from '../../../shared/format/format-amount';
import { useMarginAnalyticsQuery } from '../hooks/use-margin-analytics-query';
import { useMarginPanelVisible } from '../hooks/use-margin-panel-visible';
import { ANALYTICS_MARGIN_ANCHOR_ID } from './margin-panel';
import { formatRatio } from '../lib/margin-copy';
import type { MarginFilters } from '../api/margin-analytics.types';

/** Below this share of net sales with a cost, the banner shows. */
export const MARGIN_COVERAGE_BANNER_THRESHOLD = 0.98;

export function MarginCoverageBanner({ filters }: { filters: MarginFilters }): ReactElement | null {
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
  if (noCost > 0) parts.push(`some variants have no cost price (${formatAmount(noCost, currency)})`);
  if (afterSale > 0) {
    parts.push(
      `some orders came in before their cost was entered (${formatAmount(afterSale, currency)})`
    );
  }
  if (other > 0) {
    parts.push(`other lines cannot take a cost (${formatAmount(other, currency)})`);
  }

  function goToMargin(): void {
    document.getElementById(ANALYTICS_MARGIN_ANCHOR_ID)?.scrollIntoView?.({ block: 'start' });
  }

  return (
    <Alert
      tone="warning"
      data-testid="cost-coverage-banner"
      title={`Margin covers ${formatRatio(coverage)} of net sales in this range`}
      action={
        <>
          <Link
            className="button button--secondary button--sm"
            to="/products/cost-prices"
            data-testid="cost-coverage-banner-open"
          >
            Add cost prices
          </Link>
          <Button
            type="button"
            tone="ghost"
            className="button--sm"
            onClick={goToMargin}
            data-testid="cost-coverage-banner-margin"
          >
            Go to Margin
          </Button>
        </>
      }
    >
      {formatAmount(leftOut, currency)} is left out
      {parts.length > 0 ? `: ${parts.join(' and ')}` : ''}. Margin and margin % are calculated
      only from the covered part.
    </Alert>
  );
}
