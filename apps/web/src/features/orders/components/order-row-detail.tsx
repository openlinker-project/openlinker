/**
 * OrderRowDetail
 *
 * The non-essential order fields moved out of the dense orders-list row into a
 * shared detail view (#1620). On desktop it fills the expandable-row accordion
 * panel; on mobile it fills the card body so a collapsed card still shows every
 * field. Every field is always rendered — missing values show "-" — so the
 * detail reads the same across both layouts and no data is hidden.
 *
 * Pure presentation: all inputs are already-resolved view-model values; no
 * transport logic at this layer.
 *
 * @module features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { parseOrderSnapshot, type ParsedAddress } from '../api/order-snapshot.schema';
import type { OrderRecord } from '../api/orders.types';

interface OrderRowDetailProps {
  order: OrderRecord;
  /** Resolve a source/destination platformType to a human channel label. */
  channelLabel: (platform: string | undefined) => string | undefined;
  platformByConnection: Map<string, string>;
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Paid',
  cod: 'Cash on delivery',
  awaiting: 'Awaiting payment',
  refunded: 'Refunded',
};

/** Placeholder for an absent value — keeps every field slot visible. */
const EMPTY = '-';

function formatAddress(address: ParsedAddress | undefined): ReactNode {
  if (!address) return EMPTY;
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ').trim();
  const lines = [
    name || address.company || null,
    address.address1,
    address.address2 || null,
    [address.postalCode, address.city].filter(Boolean).join(' ').trim() || null,
    address.state || null,
    address.country,
  ].filter((line): line is string => Boolean(line && line.length > 0));
  if (lines.length === 0) return EMPTY;
  return (
    <span className="orders-detail__address">
      {lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="orders-detail__field">
      <dt className="orders-detail__label">{label}</dt>
      <dd className="orders-detail__value">{children}</dd>
    </div>
  );
}

export function OrderRowDetail({
  order,
  channelLabel,
  platformByConnection,
}: OrderRowDetailProps): ReactElement {
  const parsed = parseOrderSnapshot(order.orderSnapshot);
  const itemNames = parsed.items.map((i) => i.name).filter((n): n is string => Boolean(n));
  const carrier = parsed.shipping?.methodName ?? parsed.pickupPoint?.name ?? null;
  const destPlatform = order.syncStatus[0]
    ? platformByConnection.get(order.syncStatus[0].destinationConnectionId)
    : undefined;
  const destLabel = channelLabel(destPlatform);
  const paymentLabel = parsed.paymentStatus ? PAYMENT_LABELS[parsed.paymentStatus] : null;

  return (
    <dl className="orders-detail">
      <Field label="Order reference">
        {parsed.orderNumber ? <span className="mono">{parsed.orderNumber}</span> : EMPTY}
      </Field>
      <Field label="Internal ID">
        <span className="mono">{order.internalOrderId}</span>
      </Field>
      <Field label="Items">
        {parsed.items.length === 0 ? (
          EMPTY
        ) : (
          <span className="orders-detail__items">
            <span>
              {parsed.items.length} {parsed.items.length === 1 ? 'item' : 'items'}
            </span>
            {itemNames.length > 0 ? (
              <span className="text-muted">{itemNames.join(', ')}</span>
            ) : null}
          </span>
        )}
      </Field>
      <Field label="Ship-by">
        {order.dispatchByAt ? <TimeDisplay iso={order.dispatchByAt} format="datetime" /> : EMPTY}
      </Field>
      <Field label="Carrier">{carrier ?? EMPTY}</Field>
      <Field label="Destination">{destLabel ?? EMPTY}</Field>
      <Field label="Created">
        <TimeDisplay iso={order.createdAt} format="datetime" />
      </Field>
      <Field label="Placed">
        {parsed.placedAt ? <TimeDisplay iso={parsed.placedAt} format="datetime" /> : EMPTY}
      </Field>
      <Field label="Payment">{paymentLabel ?? EMPTY}</Field>
      <Field label="Shipping address">{formatAddress(parsed.shippingAddress)}</Field>
      <Field label="Billing address">{formatAddress(parsed.billingAddress)}</Field>
    </dl>
  );
}
