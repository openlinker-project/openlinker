/**
 * Missing-cost reminder on the Products list (#3588, M30 state `products-banner`)
 *
 * Counts variants SOLD in the last 30 days without a cost (G11-F): only those
 * move margin. Warning, never error - orders, listings and invoices work the
 * same with or without a cost. Dismissal is per session.
 *
 * @module features/products/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { useSessionDismissed } from '../../../shared/hooks/use-session-dismissed';
import { useCostCoverageQuery } from '../hooks/use-cost-coverage-query';

const DISMISS_KEY = 'ol.cost-coverage-banner.dismissed';

export function CostCoverageBanner(): ReactElement | null {
  const [dismissed, dismiss] = useSessionDismissed(DISMISS_KEY);
  const query = useCostCoverageQuery({ enabled: !dismissed });
  const copy = useMessages('products').costCoverageBanner;
  const format = useFormat();
  const plural = usePlural();
  const data = query.data;
  if (dismissed || !data || data.soldVariantsWithoutCost <= 0) return null;

  const count = data.soldVariantsWithoutCost;
  return (
    <Alert
      tone="warning"
      data-testid="cost-coverage-banner"
      title={plural(count, copy.title, { days: data.days })}
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
            onClick={dismiss}
            data-testid="cost-coverage-banner-dismiss"
          >
            {copy.dismiss}
          </Button>
        </>
      }
    >
      {interpolate(copy.bodyNetSales, {
        amount: format.money(data.netSalesWithoutCost, data.currency),
      })}{' '}
      {copy.bodyAddCosts} {copy.bodyNothingElse}
    </Alert>
  );
}
