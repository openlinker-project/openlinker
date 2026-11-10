/**
 * OrderPeekDetail (#4026)
 *
 * The lower half of the order peek: the buyer note, the items and the
 * addresses and dates. It carries the facts the old expanded row carried
 * (`OrderRowDetail`), laid out for a side panel: a note callout, an item list
 * and a two- or three-column grid.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { parseOrderSnapshot, type ParsedAddress } from '../api/order-snapshot.schema';
import type { OrderRecord } from '../api/orders.types';
import { invoiceBadge } from '../lib/order-row';
import { getBcp47Locale, interpolate, useLocale, useMessages } from '../../../shared/i18n';
import { OrderRowBuyerNote } from './order-row-buyer-note';

const EMPTY = '-';

function addressLines(address: ParsedAddress | undefined): ReactNode {
  if (!address) return EMPTY;
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ').trim();
  const lines = [
    name || address.company || null,
    address.address1,
    address.address2 || null,
    [address.postalCode, address.city].filter(Boolean).join(' ').trim() || null,
    address.country,
  ].filter((line): line is string => Boolean(line && line.length > 0));
  if (lines.length === 0) return EMPTY;
  return lines.map((line, index) => (
    <span key={index} className="orders-peek__line">
      {line}
    </span>
  ));
}

export interface OrderPeekDetailProps {
  order: OrderRecord;
  /** One or two letters standing in for the item thumbnail (the source's short label). */
  thumbLabel: string;
}

export function OrderPeekDetail({ order, thumbLabel }: OrderPeekDetailProps): ReactElement {
  const COPY = useMessages('orders').peek;
  const buyerNote = useMessages('orders').buyerNote;
  const parsed = parseOrderSnapshot(order.orderSnapshot);
  const { locale } = useLocale();
  const currency = parsed.totals?.currency;
  const money = (amount: number): string =>
    currency
      ? new Intl.NumberFormat(getBcp47Locale(locale), { style: 'currency', currency }).format(amount)
      : amount.toFixed(2);

  return (
    <>
      {order.hasBuyerNote === true ? (
        <dl className="orders-peek__note">
          <OrderRowBuyerNote internalOrderId={order.internalOrderId} />
        </dl>
      ) : order.buyerNoteState === 'unknown' ? (
        <section className="orders-peek__note orders-peek__note--empty">
          <span className="eyebrow">{buyerNote.rowFieldLabel}</span>
          <p>{buyerNote.listUnknownHint}</p>
        </section>
      ) : null}

      <section>
        <h3 className="orders-peek__h">
          {COPY.items} <span className="text-muted tabular">{parsed.items.length}</span>
        </h3>
        {parsed.items.length === 0 ? (
          <p className="text-muted">{EMPTY}</p>
        ) : (
          <ul className="orders-peek__items">
            {parsed.items.map((item) => {
              const name = item.name ?? item.sku ?? item.id;
              const content = (
                <>
                  {item.imageUrl ? (
                    <ProductThumbnail name={name} src={item.imageUrl} size="sm" />
                  ) : (
                    <span className="orders-peek__thumb" aria-hidden="true">
                      {thumbLabel}
                    </span>
                  )}
                  <span className="orders-peek__item-name">
                    <span className="orders-peek__item-title">{name}</span>
                    {item.sku ? <span className="text-muted mono orders-cell-sub">{item.sku}</span> : null}
                  </span>
                  <span className="tabular">{interpolate(COPY.itemPrice, { quantity: String(item.quantity), price: money(item.price) })}</span>
                </>
              );
              // An unmapped line has no product page to open; it stays text.
              return (
                <li key={item.id}>
                  {item.productId ? (
                    <Link
                      className="orders-peek__item orders-peek__item--link"
                      to={`/products/${item.productId}`}
                      title={interpolate(COPY.openProduct, { name })}
                    >
                      {content}
                      <span className="orders-peek__item-go" aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="orders-peek__item">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="orders-peek__grid">
        <div>
          <span className="eyebrow">{COPY.customer}</span>
          <p>{addressLines(parsed.shippingAddress)}</p>
        </div>
        <div>
          <span className="eyebrow">{COPY.billing}</span>
          <p>{addressLines(parsed.billingAddress)}</p>
        </div>
        <div>
          <span className="eyebrow">{COPY.shipBy}</span>
          <p>
            {order.dispatchByAt ? <TimeDisplay iso={order.dispatchByAt} format="datetime" /> : EMPTY}
          </p>
        </div>
        <div>
          <span className="eyebrow">{COPY.invoice}</span>
          <p>
            {parsed.invoice ? (
              <>
                {invoiceBadge(parsed.invoice).label}
                {parsed.invoice.clearanceReference ? (
                  <span className="orders-peek__line mono text-muted">{parsed.invoice.clearanceReference}</span>
                ) : null}
              </>
            ) : (
              EMPTY
            )}
          </p>
        </div>
        <div>
          <span className="eyebrow">{COPY.synced}</span>
          <p>
            <TimeDisplay iso={order.createdAt} format="datetime" />
          </p>
        </div>
        <div>
          <span className="eyebrow">{COPY.reference}</span>
          <p className="mono">{parsed.orderNumber ?? order.internalOrderId}</p>
        </div>
      </section>
    </>
  );
}
