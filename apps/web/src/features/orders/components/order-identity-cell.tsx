/**
 * OrderIdentityCell — shared two-line order identity cell (#1996, #2087).
 *
 * One renderer for the question three lists answer three different ways today:
 * *which order is this row?* A thumbnail beside the same two-level stack the app
 * already ships three times over (`.orders-cell-stack`, `.products-cell-stack`,
 * `.connection-cell__body`) — what a person reads on top, the rest beneath.
 *
 * Line 1 leads with the marketplace-facing order number, because that is the
 * string a buyer quotes and a seller searches for, and falls back to a shortened
 * internal id only when the number is absent (every Shipments and Invoices row
 * hits that branch today). Copy always writes the **full** internal id — the
 * shortened string exists to be read, not to be pasted into a support ticket.
 *
 * Props are flat and source-agnostic rather than an `OrderSummary` object:
 * Orders feeds them from `parseOrderSnapshot()` while Shipments and Invoices
 * feed them from the *nullable* `orderSummary` projection (#1995), so a caller
 * holding `orderSummary === null` still renders the id-only branch without
 * synthesising an object of nulls.
 *
 * No page consumes it yet — #2089 (Shipments), #2090 (Invoices) and #2091
 * (Orders) wire it in, mirroring how #2027 delivered `ConnectionCell`.
 *
 * @module features/orders/components
 */
import type { ReactElement } from 'react';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { EntityLabel, shortenId } from '../../../shared/ui/entity-label';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';

export interface OrderIdentityCellProps {
  /**
   * Internal OL order id. Drives the link target and is what Copy writes —
   * never the shortened display form.
   */
  orderId: string;
  /** Source-native order number; the string a buyer quotes. */
  orderNumber?: string | null;
  /** The order's first line item's display name. */
  firstItemName?: string | null;
  /** The order's first line item's image URL, frozen at order-snapshot time. */
  firstItemImageUrl?: string | null;
  /**
   * The order's FULL item count, not the number of items projected here. Drives
   * the `+N` chip, so `2` renders `+1`.
   */
  itemCount?: number | null;
  /**
   * Fired on name-link navigation only, never on Copy. Exists because the
   * Orders list captures a demo-analytics event when a row is opened (#1786),
   * and that call site must survive the migration to this cell.
   */
  onNavigate?: () => void;
  className?: string;
}

export function OrderIdentityCell({
  orderId,
  orderNumber,
  firstItemName,
  firstItemImageUrl,
  itemCount,
  onNavigate,
  className = '',
}: OrderIdentityCellProps): ReactElement {
  if (!orderId) return <EmptyValue />;

  const displayName = orderNumber?.trim() ? orderNumber : shortenId(orderId);
  const itemName = firstItemName?.trim() ? firstItemName : null;
  // `+N` counts what is NOT shown, so a single-item order renders no chip at
  // all — it must never read as though something is hidden.
  const moreCount = typeof itemCount === 'number' && itemCount > 1 ? itemCount - 1 : 0;
  const classes = ['order-cell', className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {/* Decorative by default (`alt=''` ⇒ aria-hidden): the item name is
          already text on line 2, and the order number is the row's label. Its
          initial-glyph fallback covers the image-less case, which is every row
          today — no adapter populates `OrderItem.imageUrl` on ingestion yet. */}
      <ProductThumbnail name={itemName ?? displayName} src={firstItemImageUrl} size="sm" />
      <span className="order-cell__body">
        <EntityLabel
          id={orderId}
          name={displayName}
          showId={false}
          to={`/orders/${orderId}`}
          onNavigate={onNavigate}
        />
        {/* No item name ⇒ no second line at all. A bare `+2` beside nothing
            states a quantity of an unnamed thing, which reads as a defect. */}
        {itemName ? (
          <span className="orders-items-line">
            <span className="text-muted orders-cell-sub orders-items-preview" title={itemName}>
              {itemName}
            </span>
            {moreCount > 0 ? <span className="orders-more-count">+{moreCount}</span> : null}
          </span>
        ) : null}
      </span>
    </span>
  );
}
