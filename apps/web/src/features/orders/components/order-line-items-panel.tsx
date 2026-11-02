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
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { OrderLineItemIdentity } from './order-line-item-identity';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatTaxRate } from '../../../shared/format/format-tax-rate';
import { AbsentValue } from '../../../shared/ui/absent-value';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';
import type { OrderLineCost } from '../api/orders.types';
import { useOrderLineCosts, type OrderLineCostsState } from '../hooks/use-order-line-costs';

interface OrderLineItemsPanelProps {
  items: ParsedOrderItem[];
  /**
   * Only used for per-line price formatting. Totals are rendered separately
   * by `OrderTotalsPanel`.
   */
  totals?: ParsedOrderTotals;
  /**
   * Enables the "Cost at order time" and "Margin" columns (#3588). Absent means
   * no cost read at all, so a caller without an order id renders as before.
   */
  internalOrderId?: string;
}

export function OrderLineItemsPanel({
  items,
  totals,
  internalOrderId,
}: OrderLineItemsPanelProps): ReactElement {
  const currency = totals?.currency;
  const costs = useOrderLineCosts(internalOrderId);
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
        <OrderLineItemIdentity
          name={item.name}
          code={item.sku ?? item.productId ?? item.id}
          codeIsFallback={!item.sku}
          imageSrc={item.imageUrl}
          placeholderName={item.name ?? item.sku ?? item.productId ?? item.id}
        />
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
    ...(costs.enabled ? buildCostColumns(items, costs) : []),
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
      <div data-testid={costs.enabled ? 'order-items-cost-table' : undefined}>
        <DataTable
          caption="Order line items"
          columns={columns}
          rows={rows}
          rowKey={(item) => item.id}
          rowAttributes={
            costs.enabled
              ? (item): Record<string, string> =>
                  costForItem(items, costs, item)?.gapReason === 'no-cost'
                    ? { 'data-testid': 'order-line-no-cost' }
                    : {}
              : undefined
          }
        />
      </div>
      {costs.enabled && costs.status === 'loaded' ? <CostFootnote lines={costs.lines} /> : null}
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

/**
 * The cost row of an item. Lines are written in `items[]` order, so the item's
 * position is its `lineNumber`; a product id that disagrees means the two lists
 * drifted (e.g. a dropped malformed item) and the line is treated as unknown
 * rather than showing another line's cost.
 */
function costForItem(
  items: ParsedOrderItem[],
  costs: OrderLineCostsState,
  item: ParsedOrderItem,
): OrderLineCost | null {
  if (costs.status !== 'loaded') return null;
  const index = items.indexOf(item);
  const line = costs.lines.find((candidate) => candidate.lineNumber === index);
  if (!line) return null;
  if (item.productId && line.productId !== item.productId) return null;
  return line;
}

function buildCostColumns(
  items: ParsedOrderItem[],
  costs: OrderLineCostsState,
): DataTableColumn<ParsedOrderItem>[] {
  return [
    {
      id: 'costAtOrderTime',
      header: 'Cost at order time',
      align: 'right',
      hideBelow: 768,
      cell: (item) => <CostCell line={costForItem(items, costs, item)} />,
    },
    {
      id: 'lineMargin',
      header: 'Margin',
      align: 'right',
      cell: (item) => <MarginCell line={costForItem(items, costs, item)} currency={costs.currency} />,
    },
  ];
}

function CostCell({ line }: { line: OrderLineCost | null }): ReactElement {
  if (!line) return <AbsentValue label="cost not available" />;
  if (line.costOfGoods !== null) {
    return <span className="mono-text">{formatAmount(line.costOfGoods, line.unitCostCurrency ?? undefined)}</span>;
  }
  if (line.gapReason === 'currency-mismatch' && line.unitCostNet !== null) {
    return (
      <span
        className="mono-text"
        title="The cost is in a different currency than the order, so it is not used in margin."
      >
        {formatAmount(Number(line.unitCostNet) * line.quantity, line.unitCostCurrency ?? undefined)}
      </span>
    );
  }
  if (line.gapReason === 'no-variant') {
    return <AbsentValue label="no variant" />;
  }
  if (line.gapReason === 'cost-entered-after-sale') {
    return (
      <span title="Ordered before the cost was entered">
        <StatusBadge tone="neutral" compact>
          Not recorded
        </StatusBadge>
      </span>
    );
  }
  return (
    <StatusBadge tone="warning" withDot compact>
      Not recorded
    </StatusBadge>
  );
}

function MarginCell({
  line,
  currency,
}: {
  line: OrderLineCost | null;
  currency: string | null;
}): ReactElement {
  if (!line) return <AbsentValue label="margin not available" />;
  if (line.margin !== null) {
    return <span className="mono-text">{formatAmount(line.margin, currency ?? undefined)}</span>;
  }
  return <span className="text-muted">Not in margin</span>;
}

function CostFootnote({ lines }: { lines: OrderLineCost[] }): ReactElement {
  const missing = new Set(
    lines
      .filter((line) => line.gapReason === 'no-cost' && line.variantId !== null)
      .map((line) => line.variantId),
  ).size;
  return (
    <p className="data-table__footnote" data-testid="order-line-cost-note">
      Cost is taken from the product when the order arrives and never changes afterwards. Adding a
      cost now will not change this order; it counts from the next one.
      {missing > 0 ? (
        <>
          {' '}
          <Link to="/products/cost-prices" data-testid="order-line-add-cost">
            Add cost for {missing} {missing === 1 ? 'variant' : 'variants'}
          </Link>
        </>
      ) : null}
    </p>
  );
}
