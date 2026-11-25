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
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ConnectionEntityLabel } from '../../connections';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import type { OrderRecord } from '../api/orders.types';
import { minorUnitExponentFor } from '../../invoicing';
import { paymentMethodChipLabel } from '../lib/payment-method';
import { OrderRefundStateBadge } from './order-refund-state-badge';
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
  /** Page actions (edit, cancel, ...), shown in the header card (#4286). */
  actions?: ReactNode;
  /** Strip along the bottom of the card, e.g. the Next step card (#4286). */
  footer?: ReactNode;
  /** Colour of the card's top bar: the tone of the next step, or `ok` when there is none. */
  accent?: 'error' | 'warning' | 'info' | 'ok';
  /** How many problems the page names; shown as "All issues (N)" beside the status. */
  issuesCount?: number;
  onShowIssues?: () => void;
  /** Buyer name, shown under the title when the snapshot carries one (PII-gated upstream). */
  buyerName?: string | null;
  /** One line about delivery (carrier, pickup point) and the ship-by deadline. */
  deliveryFact?: string | null;
  shipByFact?: { iso: string; tone: StatusBadgeTone } | null;
  channelName?: string | null;
  /** Opens a product's peek instead of navigating to its page (#4286). */
  onOpenProduct?: (productId: string) => void;
  /** The most urgent problem as a status pill; falls back to the health badge when there is none. */
  statusPill?: { tone: StatusBadgeTone; label: string } | null;
}

const HEALTH_TONE: Record<OrderHealthLevel, StatusBadgeTone> = {
  attention: 'error',
  pending: 'warning',
  healthy: 'success',
  unknown: 'neutral',
};


/** C-23: OL cancelled the order but the channel snapshot has not caught up. */
export function isChannelStatusStale(phase: string | null | undefined, channelStatus: string): boolean {
  return phase === 'cancelled' && channelStatus.toLowerCase() !== 'cancelled';
}

