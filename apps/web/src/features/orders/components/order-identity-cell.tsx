/**
 * OrderIdentityCell — shared two-line order identity cell (#1996, #2087).
 *
 * One renderer for the question three lists answer three different ways today:
 * *which order is this row?* A thumbnail beside the same two-level stack the app
 * already ships three times over (`.orders-cell-stack`, `.products-cell-stack`,
 * `.connection-cell__body`) — what a person reads on top, the rest beneath.
 *
 * Line 1 leads with the marketplace-facing order number, because that is the
 * string a buyer quotes and a seller searches for — shortened to a `head…tail`
 * form past 18 characters (see `formatOrderRef`) — and falls back to a shortened
 * internal id only when the number is absent — which, of the four order sources,
 * is only Erli (its mapper sets no `orderNumber`). Copy always writes the
 * **full** internal id, and says so; the shortened string on line 1 exists to be
 * read, not to be pasted into a support ticket.
 *
 * Props are flat and source-agnostic rather than an `OrderSummary` object:
 * Orders feeds them from `parseOrderSnapshot()` while Shipments and Invoices
 * feed them from the *nullable* `orderSummary` projection (#1995), so a caller
 * holding `orderSummary === null` still renders the id-only branch without
 * synthesising an object of nulls.
 *
 * Four recorded deviations from the mockup's frame 02, so no later reviewer
 * "fixes" them back:
 *
 * 1. **Frame 02's sixth state (`–`) is unreachable from production.** The mockup
 *    keys it on `orderSummary === null`, but `buildOrderSummary` returns null
 *    both for "no order record" AND for "the snapshot carries no parseable
 *    items", so a dash there would hide a live order. This cell keys the dash on
 *    a missing `orderId` instead and renders the id-only link for a null
 *    summary. A genuinely unresolvable order (an invoice pointing at an order OL
 *    can no longer resolve) has no signal yet — `EntityLabel`'s `name={null}`
 *    "Unknown" branch is where it belongs, and #2090 owns that decision.
 * 2. **An unnamed multi-item order states its count as a sentence**, not as a
 *    bare `+N`. The mockup gates all of line 2 on the item name, which silently
 *    drops a known item count on exactly the rows an operator triages
 *    (`awaiting_mapping` / `source_deleted` snapshots carry lines with no name).
 * 3. **The copy button is not hover-gated**, unlike `.copyable-id__copy`. That
 *    is `EntityLabel`'s app-wide behaviour at every existing call site, not
 *    something this cell chooses; changing it is a shared-primitive decision.
 * 4. **The cell owns order-reference shortening** (`formatOrderRef` below),
 *    absorbed from the Orders page rather than left to each caller. The mockup
 *    shows short shop numbers only, so it never faced Allegro's 36-character
 *    `checkoutFormId` — which IS Allegro's `orderNumber`, so the shortening is
 *    load-bearing rather than cosmetic. The full number stays reachable: it is
 *    the `nameTitle` on line 1 (hover) and names the copy button (screen
 *    reader). Copy itself writes the internal id, per this issue's AC.
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
   * The order's FULL line-item count (`items.length`), not the number of items
   * projected here and not a unit total — `2` renders `+1`.
   *
   * **Migration note for #2091:** the Orders page derives its `+N` today from
   * `itemsSummary()`, which filters to items that *have a name* before counting
   * the rest. Feed `parsed.items.length` instead, matching what
   * `buildOrderSummary` sends to Shipments and Invoices (#1995) — otherwise the
   * same chip means two different things on the same page, which is exactly the
   * divergence #1996 exists to end.
   */
  itemCount?: number | null;
  /**
   * Fired on name-link navigation only, never on Copy. Exists because the
   * Orders list captures a demo-analytics event when a row is opened (#1788),
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

  // Trim what is RENDERED, not just what is tested: a padded order number would
  // otherwise reach the DOM and the `title` verbatim, and accessible-name
  // normalisation hides that from a `getByRole` assertion.
  const trimmedNumber = orderNumber?.trim() || null;
  const itemName = firstItemName?.trim() || null;
  const displayName = trimmedNumber ? formatOrderRef(trimmedNumber) : shortenId(orderId);
  const totalItems = typeof itemCount === 'number' && itemCount > 0 ? itemCount : 0;
  // `+N` counts what is NOT shown, so a single-item order renders no chip at
  // all — it must never read as though something is hidden.
  const moreCount = totalItems > 1 ? totalItems - 1 : 0;
  // `+4` alone leaves an operator (and a screen reader) to guess what is being
  // counted — lines, not units — so the chip states both facts on hover.
  const moreLabel = `more line item${moreCount === 1 ? '' : 's'}`;
  const moreCountTitle = `${moreCount} ${moreLabel} (${totalItems} in this order)`;
  // Copy writes the INTERNAL id, so the button must say so. Naming it after the
  // order number (as this cell first did) made it assert one identifier while
  // delivering another — an operator pasting into a marketplace search would get
  // an `ol_order_…` string the marketplace never issued. The row is still named,
  // so a button list distinguishes rows: reading out a bare 41-character id per
  // row is not an accessible name either.
  const copySubject = trimmedNumber
    ? `internal order ID for order ${trimmedNumber}`
    : `internal order ID ${displayName}`;
  const classes = ['order-cell', className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {/* Decorative by default (`alt=''` ⇒ aria-hidden): the item name is
          already text on line 2, and the order number is the row's label. The
          initial-glyph fallback covers the image-less case, which is most rows:
          only the WooCommerce order source populates `OrderItem.imageUrl` on
          ingestion (`woocommerce-order-source.adapter.ts`) — Allegro omits it
          deliberately, PrestaShop and Erli never set it. */}
      <ProductThumbnail name={itemName ?? displayName} src={firstItemImageUrl} size="sm" />
      <span className="order-cell__body">
        <EntityLabel
          id={orderId}
          name={displayName}
          showId={false}
          copyLabel={`Copy ${copySubject}`}
          copiedLabel={`Copied ${copySubject}`}
          // `formatOrderRef` may have shortened line 1; without this the tooltip
          // would show the shortened form and the full number would be
          // unreachable to a sighted user (#2089). On the id-fallback branch
          // (every Erli-sourced order) the same argument applies to the id:
          // `shortenId` elides its middle, so `?? orderId` keeps the full value
          // hoverable instead of clipboard-only (#2091).
          nameTitle={trimmedNumber ?? orderId}
          to={`/orders/${orderId}`}
          onNavigate={onNavigate}
        />
        {itemName ? (
          <span className="orders-items-line">
            <span className="text-muted orders-cell-sub orders-items-preview" title={itemName}>
              {itemName}
            </span>
            {moreCount > 0 ? (
              <span className="orders-more-count" title={moreCountTitle}>
                +{moreCount}
              </span>
            ) : null}
          </span>
        ) : totalItems > 1 ? (
          /* Deviation 2 (see the file header): a known count with no name to
             attach it to reads as a sentence, never as a dangling `+N`. Keeps
             the row height equal across the multi-item named and unnamed cases
             — a SINGLE unnamed item still renders no second line, deliberately,
             since there is no count worth stating. */
          <span className="text-muted orders-cell-sub">{totalItems} line items</span>
        ) : null}
      </span>
    </span>
  );
}

