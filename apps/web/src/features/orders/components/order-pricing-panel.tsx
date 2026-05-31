/**
 * Order Pricing Panel
 *
 * Pricing & tax breakdown for the order-detail page (#924). Composes the
 * existing line-items + totals panels, then surfaces the source-authoritative
 * tax treatment (`totals.taxTreatment`, already on the snapshot per #895/
 * ADR-014). Wording is treatment-aware: tax-inclusive totals read "gross",
 * tax-exclusive read "net" — never hardcoded.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';
import { OrderLineItemsPanel } from './order-line-items-panel';
import { OrderTotalsPanel } from './order-totals-panel';

interface OrderPricingPanelProps {
  items: ParsedOrderItem[];
  totals?: ParsedOrderTotals;
}

export function OrderPricingPanel({ items, totals }: OrderPricingPanelProps): ReactElement {
  const treatment = totals?.taxTreatment;
  const grossNet = treatment === 'inclusive' ? 'gross' : treatment === 'exclusive' ? 'net' : null;

  return (
    <div className="order-pricing">
      {items.length > 0 ? <OrderLineItemsPanel items={items} totals={totals} /> : null}

      {totals ? (
        <div className="order-pricing__summary">
          <OrderTotalsPanel totals={totals} />
          {grossNet ? (
            <StatusBadge tone="neutral" className="order-pricing__treatment">
              {grossNet} · source-authoritative
            </StatusBadge>
          ) : null}
        </div>
      ) : null}

      {grossNet ? (
        <p className="order-pricing__note">
          OpenLinker pins the <b>buyer-paid ({grossNet}) price</b> onto the destination — it does not use the
          destination&rsquo;s catalog price.
        </p>
      ) : null}
    </div>
  );
}
