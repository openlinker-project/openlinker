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
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ConnectionEntityLabel } from '../../connections';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import type { OrderRecord } from '../api/orders.types';
import { paymentMethodChipLabel } from '../lib/payment-method';
import type { ParsedOrderSnapshot, PaymentStatus } from '../api/order-snapshot.schema';
import { deriveHealthLevel, healthLabel, rollupSyncStatus, totalUnits, type OrderHealthLevel } from '../lib/order-health';
import { isOrderLifecyclePhase, orderLifecyclePhaseWaitingOn } from '../lib/order-lifecycle-phase';
import { OrderPhaseOrWaitingBadge } from './order-phase-or-waiting-badge';
import { OrderEditedBadge } from './order-edited-badge';

interface OrderDetailHeaderProps {
  order: OrderRecord;
  snapshot: ParsedOrderSnapshot;
  /**
   * The tags line (#3533, mockup M3) — a slot, not a dependency, so the
   * header stays display-only and the page decides what fills it. Rendered
   * between the id/route line and the contents summary.
   */
  tags?: ReactNode;
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

/** C-23: OL cancelled the order but the channel snapshot has not caught up. */
export function isChannelStatusStale(phase: string | null | undefined, channelStatus: string): boolean {
  return phase === 'cancelled' && channelStatus.toLowerCase() !== 'cancelled';
}

export function OrderDetailHeader({ order, snapshot, tags }: OrderDetailHeaderProps): ReactElement {
  const copy = useMessages('orders').orderDetailHeader;
  const paymentLabels: Record<PaymentStatus, string> = copy.payment;
  const format = useFormat();
  const plural = usePlural();
  const rollup = rollupSyncStatus(order.syncStatus);
  const healthLevel = deriveHealthLevel(rollup);
  const methodLabel = paymentMethodChipLabel(snapshot.paymentMethod, snapshot.paymentStatus);

  const title = interpolate(copy.title, { number: snapshot.orderNumber ?? order.internalOrderId });

  const firstItem = snapshot.items[0];
  const itemCount = snapshot.items.length;
  const unitCount = totalUnits(snapshot.items);
  const productName = firstItem?.name ?? firstItem?.sku ?? firstItem?.productId ?? null;

  return (
    <header className="order-header">
      <div className="order-header__top">
        <h1 className="order-header__title">{title}</h1>
        <StatusBadge tone={HEALTH_TONE[healthLevel]} withDot pulse={healthLevel === 'pending'}>
          {healthLabel(healthLevel, order.handledInOpenLinker)}
        </StatusBadge>
        {/* #2310 — beside the health badge, never instead of it (ADR-059).
            Header badges are full-size, so no `compact` here. */}
        <OrderPhaseOrWaitingBadge order={order} />
        <OrderEditedBadge
          edited={order.editedInOpenLinker}
          needsAttention={order.editsNeedAttention}
        />
        {/* C-23: the channel snapshot keeps saying `processing` until a re-poll,
            so beside a Cancelled phase badge it reads as a second, contradicting
            status. The summary row carries it, labelled as the channel's own. */}
        {snapshot.status && !isChannelStatusStale(order.lifecyclePhase, snapshot.status) ? (
          <StatusBadge tone="neutral" withDot>
            {snapshot.status}
          </StatusBadge>
        ) : null}
        {snapshot.paymentStatus ? (
          <StatusBadge tone={PAYMENT_TONE[snapshot.paymentStatus]} withDot>
            {paymentLabels[snapshot.paymentStatus]}
          </StatusBadge>
        ) : null}
        {methodLabel ? <StatusBadge tone="neutral">{methodLabel}</StatusBadge> : null}
      </div>

      {/* One line answering the operator's actual question — what is this order
          waiting on. Detail only: the list row has no room for a sentence and
          five badge vocabularies already compete there (#2081). */}
      {isOrderLifecyclePhase(order.lifecyclePhase) ? (
        <p className="order-header__phase-note text-muted">
          {orderLifecyclePhaseWaitingOn(order.lifecyclePhase)}
        </p>
      ) : null}

      <div className="order-header__sub">
        <CopyableId id={order.internalOrderId} />

        <span className="order-route">
          <span className="order-route__node">
            <span className="order-route__dot" aria-hidden="true" />
            <ConnectionEntityLabel connectionId={order.sourceConnectionId} showId={false} />
            <span className="order-route__role">{copy.routeSource}</span>
          </span>
          <span className="order-route__arrow" aria-hidden="true">
            →
          </span>
          {order.syncStatus.length > 0 ? (
            order.syncStatus.map((s) => (
              <span className="order-route__node" key={s.destinationConnectionId}>
                <span className="order-route__dot order-route__dot--accent" aria-hidden="true" />
                <ConnectionEntityLabel connectionId={s.destinationConnectionId} showId={false} />
                <span className="order-route__role">{copy.routeDestination}</span>
              </span>
            ))
          ) : (
            <span className="order-route__node text-muted">{copy.noDestination}</span>
          )}
        </span>

        {/* Lead with the buyer-placed-on-marketplace time (#926) when available;
            fall back to the record's ingestion `createdAt` (NOT snapshot.createdAt,
            which is vestigial) for older records / sources without a placed time. */}
        <span className="order-header__received">
          {snapshot.placedAt ? (
            <>
              {copy.placed}{' '}
              <TimeDisplay iso={snapshot.placedAt} format="datetime" className="mono-text tabular" />{' '}
              <span className="text-muted">
                · <TimeDisplay iso={snapshot.placedAt} format="relative" />
              </span>
            </>
          ) : (
            <>
              {copy.received}{' '}
              <TimeDisplay iso={order.createdAt} format="datetime" className="mono-text tabular" />{' '}
              <span className="text-muted">
                · <TimeDisplay iso={order.createdAt} format="relative" />
              </span>
            </>
          )}
        </span>
      </div>

      {tags}

      {itemCount > 0 ? (
        <div className="order-header__summary-line">
          <ProductThumbnail name={productName ?? order.internalOrderId} src={firstItem?.imageUrl} size="sm" />
          <strong>
            {plural(itemCount, copy.items)} · {plural(unitCount, copy.units)}
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
              {itemCount > 1 ? (
                <span className="text-muted">
                  {interpolate(copy.moreItems, { count: format.number(itemCount - 1) })}
                </span>
              ) : null}
            </>
          ) : null}
          {snapshot.totals ? (
            <>
              <span className="order-header__summary-sep">·</span>
              <span className="mono-text tabular">
                {format.money(snapshot.totals.total, snapshot.totals.currency)}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
