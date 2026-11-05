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
import type { ReactElement, ReactNode } from 'react';
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
import type {
  OrderBundleComponent,
  OrderBundleLine,
  OrderGiftSlotCost,
  OrderLineCost,
} from '../api/orders.types';
import { interpolate, useMessages } from '../../../shared/i18n';
import { GiftLineTag } from '../../gifts';
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
  /**
   * The channel's own quantity for each line an operator lowered (#3544), by
   * order line id. `items` is the order AS EDITED, so this is what lets the cell
   * show both figures: "2 was 3". Absent for an order nobody edited.
   */
  channelQuantities?: ReadonlyMap<string, number>;
  /**
   * The order's bundle lines with their frozen components (#3624). Each bundle
   * line is followed by its components, indented, with no price of their own:
   * the buyer paid for the bundle. Absent for an order with no bundle, which
   * renders exactly as before.
   */
  bundleLines?: readonly OrderBundleLine[];
  /** The connection issuing the order's sales document, once there is one (#3940): the gift tag names where a gift's form came from. */
  documentConnectionId?: string | null;
}

type DisplayRow =
  | { kind: 'line'; item: ParsedOrderItem; bundle?: OrderBundleLine }
  | { kind: 'component'; parent: ParsedOrderItem; bundle: OrderBundleLine; component: OrderBundleComponent };

const displayRowKey = (row: DisplayRow): string =>
  row.kind === 'line' ? row.item.id : row.component.lineId;

export function OrderLineItemsPanel({
  items,
  totals,
  internalOrderId,
  channelQuantities,
  bundleLines,
  documentConnectionId = null,
}: OrderLineItemsPanelProps): ReactElement {
  const bundleCopy = useMessages('bundles');
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

  const bundleByLine = new Map((bundleLines ?? []).map((bundle) => [bundle.lineId, bundle] as const));
  const displayRows: DisplayRow[] = rows.flatMap((item): DisplayRow[] => {
    const bundle = bundleByLine.get(item.id);
    return bundle === undefined
      ? [{ kind: 'line', item }]
      : [
          { kind: 'line', item, bundle },
          ...bundle.components.map(
            (component): DisplayRow => ({ kind: 'component', parent: item, bundle, component }),
          ),
        ];
  });

  const lineColumns: DataTableColumn<ParsedOrderItem>[] = [
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
          extra={
            <>
              {bundleByLine.has(item.id) ? (
                <BundleLineNotes bundle={bundleByLine.get(item.id) as OrderBundleLine} />
              ) : null}
              {item.gift ? (
                <GiftLineTag
                  lineKey={item.sku ?? item.id}
                  gift={item.gift}
                  currency={currency}
                  costState={
                    !costs.enabled
                      ? 'unavailable'
                      : costs.status === 'loaded'
                        ? 'ready'
                        : costs.status === 'error'
                          ? 'failed'
                          : 'loading'
                  }
                  costNet={
                    costs.enabled && costs.status === 'loaded'
                      ? (costForItem(items, costs, item)?.costOfGoods ?? null)
                      : undefined
                  }
                  documentConnectionId={documentConnectionId}
                />
              ) : null}
            </>
          }
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
      cell: (item) => {
        const channelQuantity = channelQuantities?.get(item.id);
        return (
          <span>
            {item.quantity}
            {channelQuantity !== undefined && channelQuantity !== item.quantity ? (
              <span className="order-edit-was" data-testid="order-edit-line-was">
                {` was ${channelQuantity}`}
              </span>
            ) : null}
          </span>
        );
      },
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

  // Components sit under their bundle line and carry only what is theirs: a
  // name, a quantity, and the fact that their price is inside the bundle's.
  // Every other column is empty for them, never a repeated or invented figure.
  const columns: DataTableColumn<DisplayRow>[] = lineColumns.map(({ accessor, ...column }) => ({
    ...column,
    ...(accessor === undefined
      ? {}
      : { accessor: (row: DisplayRow) => (row.kind === 'line' ? accessor(row.item) : null) }),
    cell: (row: DisplayRow): ReactNode => {
      if (row.kind === 'line') return column.cell(row.item);
      if (column.id === 'product') {
        return (
          <div className="order-line-item--child" style={{ paddingLeft: 'var(--space-5)', borderLeft: '2px solid var(--border-subtle)' }}>
            <OrderLineItemIdentity
              name={row.component.name}
              code={row.component.sku ?? row.component.variantId}
              codeIsFallback={!row.component.sku}
              placeholderName={row.component.name ?? row.component.sku ?? row.component.variantId}
            />
            {row.component.giftSlot === true ? (
              <GiftSlotNote
                component={row.component}
                currency={currency}
                cost={
                  costs.enabled && costs.status === 'loaded'
                    ? (costs.giftSlots.find(
                        (gift) => gift.componentLineId === row.component.lineId,
                      ) ?? null)
                    : null
                }
              />
            ) : null}
          </div>
        );
      }
      if (column.id === 'qty') return row.component.quantity;
      if (column.id === 'unitPrice') {
        // The gift slot is shown at what the buyer pays for it, not as part of the set price.
        return row.component.giftSlot === true ? (
          <span className="mono-text">{formatAmount(0, currency)}</span>
        ) : (
          <span className="text-muted">{bundleCopy.order.inBundlePrice}</span>
        );
      }
      return null;
    },
  }));

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
          rows={displayRows}
          rowKey={displayRowKey}
          tableTestId={bundleByLine.size > 0 ? 'order-bundle-lines' : undefined}
          rowAttributes={(row): Record<string, string> => {
            if (row.kind === 'component') {
              return { 'data-testid': `order-bundle-line-${row.component.sku ?? row.component.variantId}` };
            }
            if (row.bundle !== undefined) {
              return { 'data-testid': `order-bundle-line-${row.item.sku ?? row.item.id}` };
            }
            if (row.item.gift) {
              return { 'data-testid': `order-gift-line-${row.item.sku ?? row.item.id}` };
            }
            return costs.enabled && costForItem(items, costs, row.item)?.gapReason === 'no-cost'
              ? { 'data-testid': 'order-line-no-cost' }
              : {};
          }}
        />
      </div>
      {costs.enabled && costs.status === 'loaded' ? <CostFootnote lines={costs.lines} /> : null}
    </div>
  );
}

