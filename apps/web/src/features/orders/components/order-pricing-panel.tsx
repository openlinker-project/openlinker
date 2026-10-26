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
import { TimeDisplay } from '../../../shared/ui/time-display';
import { formatAmount } from '../../../shared/format/format-amount';
import type { OrderEditsView } from '../api/order-edit.types';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';
import { OrderLineItemsPanel } from './order-line-items-panel';
import { OrderTotalsPanel } from './order-totals-panel';

interface OrderPricingPanelProps {
  items: ParsedOrderItem[];
  totals?: ParsedOrderTotals;
  /** The order beside the channel's record (#3544). Present only on an edited order. */
  edits?: OrderEditsView | null;
  /** Display name of the source connection, for "the buyer paid X on <channel>". */
  channelName?: string | null;
}

export function OrderPricingPanel({
  items,
  totals,
  edits,
  channelName,
}: OrderPricingPanelProps): ReactElement {
  const channelQuantities =
    edits && edits.lines.length > 0
      ? new Map(edits.lines.map((line) => [line.orderLineId, line.channelQuantity] as const))
      : undefined;
  const editedTotals = edits?.totals ?? null;
  const treatment = totals?.taxTreatment;
  const grossNet = treatment === 'inclusive' ? 'gross' : treatment === 'exclusive' ? 'net' : null;

  return (
    <div className="order-pricing">
      {items.length > 0 ? (
        <OrderLineItemsPanel items={items} totals={totals} channelQuantities={channelQuantities} />
      ) : null}

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

      {edits && editedTotals ? (
        <p className="order-pricing__note" data-testid="order-edit-pricing-note">
          Edited in OpenLinker on <TimeDisplay iso={edits.editedAt} format="datetime" />. The buyer paid{' '}
          <b>{formatAmount(editedTotals.channelTotal, editedTotals.currency)}</b> on{' '}
          {channelName ?? 'the sales channel'}; the label, invoice and pack bench use the edited order (
          <b>{formatAmount(editedTotals.total, editedTotals.currency)}</b>).
        </p>
      ) : grossNet ? (
        <p className="order-pricing__note">
          OpenLinker pins the <b>buyer-paid ({grossNet}) price</b> onto the destination — it does not use the
          destination&rsquo;s catalog price.
        </p>
      ) : null}
    </div>
  );
}
