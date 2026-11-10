/**
 * OrderPeekDetail (#4026)
 *
 * The lower half of the order peek: the buyer note, the items and the
 * addresses and dates. It carries the facts the old expanded row carried
 * (`OrderRowDetail`), laid out for a side panel: a note callout, the items as
 * a table (a mapped line opens its product's peek) and the addresses and dates
 * as a key-value table - the same primitives the product peek uses.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { VariantThumbnail } from '../../products';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { parseOrderSnapshot, type ParsedAddress } from '../api/order-snapshot.schema';
import type { OrderBundleComponent } from '../api/orders.types';
import { GiftLineTag, OrderGiftAttention } from '../../gifts';
import { useOrderQuery } from '../hooks/use-order-query';
import { useMessages as useBundleMessages } from '../../../shared/i18n';

type ParsedItem = ReturnType<typeof parseOrderSnapshot>['items'][number];

/** A peek row: an order line, or a component of a bundle line shown under it (#3935). */
type PeekRow =
  | { kind: 'item'; id: string; item: ParsedItem }
  | { kind: 'component'; id: string; component: OrderBundleComponent };
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
    <span key={index} className="peek-panel__line">
      {line}
    </span>
  ));
}

export interface OrderPeekDetailProps {
  order: OrderRecord;
  /** One or two letters standing in for the item thumbnail (the source's short label). */
  thumbLabel: string;
  /**
   * Opens a mapped line's product. The page owns it: the product peek opens on
   * top of the order peek, and a feature may not import a page.
   */
  onOpenProduct?: (productId: string) => void;
}