/**
 * The gift slot of a set, shown once in its own line (#3934): marked as a gift,
 * what the customer pays for it, and, only where the session may read costs and
 * the cost is known, what it costs the seller. An unknown cost is left out
 * rather than shown as zero.
 */
function GiftSlotNote({
  component,
  currency,
  cost,
}: {
  component: OrderBundleComponent;
  currency: string | undefined;
  cost: OrderGiftSlotCost | null;
}): ReactElement {
  const copy = useMessages('bundles');
  const key = component.sku ?? component.variantId;
  return (
    <div className="text-muted">
      <span data-testid={`order-bundle-gift-mark-${key}`}>{copy.order.giftMark}</span>{' '}
      <span role="note" data-testid={`order-bundle-gift-cost-${key}`}>
        {interpolate(copy.order.giftPays, { price: formatAmount(0, currency) })}
        {cost !== null && cost.totalCostNet !== null
          ? ` · ${interpolate(copy.order.giftCosts, { cost: formatAmount(cost.totalCostNet, currency) })}`
          : ''}
      </span>
    </div>
  );
}

/**
 * What a bundle line says about itself: that it is a bundle and, when the
 * bundle has been changed since the order was frozen, one sentence saying the
 * order keeps the composition it was frozen with. No version numbers: the
 * operator decides nothing by them.
 */
function BundleLineNotes({ bundle }: { bundle: OrderBundleLine }): ReactElement {
  const copy = useMessages('bundles');
  return (
    <>
      <StatusBadge tone="info" compact>
        {copy.order.bundleMark}
      </StatusBadge>
      {bundle.olderComposition ? (
        <span className="text-muted" data-testid="order-bundle-old-composition-note">
          {copy.order.oldComposition}
        </span>
      ) : null}
    </>
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
