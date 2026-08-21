/**
 * Top products table (#1991)
 *
 * One row per product, one column per connected sales channel — the
 * flagship cross-channel view (see the #1991 implementation plan). Ranks by
 * revenue or units via a `SegmentedControl`; both figures stay visible in
 * both states, because an operator comparing "sells most money" against
 * "sells most items" needs the pair, not one swapped for the other. The
 * sort choice is local UI state (not URL state) — a per-section toggle
 * isn't, by itself, worth a shareable search param (see the plan's own
 * judgment-call note).
 *
 * Product/variant identity, never SKU: `TopProductRow.productId` is the
 * cross-channel join key (#1988 already groups by `productId`) — Allegro
 * sets `sku = offer.id`, so a SKU-keyed roll-up would split one product
 * across channels.
 *
 * "Not listed" vs. a real `0` (#1991 AC — must not render identically):
 * `EmptyValue` ("—") is wrong here because this cell knows *why* it is
 * empty. Absence from `row.channels` is ambiguous by itself — it means "no
 * sale in this date range", which covers both a channel that genuinely has
 * no listing AND a channel that is listed but simply sold nothing in the
 * window — so it is `isMissingFrom` (`missingFromConnectionIds`, independent
 * of the date range) that decides the rendering, not the absence alone: a
 * listed-but-quiet channel renders the same real, full-weight, tabular `0`
 * a channel with actual sales would, and only a genuinely unlisted channel
 * renders muted "Not listed" prose with a "Publish" action sharing the same
 * slot, swapping in via CSS on hover/focus — see `.cell-not-listed` in
 * `index.css`. The action must stay `position: absolute; right: 0` inside
 * the slot, never a flex sibling (an `opacity: 0` sibling still occupies
 * layout and misaligns the label from the column's right edge). On a
 * touch pointer (no hover) the slot instead stacks label + action
 * permanently visible — see the `@media (hover: none)` block, so #1991's
 * label-vs-action distinction is not desktop-only. The action itself is
 * gated behind `listings:write` (`useWriteAccess` + `ReadOnlyLock`) since
 * publishing is a real write, and is a genuine `<Link>`-as-button rather
 * than `Chip` (which hard-codes a filter-toggle `aria-pressed`) so it
 * carries link semantics (middle-click, open-in-new-tab) for free.
 *
 * Money column terminology (see the #1991 plan § 4): labeled "Revenue", not
 * the design mockup's "Net sales" copy — #1988 computes a gross,
 * reporting-currency figure with no VAT/returns netting, and the sibling
 * by-channel table (#1990) already resolved this identical tension the same
 * way. Do not relabel this column without also revisiting that decision.
 *
 * Revenue cell fallback (#2049/ADR-040): a product whose only orders in
 * range were stamped under a PREVIOUS reporting-currency setting (a
 * different currency era, per the #1988 bugfix) has `currency: null` — same
 * as a never-stamped product. Rather than rendering a bare `EmptyValue` for
 * either case, the cell falls back to `unconvertedRevenue`/
 * `unconvertedCurrency` (when that evidence is itself in one uniform
 * currency) so an operator still sees the figure, clearly marked
 * informational — mirroring `ChannelSalesTable`'s identical fallback for the
 * #1987 by-channel read. This does NOT render two currencies side by side
 * for one row (the mockup's two-money-column "currency-split" mode is
 * out of scope, see the #1991 implementation plan § non-goals) — it shows
 * whichever one figure the row actually has.
 *
 * Thumbnails come from the product catalogue (`Product.images[0]`), joined
 * FE-side via `useProductsBatchQuery` — never from a per-channel order-item
 * image field, which is only populated by some source adapters and would
 * make the column patchy depending on which channel a sale landed on.
 *
 * @module features/analytics/components
 */
import { type ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useConnectionsQuery, type Connection } from '../../connections';
import { useProductsBatchQuery, type Product } from '../../products';
import { useDemoMode } from '../../system';
import { useTopProductsQuery } from '../hooks/use-top-products-query';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { TopProductRow, TopProductsSortBy } from '../api/top-products.types';
import { channelCellFor, deriveChannelColumns, isMissingFrom } from '../lib/top-products-view-model';

const DEFAULT_LIMIT = 20;

const UNCONVERTED_EVIDENCE_TITLE =
  'Native-currency evidence with no current-era FX stamp — informational only, not part of ranked revenue.';

function renderRevenueCell(row: TopProductRow): ReactElement {
  if (row.currency) {
    return <>{formatAmount(row.revenue, row.currency)}</>;
  }
  if (row.unconvertedCurrency) {
    return (
      <span title={UNCONVERTED_EVIDENCE_TITLE}>
        {formatAmount(row.unconvertedRevenue, row.unconvertedCurrency)}
      </span>
    );
  }
  return <EmptyValue label="No FX-stamped order for this product in range" />;
}

const SORT_OPTIONS = [
  { value: 'revenue' as const, label: 'By revenue' },
  { value: 'units' as const, label: 'By units' },
];

interface ProductSalesTableProps {
  filters: SalesAnalyticsFilters;
}

function buildPublishHref(productId: string, connectionId: string): string {
  const params = new URLSearchParams({ productIds: productId, connectionId });
  return `/listings/bulk-create/wizard?${params.toString()}`;
}

function ProductCell({ row, product }: { row: TopProductRow; product: Product | undefined }): ReactElement {
  return (
    <span className="product-row">
      <ProductThumbnail src={product?.images?.[0]} name={row.name ?? row.productId} />
      <span>{row.name ?? row.productId}</span>
    </span>
  );
}