/** Longest order number rendered verbatim before it reads as noise. */
const ORDER_REF_MAX_LENGTH = 18;

/**
 * Shorten a long order reference to a `head…tail` form so line 1 reads as a
 * reference; short numbers (most shops) pass through untouched.
 *
 * Exported since #2090: a surface that must render this identity as PLAIN TEXT
 * (the invoices mobile card, whose title and subtitle sit inside the row's own
 * `<Link>` and so cannot carry this cell's link and Copy button) needs the same
 * shortening, or an Allegro-sourced row prints a 36-character UUID on the card
 * while the desktop column shortens it.
 *
 * Absorbed from the Orders page's own `formatOrderRef` (which #2091 deletes) so
 * all three lists shorten identically. It is not optional cosmetics: Allegro's
 * `orderNumber` IS its `checkoutFormId`, a 36-character UUID, and
 * `buildOrderSummary` (#1995) hands Shipments and Invoices that value raw. CSS
 * ellipsis is not a substitute — it truncates from the right and drops the tail,
 * which is the disambiguating half of a UUID.
 *
 * The marketplace itself is conveyed by each list's own Channel column, so no
 * channel prefix is added here.
 */
export function formatOrderRef(orderNumber: string): string {
  if (orderNumber.length <= ORDER_REF_MAX_LENGTH) return orderNumber;
  return `${orderNumber.slice(0, 8)}…${orderNumber.slice(-6)}`;
}
