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
import { formatAmount } from '../../../shared/format/format-amount';
import { useSessionDismissed } from '../../../shared/hooks/use-session-dismissed';
import { useCostCoverageQuery } from '../hooks/use-cost-coverage-query';

const DISMISS_KEY = 'ol.cost-coverage-banner.dismissed';

export function CostCoverageBanner(): ReactElement | null {
  const [dismissed, dismiss] = useSessionDismissed(DISMISS_KEY);
  const query = useCostCoverageQuery({ enabled: !dismissed });
  const data = query.data;
  if (dismissed || !data || data.soldVariantsWithoutCost <= 0) return null;

  const count = data.soldVariantsWithoutCost;
  return (
    <Alert
      tone="warning"
      data-testid="cost-coverage-banner"
      title={`${String(count)} ${count === 1 ? 'variant' : 'variants'} you sold in the last ${String(data.days)} days ${count === 1 ? 'has' : 'have'} no cost price`}
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
            onClick={dismiss}
            data-testid="cost-coverage-banner-dismiss"
          >
            Dismiss for this session
          </Button>
        </>
      }
    >
      They made {formatAmount(data.netSalesWithoutCost, data.currency)} of net sales, which is left
      out of margin. Add costs and orders placed from now on count toward margin. Nothing else
      changes: orders, listings and invoices work the same with or without a cost.
    </Alert>
  );
}