function PublishAction({
  row,
  connectionId,
  demoMode,
}: {
  row: TopProductRow;
  connectionId: string;
  demoMode: boolean;
}): ReactElement | null {
  // A one-shot navigation, not a filter toggle — a real link (styled as a
  // button) rather than `Chip` (which hard-codes `aria-pressed`, exposing a
  // permanently-"not pressed" toggle to AT) or a `Button` + `navigate()`
  // (which loses middle-click / open-in-new-tab for free). This cell is
  // never inside the row's own `rowHref` anchor (`linkifyFirstCell` only
  // covers the first column), so nesting is not a concern.
  const write = useWriteAccess('listings:write', demoMode);
  if (!write.visible) {
    return null;
  }

  const label = `Publish ${row.name ?? row.productId} on this channel — it already sells elsewhere`;

  if (write.demoReadOnly) {
    return (
      <ReadOnlyLock active message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <button
          type="button"
          className="button button--secondary button--xs cell-not-listed__chip"
          disabled
          aria-label={label}
        >
          Publish
        </button>
      </ReadOnlyLock>
    );
  }

  return (
    <Link
      to={buildPublishHref(row.productId, connectionId)}
      className="button button--secondary button--xs cell-not-listed__chip"
      aria-label={label}
    >
      Publish
    </Link>
  );
}

function ChannelCell({
  row,
  connectionId,
  intFormat,
  demoMode,
}: {
  row: TopProductRow;
  connectionId: string;
  intFormat: Intl.NumberFormat;
  demoMode: boolean;
}): ReactElement {
  const channel = channelCellFor(row, connectionId);
  if (channel) {
    return <>{intFormat.format(channel.units)}</>;
  }

  // No sale in range on this channel — but that's not the same as never
  // listed there. Only `missingFromConnectionIds` (independent of the date
  // range) means "not listed"; anything else is a listed channel that
  // simply sold nothing in this window, and renders the same real,
  // full-weight `0` a genuine zero-unit channel would.
  if (!isMissingFrom(row, connectionId)) {
    return <>{intFormat.format(0)}</>;
  }

  return (
    <span className="cell-not-listed">
      <span className="cell-not-listed__label">Not listed</span>
      <PublishAction row={row} connectionId={connectionId} demoMode={demoMode} />
    </span>
  );
}

export function ProductSalesTable({ filters }: ProductSalesTableProps): ReactElement {
  const [sortBy, setSortBy] = useState<TopProductsSortBy>('revenue');
  const query = useTopProductsQuery({ ...filters, sortBy, limit: DEFAULT_LIMIT, offset: 0 });
  const connectionsQuery = useConnectionsQuery();
  const intFormat = useNumberFormat();
  const demoMode = useDemoMode();

  const items = query.data?.items ?? [];
  const productIds = items.map((item) => item.productId);
  const productQueries = useProductsBatchQuery(productIds, { enabled: productIds.length > 0 });
  const productsById = new Map(
    productIds.map((id, index) => [id, productQueries[index]?.data])
  );
  const connectionsById = new Map((connectionsQuery.data ?? []).map((c: Connection) => [c.id, c]));

  if (query.isLoading) {
    return (
      <LoadingState
        eyebrow="Loading"
        title="Loading top products"
        message="Fetching revenue and units per product, split by channel…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load top products"
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const channelColumns = deriveChannelColumns(items);

  const columns: DataTableColumn<TopProductRow>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (row) => <ProductCell row={row} product={productsById.get(row.productId)} />,
    },
    {
      id: 'sku',
      header: 'SKU',
      hideBelow: 768,
      cell: (row) => (row.sku ? <span className="mono-text">{row.sku}</span> : <EmptyValue label="No SKU" />),
    },
    {
      id: 'revenue',
      header: sortBy === 'revenue' ? 'Revenue ↓' : 'Revenue',
      align: 'right',
      cell: renderRevenueCell,
    },
    {
      id: 'units',
      header: sortBy === 'units' ? 'Units ↓' : 'Units',
      align: 'right',
      // The server-ranked figure, not a re-sum of `row.channels[]` — that
      // breakdown is a separate read (#2172) and could in principle be
      // narrower than the full split, which would make the displayed total
      // silently disagree with the sort order the header arrow claims.
      cell: (row) => intFormat.format(row.units),
    },
    ...channelColumns.map(
      (connectionId): DataTableColumn<TopProductRow> => ({
        id: `channel-${connectionId}`,
        header: connectionsById.get(connectionId)?.name ?? connectionId,
        align: 'right',
        cell: (row) => (
          <ChannelCell row={row} connectionId={connectionId} intFormat={intFormat} demoMode={demoMode} />
        ),
      })
    ),
  ];

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <h3 className="section-title">Top products</h3>
        <SegmentedControl
          options={SORT_OPTIONS}
          value={sortBy}
          onChange={setSortBy}
          aria-label="Rank products by"
        />
      </div>
      <DataTable
        caption="Top products with per-channel split"
        rows={items}
        columns={columns}
        rowKey={(row) => row.productId}
        rowHref={(row) => `/products/${row.productId}`}
        stickyLeftColumns={1}
        cardView={{
          title: (row) => row.name ?? row.productId,
          subtitle: (row) => row.sku ?? undefined,
          summary: (row) => (
            <>
              {renderRevenueCell(row)}
              {' · '}
              {intFormat.format(row.units)} units
            </>
          ),
          detail: (row) => (
            <div className="data-table__stack">
              {channelColumns.map((connectionId) => (
                <span key={connectionId}>
                  {connectionsById.get(connectionId)?.name ?? connectionId}:{' '}
                  <ChannelCell
                    row={row}
                    connectionId={connectionId}
                    intFormat={intFormat}
                    demoMode={demoMode}
                  />
                </span>
              ))}
            </div>
          ),
          collapsibleDetail: true,
        }}
        emptyState={<EmptyValue label="No orders in this range" />}
      />
    </article>
  );
}
