/**
 * Order Detail Header
 *
 * Operator-cockpit header for the order-detail page (#924): title + derived
 * health badge + lifecycle badge, an internal-id copy chip, the role-labelled
 * source → destination route, received timestamp (absolute + relative), and a
 * one-line order-contents summary with a clickable product link. All values
 * come from data already on the `OrderRecord` / parsed snapshot — no new
 * backend fields.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { ConnectionEntityLabel } from '../../connections';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { formatAmount } from '../../../shared/format/format-amount';
import type { OrderRecord } from '../api/orders.types';
import type { ParsedOrderSnapshot, PaymentStatus } from '../api/order-snapshot.schema';
import { deriveHealthLevel, healthLabel, rollupSyncStatus, totalUnits, type OrderHealthLevel } from '../lib/order-health';

interface OrderDetailHeaderProps {
  order: OrderRecord;
  snapshot: ParsedOrderSnapshot;
}

const HEALTH_TONE: Record<OrderHealthLevel, StatusBadgeTone> = {
  attention: 'error',
  pending: 'warning',
  healthy: 'success',
  unknown: 'neutral',
};

/** Payment-status chip tone + label (#928). Colour is reinforcement, not the only signal. */
const PAYMENT_TONE: Record<PaymentStatus, StatusBadgeTone> = {
  paid: 'success',
  cod: 'info',
  awaiting: 'warning',
  refunded: 'neutral',
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  cod: 'Cash on delivery',
  awaiting: 'Awaiting payment',
  refunded: 'Refunded',
};

export function OrderDetailHeader({ order, snapshot }: OrderDetailHeaderProps): ReactElement {
  const rollup = rollupSyncStatus(order.syncStatus);
  const healthLevel = deriveHealthLevel(rollup);

  const title = snapshot.orderNumber ? `Order ${snapshot.orderNumber}` : `Order ${order.internalOrderId}`;

  const firstItem = snapshot.items[0];
  const itemCount = snapshot.items.length;
  const unitCount = totalUnits(snapshot.items);
  const productName = firstItem?.name ?? firstItem?.sku ?? firstItem?.productId ?? null;

  return (
    <header className="order-header">
      <div className="order-header__top">
        <h1 className="order-header__title">{title}</h1>
        <StatusBadge tone={HEALTH_TONE[healthLevel]} withDot pulse={healthLevel === 'pending'}>
          {healthLabel(healthLevel)}
        </StatusBadge>
        {snapshot.status ? (
          <StatusBadge tone="neutral" withDot>
            {snapshot.status}
          </StatusBadge>
        ) : null}
        {snapshot.paymentStatus ? (
          <StatusBadge tone={PAYMENT_TONE[snapshot.paymentStatus]} withDot>
            {PAYMENT_LABEL[snapshot.paymentStatus]}
          </StatusBadge>
        ) : null}
      </div>

      <div className="order-header__sub">
        <CopyableId id={order.internalOrderId} />

        <span className="order-route">
          <span className="order-route__node">
            <span className="order-route__dot" aria-hidden="true" />
            <ConnectionEntityLabel connectionId={order.sourceConnectionId} showId={false} />
            <span className="order-route__role">source</span>
          </span>
          <span className="order-route__arrow" aria-hidden="true">
            →
          </span>
          {order.syncStatus.length > 0 ? (
            order.syncStatus.map((s) => (
              <span className="order-route__node" key={s.destinationConnectionId}>
                <span className="order-route__dot order-route__dot--accent" aria-hidden="true" />
                <ConnectionEntityLabel connectionId={s.destinationConnectionId} showId={false} />
                <span className="order-route__role">destination</span>
              </span>
            ))
          ) : (
            <span className="order-route__node text-muted">no destination</span>
          )}
        </span>

        <span className="order-header__received">
          Received <TimeDisplay iso={order.createdAt} format="datetime" className="mono-text tabular" />{' '}
          <span className="text-muted">
            · <TimeDisplay iso={order.createdAt} format="relative" />
          </span>
        </span>
      </div>

      {itemCount > 0 ? (
        <div className="order-header__summary-line">
          <ProductThumbnail name={productName ?? order.internalOrderId} src={firstItem?.imageUrl} size="sm" />
          <strong>
            {itemCount} item{itemCount > 1 ? 's' : ''} · {unitCount} unit{unitCount > 1 ? 's' : ''}
          </strong>
          {productName ? (
            <>
              <span className="order-header__summary-sep">—</span>
              {firstItem?.productId ? (
                <Link className="order-product-link" to={`/products/${firstItem.productId}`}>
                  {productName}
                </Link>
              ) : (
                <span className="order-product-link order-product-link--plain">{productName}</span>
              )}
              {itemCount > 1 ? <span className="text-muted">+{itemCount - 1} more</span> : null}
            </>
          ) : null}
          {snapshot.totals ? (
            <>
              <span className="order-header__summary-sep">·</span>
              <span className="mono-text tabular">
                {formatAmount(snapshot.totals.total, snapshot.totals.currency)}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
