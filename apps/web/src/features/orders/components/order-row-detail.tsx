/**
 * OrderRowDetail
 *
 * The long-form order fields that stay out of the dense orders-list row (#1620,
 * regrouped #1713). On desktop it fills the expandable-row accordion panel; on
 * mobile it fills the card's "View full details" disclosure. Leads with an
 * "Open order" strip (OpenLinker detail + source-marketplace deep link), then
 * the identity/timing fields, the itemised line list, and the addresses.
 *
 * Fields now surfaced directly in the row (carrier, payment, created) are no
 * longer repeated here — the panel keeps only what's worth expanding for.
 *
 * Pure presentation: all inputs are already-resolved view-model values.
 *
 * @module features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { getBcp47Locale, useTranslation } from '../../../shared/i18n';
import { isSafeHttpUrl } from '../../../shared/lib/is-safe-http-url';
import {
  parseOrderSnapshot,
  type ParsedAddress,
  type ParsedOrderItem,
} from '../api/order-snapshot.schema';
import { invoiceBadge } from '../lib/order-row';
import type { OrderRecord } from '../api/orders.types';

interface OrderRowDetailProps {
  order: OrderRecord;
  /** Resolve a source/destination platformType to a human channel label. */
  channelLabel: (platform: string | undefined) => string | undefined;
  platformByConnection: Map<string, string>;
}

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

function LineItem({
  item,
  formatPrice,
}: {
  item: ParsedOrderItem;
  formatPrice: (price: number) => string;
}): ReactElement {
  return (
    <div className="orders-line-item">
      <span className="orders-line-item__qty mono tabular">{item.quantity}×</span>
      <span className="orders-line-item__name">
        {item.name ?? item.sku ?? item.id}
        {item.sku ? <span className="orders-line-item__sku mono">{item.sku}</span> : null}
      </span>
      <span className="orders-line-item__price mono tabular">{formatPrice(item.price)}</span>
    </div>
  );
}

export function OrderRowDetail({
  order,
  channelLabel,
  platformByConnection,
}: OrderRowDetailProps): ReactElement {
  const parsed = parseOrderSnapshot(order.orderSnapshot);
  const { locale } = useTranslation();
  const currency = parsed.totals?.currency;
  const formatPrice = (price: number): string =>
    currency
      ? new Intl.NumberFormat(getBcp47Locale(locale), { style: 'currency', currency }).format(price)
      : price.toFixed(2);

  const sourcePlatform = platformByConnection.get(order.sourceConnectionId);
  const sourceLabel = channelLabel(sourcePlatform);
  const destPlatform = order.syncStatus[0]
    ? platformByConnection.get(order.syncStatus[0].destinationConnectionId)
    : undefined;
  const destLabel = channelLabel(destPlatform);

  return (
    <dl className="orders-detail">
      {/* "Open order" strip (#1713): OpenLinker detail (internal) + the
          source-marketplace deep link when the adapter supplied one. */}
      <div className="orders-detail__links">
        <Link className="orders-ext-link orders-ext-link--internal" to={`/orders/${order.internalOrderId}`}>
          Order details <span aria-hidden="true" className="orders-ext-link__arrow">→</span>
        </Link>
        {parsed.sourceExternalUrl && isSafeHttpUrl(parsed.sourceExternalUrl) ? (
          <a
            className="orders-ext-link"
            data-channel={sourcePlatform}
            href={parsed.sourceExternalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on {sourceLabel ?? 'marketplace'}{' '}
            <span aria-hidden="true" className="orders-ext-link__arrow">
              ↗
            </span>
          </a>
        ) : null}
      </div>

      <Field label="Order reference">
        {parsed.orderNumber ? <span className="mono">{parsed.orderNumber}</span> : EMPTY}
      </Field>
      <Field label="Internal ID">
        <span className="mono">{order.internalOrderId}</span>
      </Field>
      <Field label="Placed">
        {parsed.placedAt ? <TimeDisplay iso={parsed.placedAt} format="datetime" /> : EMPTY}
      </Field>
      <Field label="Destination">{destLabel ?? EMPTY}</Field>
      <Field label="Ship-by">
        {order.dispatchByAt ? (
          <span>
            <TimeDisplay iso={order.dispatchByAt} format="datetime" />
            {/* Estimated ship-by qualifier (#1776) - OL-side estimate (Erli), */}
            {/* absent for authoritative marketplace commitments (Allegro). */}
            {order.dispatchByEstimated ? (
              <span
                className="text-muted"
                aria-label="Estimated"
                title="OpenLinker estimate - not a marketplace-confirmed deadline"
              >
                {' '}
                (est.)
              </span>
            ) : null}
          </span>
        ) : (
          EMPTY
        )}
      </Field>
      <Field label="Invoice">
        {parsed.invoice ? (
          <span className="orders-detail__invoice">
            <span>{invoiceBadge(parsed.invoice).label}</span>
            {parsed.invoice.clearanceReference ? (
              <span className="mono text-muted">{parsed.invoice.clearanceReference}</span>
            ) : null}
          </span>
        ) : (
          EMPTY
        )}
      </Field>

      <div className="orders-detail__field orders-detail__field--wide">
        <dt className="orders-detail__label">
          Items{parsed.items.length > 0 ? ` (${parsed.items.length})` : ''}
        </dt>
        <dd className="orders-detail__value">
          {parsed.items.length === 0 ? (
            EMPTY
          ) : (
            <div className="orders-detail__items-list">
              {parsed.items.map((item) => (
                <LineItem key={item.id} item={item} formatPrice={formatPrice} />
              ))}
            </div>
          )}
        </dd>
      </div>

      <Field label="Shipping address">{formatAddress(parsed.shippingAddress)}</Field>
      <Field label="Billing address">{formatAddress(parsed.billingAddress)}</Field>
    </dl>
  );
}