export function OrderPeekDetail({ order, thumbLabel, onOpenProduct }: OrderPeekDetailProps): ReactElement {
  const COPY = useMessages('orders').peek;
  const buyerNote = useMessages('orders').buyerNote;
  const parsed = parseOrderSnapshot(order.orderSnapshot);
  const { locale } = useLocale();
  const currency = parsed.totals?.currency;
  const money = (amount: number): string =>
    currency
      ? new Intl.NumberFormat(getBcp47Locale(locale), { style: 'currency', currency }).format(amount)
      : amount.toFixed(2);

  const bundleCopy = useBundleMessages('bundles');
  // The bundle components are frozen on the order and arrive with the detail read
  // only; the list row says whether there is anything to fetch (#3935).
  const detail = useOrderQuery(order.hasBundle === true ? order.internalOrderId : '');
  const bundleLines = detail.data?.bundleLines ?? [];
  const bundleLineIds = new Set(bundleLines.map((bundle) => bundle.lineId));
  const peekRows: PeekRow[] = parsed.items.flatMap((item): PeekRow[] => [
    { kind: 'item', id: item.id, item },
    ...(bundleLines.find((bundle) => bundle.lineId === item.id)?.components ?? []).map(
      (component): PeekRow => ({ kind: 'component', id: `${item.id}:${component.lineId}`, component }),
    ),
  ]);

  const itemColumns: DataTableColumn<PeekRow>[] = [
    {
      id: 'product',
      header: COPY.columns.product,
      lines: 2,
      cell: (row): ReactNode => {
        if (row.kind === 'component') {
          return (
            <span className="order-peek-items__name order-peek-items__component">
              <span className="order-peek-items__title">{row.component.name ?? row.component.sku ?? row.component.lineId}</span>
              {row.component.sku ? <span className="mono-text text-muted">{row.component.sku}</span> : null}
              {row.component.giftSlot === true ? <span className="gift-chip">{bundleCopy.order.giftMark}</span> : null}
            </span>
          );
        }
        const item = row.item;
        const name = item.name ?? item.sku ?? item.id;
        return (
          <span className="order-peek-items__product">
            {item.productId ? (
              // Through the API's image proxy: the order's own image url is
              // the channel's, and a catalogue url can be an internal host.
              <VariantThumbnail
                src={`/products/${encodeURIComponent(item.productId)}/images/0`}
                name={name}
                size="sm"
              />
            ) : item.imageUrl ? (
              <ProductThumbnail name={name} src={item.imageUrl} size="sm" />
            ) : (
              <span className="peek-panel__thumb" aria-hidden="true">
                {thumbLabel}
              </span>
            )}
            <span className="order-peek-items__name">
              <span className="order-peek-items__title">
                {name}
              </span>
              {item.sku ? <span className="mono-text text-muted">{item.sku}</span> : null}
              {item.productId ? null : <span className="peek-panel__item-unmapped">{COPY.itemUnmapped}</span>}
              {bundleLineIds.has(item.id) ? <span className="bundle-chip">{bundleCopy.order.bundleMark}</span> : null}
              {item.gift ? (
                <GiftLineTag lineKey={item.sku ?? item.id} gift={item.gift} currency={parsed.totals?.currency} />
              ) : null}
            </span>
          </span>
        );
      },
    },
    {
      id: 'quantity',
      header: COPY.columns.quantity,
      align: 'right',
      cell: (row) => <span className="tabular">{row.kind === 'component' ? row.component.quantity : row.item.quantity}</span>,
    },
    {
      id: 'price',
      header: COPY.columns.price,
      align: 'right',
      hideBelow: 480,
      cell: (row) =>
        row.kind === 'component' ? (
          <span className="text-muted">{bundleCopy.order.inBundlePrice}</span>
        ) : (
          <span className="tabular">{money(row.item.price)}</span>
        ),
    },
    {
      id: 'total',
      header: COPY.columns.total,
      align: 'right',
      cell: (row) =>
        row.kind === 'component' ? null : (
          <span className="tabular order-peek-items__total">{money(row.item.price * row.item.quantity)}</span>
        ),
    },
    {
      id: 'go',
      header: <span className="sr-only">{COPY.columns.open}</span>,
      align: 'right',
      // The keyboard way in: the row click is mouse-only, this is a real button.
      cell: (row) => {
        if (row.kind === 'component') return null;
        const productId = row.item.productId;
        if (!productId || !onOpenProduct) return null;
        return (
          <button
            type="button"
            className="peek-arrow order-peek-items__go"
            aria-label={interpolate(COPY.openProduct, { name: row.item.name ?? row.item.sku ?? row.item.id })}
            onClick={() => {
              onOpenProduct(productId);
            }}
          >
            <span className="peek-arrow__chevron" aria-hidden="true" />
          </button>
        );
      },
    },
  ];

  return (
    <>
      <OrderGiftAttention
        internalOrderId={order.internalOrderId}
        shopRejected={
          parsed.items.some((item) => item.gift != null) &&
          (order.syncStatus ?? []).some((entry) => entry.status === 'failed')
        }
      />
      {order.hasBuyerNote === true ? (
        <dl className="peek-panel__note">
          <OrderRowBuyerNote internalOrderId={order.internalOrderId} />
        </dl>
      ) : order.buyerNoteState === 'unknown' ? (
        <section className="peek-panel__note peek-panel__note--empty">
          <span className="eyebrow">{buyerNote.rowFieldLabel}</span>
          <p>{buyerNote.listUnknownHint}</p>
        </section>
      ) : null}

      <section className="peek-section" aria-labelledby={`${order.internalOrderId}-items`}>
        <h3 className="peek-section__title" id={`${order.internalOrderId}-items`}>
          {COPY.items}
          <span className="peek-section__count tabular">{parsed.items.length}</span>
        </h3>
        {parsed.items.length === 0 ? (
          <p className="peek-section__empty">{EMPTY}</p>
        ) : (
          <DataTable
            className="peek-table order-peek-items"
            caption={COPY.items}
            columns={itemColumns}
            rows={peekRows}
            rowKey={(row) => row.id}
            // A mapped line opens its product's peek on top of this one; an
            // unmapped one has no product to open, so it does nothing and says so.
            onRowClick={(row) => {
              if (row.kind === 'item' && row.item.productId && onOpenProduct) onOpenProduct(row.item.productId);
            }}
            rowClassName={(row) =>
              row.kind === 'component'
                ? 'order-peek-items__row--component'
                : row.item.productId && onOpenProduct
                  ? 'order-peek-items__row--open'
                  : 'order-peek-items__row--static'
            }
          />
        )}
      </section>

      <section className="peek-section" aria-labelledby={`${order.internalOrderId}-details`}>
        <h3 className="peek-section__title" id={`${order.internalOrderId}-details`}>
          {COPY.details}
        </h3>
        <KeyValueList
          className="peek-facts"
          items={[
            { id: 'customer', label: COPY.customer, value: <span className="peek-facts__lines">{addressLines(parsed.shippingAddress)}</span> },
            { id: 'billing', label: COPY.billing, value: <span className="peek-facts__lines">{addressLines(parsed.billingAddress)}</span> },
            {
              id: 'ship-by',
              label: COPY.shipBy,
              value: order.dispatchByAt ? <TimeDisplay iso={order.dispatchByAt} format="datetime" /> : EMPTY,
            },
            {
              id: 'invoice',
              label: COPY.invoice,
              value: parsed.invoice ? (
                <span className="peek-facts__lines">
                  <span>{invoiceBadge(parsed.invoice).label}</span>
                  {parsed.invoice.clearanceReference ? (
                    <span className="mono-text text-muted">{parsed.invoice.clearanceReference}</span>
                  ) : null}
                </span>
              ) : (
                EMPTY
              ),
            },
            { id: 'synced', label: COPY.synced, value: <TimeDisplay iso={order.createdAt} format="datetime" /> },
            {
              id: 'reference',
              label: COPY.reference,
              value: <CopyableId id={parsed.orderNumber ?? order.internalOrderId} />,
            },
          ]}
        />
      </section>
    </>
  );
}