export function OrderDetailHeader({
  order,
  snapshot,
  tags,
  actions,
  footer,
  accent = 'ok',
  issuesCount = 0,
  onShowIssues,
  buyerName = null,
  deliveryFact = null,
  shipByFact = null,
  channelName = null,
  onOpenProduct,
  statusPill = null,
}: OrderDetailHeaderProps): ReactElement {
  const copy = useMessages('orders').orderDetailHeader;
  const paymentLabels: Record<PaymentStatus, string> = copy.payment;
  const format = useFormat();
  const plural = usePlural();
  const [copied, setCopied] = useState(false);
  const rollup = rollupSyncStatus(order.syncStatus);
  const healthLevel = deriveHealthLevel(rollup);
  const methodLabel = paymentMethodChipLabel(snapshot.paymentMethod, snapshot.paymentStatus);

  // A source number reads as is; an internal id or a UUID is shortened to 8 characters, the full id stays behind the copy chip.
  const rawNumber = snapshot.orderNumber ?? order.internalOrderId;
  const isLongId = rawNumber.length > 14;
  const shortNumber = isLongId
    ? `#${rawNumber.replace(/^ol_order_/, '').slice(0, 8)}`
    : rawNumber.startsWith('#')
      ? rawNumber
      : `#${rawNumber}`;
  const title = interpolate(copy.title, { number: shortNumber });

  const firstItem = snapshot.items[0];
  const itemCount = snapshot.items.length;
  const unitCount = totalUnits(snapshot.items);
  const productName = firstItem?.name ?? firstItem?.sku ?? firstItem?.productId ?? null;

  return (
    <header className="order-header order-header--card" data-accent={accent}>
      <div className="order-header__body">
      <div className="order-header__main">
      <div className="order-header__top">
        <h1 className="order-header__title" title={rawNumber}>
          {title}
        </h1>
        <button
          type="button"
          className="order-header__copy-id"
          title={order.internalOrderId}
          onClick={() => {
            void navigator.clipboard?.writeText(order.internalOrderId).then(
              () => {
                setCopied(true);
                window.setTimeout(() => { setCopied(false); }, 1500);
              },
              () => undefined,
            );
          }}
        >
          {copied ? copy.copiedId : copy.copyId}
          <svg viewBox="0 0 24 24" aria-hidden="true" className="order-header__icon"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5 15V6a2 2 0 012-2h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        {/* The chip reads "Copy id"; the full id stays in the page text for assistive tech, search and tests. */}
        <span className="sr-only">{order.internalOrderId}</span>
        <span className="order-header__channel">
          {channelName ? (
            <>
              <span className="order-header__avatar" aria-hidden="true">
                {channelName.trim().charAt(0).toUpperCase()}
              </span>
              {channelName}
            </>
          ) : (
            <ConnectionEntityLabel connectionId={order.sourceConnectionId} showId={false} showCopy={false} />
          )}
        </span>
      </div>

      {/* Lead with the buyer-placed-on-marketplace time (#926) when available;
          fall back to the record's ingestion `createdAt` (NOT snapshot.createdAt,
          which is vestigial) for older records / sources without a placed time. */}
      <div className="order-header__identity">
        {buyerName ? <strong>{buyerName}</strong> : null}
        {snapshot.placedAt ? (
          <>
            <TimeDisplay iso={snapshot.placedAt} format="datetime" className="tabular" />
            <span className="text-muted">
              <TimeDisplay iso={snapshot.placedAt} format="relative" />
            </span>
          </>
        ) : (
          <>
            <span>{copy.received}</span>
            <TimeDisplay iso={order.createdAt} format="datetime" className="tabular" />
            <span className="text-muted">
              <TimeDisplay iso={order.createdAt} format="relative" />
            </span>
          </>
        )}
      </div>

      <div className="order-header__top order-header__status-row">
        {statusPill ? (
          <StatusBadge tone={statusPill.tone} withDot>
            {statusPill.label}
          </StatusBadge>
        ) : (
          <StatusBadge tone={HEALTH_TONE[healthLevel]} withDot pulse={healthLevel === 'pending'}>
            {healthLabel(healthLevel, order.handledInOpenLinker)}
          </StatusBadge>
        )}
        {/* #2310 — beside the health badge, never instead of it (ADR-059). */}
        <OrderPhaseOrWaitingBadge order={order} />
        {issuesCount > 0 && onShowIssues ? (
          <button type="button" className="order-header__issues" onClick={onShowIssues}>
            {interpolate(copy.allIssues, { count: issuesCount })}
          </button>
        ) : null}
        <span className="order-header__phase-note text-muted">
          {[
            isOrderLifecyclePhase(order.lifecyclePhase)
              ? orderLifecyclePhaseWaitingOn(order.lifecyclePhase)
              : null,
            // C-23: the channel snapshot keeps saying `processing` until a re-poll, so beside a Cancelled phase it would read as a second status.
            snapshot.status && !isChannelStatusStale(order.lifecyclePhase, snapshot.status)
              ? snapshot.status
              : null,
            methodLabel,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <OrderEditedBadge
          edited={order.editedInOpenLinker}
          needsAttention={order.editsNeedAttention}
        />
        <OrderRefundStateBadge refundState={order.refundState} />
      </div>

      {deliveryFact || shipByFact ? (
        <div className="order-header__facts">
          {deliveryFact ? (
            <span className="order-header__fact">
              <svg className="order-header__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
              {deliveryFact}
            </span>
          ) : null}
          {shipByFact ? (
            <span className={`order-header__fact order-header__shipby order-header__shipby--${shipByFact.tone}`}>
              <svg className="order-header__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              {copy.shipBy} <TimeDisplay iso={shipByFact.iso} format="datetime" className="tabular" />
            </span>
          ) : null}
        </div>
      ) : null}

      {tags}

      {itemCount > 0 ? (
        <div className="order-header__summary-line">
          <strong>
            {plural(itemCount, copy.items)} · {plural(unitCount, copy.units)}
          </strong>
          {productName ? (
            <>
              <span className="order-header__summary-sep">—</span>
              {firstItem?.productId ? (
                <Link
                  className="order-product-link"
                  to={`/products/${firstItem.productId}`}
                  onClick={(event) => {
                    // A plain click opens the peek; modified clicks still open the page.
                    if (!onOpenProduct || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    onOpenProduct(firstItem.productId as string);
                  }}
                >
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
        </div>
      ) : null}
      </div>
      <div className="order-header__aside">
        {snapshot.totals ? (
          <strong className="order-header__total tabular">
            <span className="order-header__currency">{snapshot.totals.currency}</span>{" "}
            {format.number(snapshot.totals.total, {
              minimumFractionDigits: minorUnitExponentFor(snapshot.totals.currency),
              maximumFractionDigits: minorUnitExponentFor(snapshot.totals.currency),
            })}
          </strong>
        ) : null}
        {snapshot.paymentStatus ? (
          <span className="order-header__paid text-muted">
            {snapshot.paymentStatus === 'paid' ? <span aria-hidden="true">✓ </span> : null}
            {snapshot.paymentStatus === 'paid' && channelName
              ? interpolate(copy.paidOn, { channel: channelName })
              : paymentLabels[snapshot.paymentStatus]}
          </span>
        ) : null}
        {actions ? <div className="order-header__actions">{actions}</div> : null}
      </div>
      </div>
      {footer ? <div className="order-header__footer">{footer}</div> : null}
    </header>
  );
}
