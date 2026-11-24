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
import type { ReactElement, ReactNode } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import type { OrderEditsView } from '../api/order-edit.types';
import type { OrderBundleLine } from '../api/orders.types';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';
import { OrderLineItemsPanel } from './order-line-items-panel';
import { OrderTotalsPanel } from './order-totals-panel';

interface OrderPricingPanelProps {
  items: ParsedOrderItem[];
  totals?: ParsedOrderTotals;
  /** Enables the cost-at-order-time columns on the items table (#3588). */
  internalOrderId?: string;
  /** The order beside the channel's record (#3544). Present only on an edited order. */
  edits?: OrderEditsView | null;
  /** Display name of the source connection, for "the buyer paid X on <channel>". */
  channelName?: string | null;
  /** The bundle lines with their frozen components (#3624). */
  bundleLines?: readonly OrderBundleLine[];
  /** The connection issuing the sales document, once there is one (#3940). */
  documentConnectionId?: string | null;
}

/** The API reports the epoch when no operator edit stamped the overlay (a system-added gift only); that is "never edited", not 1 Jan 1970. */
function hasEditInstant(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time > 0;
}

export function OrderPricingPanel({
  items,
  totals,
  internalOrderId,
  edits,
  channelName,
  bundleLines,
  documentConnectionId,
}: OrderPricingPanelProps): ReactElement {
  const copy = useMessages('orders').orderPricing;
  const format = useFormat();
  const bold = (text: string): ReactNode => <b>{text}</b>;
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
        <OrderLineItemsPanel
          items={items}
          totals={totals}
          internalOrderId={internalOrderId}
          channelQuantities={channelQuantities}
          bundleLines={bundleLines}
          documentConnectionId={documentConnectionId}
        />
      ) : null}

      {totals ? (
        <div className="order-pricing__summary">
          <OrderTotalsPanel totals={totals} editedTotals={editedTotals} />
          {grossNet ? (
            <StatusBadge tone="neutral" className="order-pricing__treatment">
              {interpolate(copy.treatmentBadge, { treatment: copy.treatment[grossNet] })}
            </StatusBadge>
          ) : null}
        </div>
      ) : null}

      {edits && editedTotals ? (
        <p className="order-pricing__note" data-testid="order-edit-pricing-note">
          {hasEditInstant(edits.editedAt)
            ? renderRich(copy.editedOn, {
                time: () => <TimeDisplay iso={edits.editedAt} format="datetime" />,
              })
            : null}
          {hasEditInstant(edits.editedAt) ? ' ' : null}
          {renderRich(
            channelName ? copy.buyerPaidOnChannel : copy.buyerPaidOnSalesChannel,
            { b: bold },
            {
              paid: format.money(editedTotals.channelTotal, editedTotals.currency),
              total: format.money(editedTotals.total, editedTotals.currency),
              channel: channelName ?? '',
            },
          )}
        </p>
      ) : grossNet ? (
        <p className="order-pricing__note">
          {renderRich(copy.pinsBuyerPaidPrice, { b: bold }, { treatment: copy.treatment[grossNet] })}
        </p>
      ) : null}
    </div>
  );
}
