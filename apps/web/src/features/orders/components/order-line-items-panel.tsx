/**
 * Order Line Items Panel
 *
 * Renders an order's parsed line items as a DataTable (product thumbnail +
 * name/SKU, tax rate, qty, unit price, line total). The financial rollup lives
 * in a sibling `OrderTotalsPanel` (split in #382) so the summary stays visible
 * when items fail to parse.
 *
 * The tax-rate column (#2254) follows one rule: **an answer is text, only an
 * exception is a badge.** A known rate, a zero and an exemption are all
 * answers, so they read the way the money beside them reads - monospace,
 * tabular, quiet - with a provenance caption underneath. Only *no rate* and
 * *rate conflict* get colour. A green pill on every known rate would put three
 * badges on every line of every order and spend attention on the base case,
 * which is the opposite of what the badge is for.
 *
 * The column carries **no `hideBelow`**. This panel passes no `cardView`, so
 * there is no card to keep four facts in - the class would simply delete the
 * blocking state on a phone, on the one screen that diagnoses it.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatTaxRate } from '../../../shared/format/format-tax-rate';
import { AbsentValue } from '../../../shared/ui/absent-value';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';

interface OrderLineItemsPanelProps {
  items: ParsedOrderItem[];
  /**
   * Only used for per-line price formatting. Totals are rendered separately
   * by `OrderTotalsPanel`.
   */
  totals?: ParsedOrderTotals;
}

export function OrderLineItemsPanel({ items, totals }: OrderLineItemsPanelProps): ReactElement {
  const currency = totals?.currency;
  // Borrowed from the bulk review step rather than invented: a 200-line order
  // gets an alert naming the offending lines and then leaves the operator to
  // find them. Same two controls, same behaviour.
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flaggedCursor = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const flagged = useMemo(() => items.filter(isFlaggedLine), [items]);
  const rows = onlyFlagged ? flagged : items;

  function jumpToNextFlagged(): void {
    if (flagged.length === 0) return;
    const next = flagged[flaggedCursor.current % flagged.length];
    flaggedCursor.current += 1;
    const target = tableRef.current?.querySelector<HTMLElement>(
      `[data-line-id="${CSS.escape(next.id)}"]`,
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus?.();
  }

  const columns: DataTableColumn<ParsedOrderItem>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (item) => (
        <span className="order-line-item__product">
          <ProductThumbnail
            name={item.name ?? item.sku ?? item.productId ?? item.id}
            src={item.imageUrl}
            size="sm"
          />
          <span className="order-line-item__product-info">
            {item.name ? (
              <span className="order-line-item__name">{item.name}</span>
            ) : null}
            {item.sku ? (
              <span className="order-line-item__sku mono-text">{item.sku}</span>
            ) : item.productId ? (
              <span className="order-line-item__sku mono-text text-muted">{item.productId}</span>
            ) : (
              <span className="order-line-item__sku mono-text text-muted">{item.id}</span>
            )}
          </span>
        </span>
      ),
    },
    {
      id: 'taxRate',
      header: 'Tax rate',
      cell: (item) => <TaxRateCell item={item} />,
    },
    {
      id: 'qty',
      header: 'Qty',
      align: 'right',
      cell: (item) => <span>{item.quantity}</span>,
    },
    {
      id: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      cell: (item) => (
        <span className="mono-text">{formatAmount(item.price, currency)}</span>
      ),
    },
    {
      id: 'lineTotal',
      header: 'Total',
      align: 'right',
      cell: (item) => (
        <span className="mono-text">{formatAmount(item.price * item.quantity, currency)}</span>
      ),
    },
  ];

  if (items.length === 0) {
    return (
      <EmptyState
        liveRegion="off"
        title="No line items"
        message="The order snapshot does not contain item details."
      />
    );
  }

  return (
    <div className="order-line-items" ref={tableRef}>
      {flagged.length > 0 ? (
        <div className="ds-row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <Button
            tone="secondary"
            aria-pressed={onlyFlagged}
            onClick={() => { setOnlyFlagged((v) => !v); }}
          >
            Only flagged
          </Button>
          <Button tone="ghost" onClick={jumpToNextFlagged}>
            Jump to next flagged
          </Button>
        </div>
      ) : null}
      <DataTable
        caption="Order line items"
        columns={columns}
        rows={rows}
        rowKey={(item) => item.id}
      />
    </div>
  );
}

/** A line an operator has to act on: no rate at all, or two systems disagreeing. */
function isFlaggedLine(item: ParsedOrderItem): boolean {
  return !item.taxRate || Boolean(item.taxRateChannel);
}

/**
 * One line's tax rate.
 *
 * Four renderings, and the split between them is the epic's central claim:
 * a rate, a zero and an exemption are ANSWERS and read as text; only an absence
 * and a disagreement are exceptions and get a badge.
 */
function TaxRateCell({ item }: { item: ParsedOrderItem }): ReactElement {
  if (!item.taxRate) {
    return (
      <span className="order-line-item__product-info" data-line-id={item.id} tabIndex={-1}>
        <StatusBadge tone="error" withDot compact>
          No tax rate
        </StatusBadge>
        <span className="order-line-item__sku text-muted">set it in the shop</span>
      </span>
    );
  }

  if (item.taxRateChannel) {
    return (
      <span className="order-line-item__product-info" data-line-id={item.id} tabIndex={-1}>
        <span className="mono-text">{formatTaxRate(item.taxRate)}</span>
        <StatusBadge tone="conflict" withDot compact>
          Rate conflict
        </StatusBadge>
        <span className="order-line-item__sku text-muted">
          shop {formatTaxRate(item.taxRate)}, channel {formatTaxRate(item.taxRateChannel)}
        </span>
      </span>
    );
  }

  return (
    <span className="order-line-item__product-info">
      <span className="mono-text">{formatTaxRate(item.taxRate)}</span>
      <span className="order-line-item__sku text-muted">{provenanceCaption(item)}</span>
    </span>
  );
}

/**
 * Where the rate came from and when it was read. Shown rather than enforced:
 * there is no freshness rule, because rate changes are announced ahead and do
 * not apply retroactively.
 */
function provenanceCaption(item: ParsedOrderItem): ReactElement | string {
  const from =
    item.taxSource === 'shop'
      ? 'from the shop'
      : item.taxSource === 'channel'
        ? 'from the channel'
        : item.taxSource === 'backfill'
          ? 'estimated from catalogue'
          : null;
  if (!from) return <AbsentValue label="source not recorded" />;
  if (!item.taxRateReadAt) return from;
  const readAt = new Date(item.taxRateReadAt);
  if (!Number.isFinite(readAt.getTime())) return from;
  const days = Math.floor((Date.now() - readAt.getTime()) / 86_400_000);
  return days >= 1 ? `${from} \u00b7 read ${String(days)} d ago` : `${from} \u00b7 read today`;
}
