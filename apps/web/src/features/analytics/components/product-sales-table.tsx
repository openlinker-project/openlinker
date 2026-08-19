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
 * renders muted "Not listed" prose with a "Publish" chip sharing the same
 * slot, swapping in via CSS on hover/focus — see `.cell-not-listed` in
 * `index.css`. The chip must stay `position: absolute; right: 0` inside the
 * slot, never a flex sibling (an `opacity: 0` sibling still occupies layout
 * and misaligns the label from the column's right edge).
 *
 * Money column terminology (see the #1991 plan § 4): labeled "Revenue", not
 * the design mockup's "Net sales" copy — #1988 computes a gross,
 * reporting-currency figure with no VAT/returns netting, and the sibling
 * by-channel table (#1990) already resolved this identical tension the same
 * way. Do not relabel this column without also revisiting that decision.
 *
 * Thumbnails come from the product catalogue (`Product.images[0]`), joined
 * FE-side via `useProductsBatchQuery` — never from a per-channel order-item
 * image field, which is only populated by some source adapters and would
 * make the column patchy depending on which channel a sale landed on.
 *
 * @module features/analytics/components
 */
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { Chip } from '../../../shared/ui/chip';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { useConnectionsQuery, type Connection } from '../../connections';
import { useProductsBatchQuery, type Product } from '../../products';
import { useTopProductsQuery } from '../hooks/use-top-products-query';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { TopProductRow, TopProductsSortBy } from '../api/top-products.types';
import {
  channelCellFor,
  deriveChannelColumns,
  isMissingFrom,
  totalUnits,
} from '../lib/top-products-view-model';

const DEFAULT_LIMIT = 20;

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

function ChannelCell({
  row,
  connectionId,
  intFormat,
  onPublish,
}: {
  row: TopProductRow;
  connectionId: string;
  intFormat: Intl.NumberFormat;
  onPublish: (productId: string, connectionId: string) => void;
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
      <Chip
        tone="warning"
        className="cell-not-listed__chip"
        aria-label={`Publish ${row.name ?? row.productId} on this channel — it already sells elsewhere`}
        onClick={() => onPublish(row.productId, connectionId)}
      >
        Publish
      </Chip>
    </span>
  );
}

export function ProductSalesTable({ filters }: ProductSalesTableProps): ReactElement {
  const [sortBy, setSortBy] = useState<TopProductsSortBy>('revenue');
  const query = useTopProductsQuery({ ...filters, sortBy, limit: DEFAULT_LIMIT, offset: 0 });
  const connectionsQuery = useConnectionsQuery();
  const intFormat = useNumberFormat();
  const navigate = useNavigate();

  function handlePublish(productId: string, connectionId: string): void {
    void navigate(buildPublishHref(productId, connectionId));
  }

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
      cell: (row) =>
        row.currency ? (
          formatAmount(row.revenue, row.currency)
        ) : (
          <EmptyValue label="No FX-stamped order for this product in range" />
        ),
    },
    {
      id: 'units',
      header: sortBy === 'units' ? 'Units ↓' : 'Units',
      align: 'right',
      cell: (row) => intFormat.format(totalUnits(row)),
    },
    ...channelColumns.map(
      (connectionId): DataTableColumn<TopProductRow> => ({
        id: `channel-${connectionId}`,
        header: connectionsById.get(connectionId)?.name ?? connectionId,
        align: 'right',
        cell: (row) => (
          <ChannelCell row={row} connectionId={connectionId} intFormat={intFormat} onPublish={handlePublish} />
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
              {row.currency ? formatAmount(row.revenue, row.currency) : <EmptyValue label="No revenue figure" />}
              {' · '}
              {intFormat.format(totalUnits(row))} units
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
                    onPublish={handlePublish}
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
