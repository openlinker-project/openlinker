import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { EmptyValue } from '../../shared/ui/empty-value';
import { EntityLabel } from '../../shared/ui/entity-label';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { KpiCard } from '../../shared/ui/kpi-card';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useInventoryItemQuery } from '../../features/inventory/hooks/use-inventory-item-query';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';
import type { OfferMapping } from '../../features/listings/api/listings.types';
import {
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_KPI_TONE,
  STOCK_STATUS_LABEL,
} from './inventory-stock-status';

const LISTINGS_COLUMNS: DataTableColumn<OfferMapping>[] = [
  {
    id: 'platform',
    header: 'Platform',
    cell: (row) => <span>{row.platformType}</span>,
  },
  {
    id: 'connection',
    header: 'Connection',
    cell: (row) => <ConnectionEntityLabel connectionId={row.connectionId} showId={false} />,
  },
  {
    id: 'externalId',
    header: 'External ID',
    cell: (row) => <span className="mono-text">{row.externalId}</span>,
    hideBelow: 768,
  },
  {
    id: 'updatedAt',
    header: 'Updated',
    cell: (row) => <TimeDisplay iso={row.updatedAt} />,
    hideBelow: 1024,
  },
];

function buildDetailItems(item: InventoryItem): KeyValueItem[] {
  return [
    {
      id: 'variant',
      label: 'Variant',
      value: item.productVariantId ? (
        <span className="mono-text">{item.productVariantId}</span>
      ) : (
        <span className="text-muted">Simple product — no variants</span>
      ),
    },
    {
      id: 'sku',
      label: 'SKU',
      value: item.productSku ?? <EmptyValue />,
      mono: Boolean(item.productSku),
    },
    {
      id: 'location',
      label: 'Location',
      value: item.locationId ? (
        <span className="mono-text">{item.locationId}</span>
      ) : (
        <span className="text-muted">Default location</span>
      ),
    },
    {
      id: 'updatedAt',
      label: 'Updated',
      value: <TimeDisplay iso={item.updatedAt} format="datetime" />,
    },
    {
      id: 'product',
      label: 'Product',
      value: (
        <EntityLabel
          id={item.productId}
          name={item.productName}
          to={`/products/${item.productId}`}
        />
      ),
    },
  ];
}

export function InventoryDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useInventoryItemQuery(id);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Inventory" title="Inventory item">
        <LoadingState
          liveRegion="off"
          title="Loading inventory item"
          message="Fetching item details…"
        />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Inventory" title="Inventory item">
        <ErrorState
          title="Unable to load inventory item"
          message={query.error?.message ?? 'Item not found'}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </PageLayout>
    );
  }

  return <InventoryDetailContent item={query.data} />;
}

function InventoryDetailContent({ item }: { item: InventoryItem }): ReactElement {
  const status = deriveStockStatus(item.availableQuantity);
  const onHand = item.availableQuantity + item.reservedQuantity;
  const productHeading = item.productName ?? 'Inventory item';
  const variantLabel = item.productVariantId ? 'Variant' : 'Simple product';

  const listingsQuery = useListingsQuery(
    { internalId: item.productVariantId ?? item.productId },
    { limit: 50, offset: 0 },
  );
  const listings = listingsQuery.data?.items ?? [];

  return (
    <PageLayout
      eyebrow="Inventory"
      title={productHeading}
      actions={
        <div className="inventory-detail__actions">
          <Link to=".." relative="path" className="button button--ghost">
            ← Back to inventory
          </Link>
          <Link to={`/products/${item.productId}`} className="button button--primary">
            View product
          </Link>
        </div>
      }
    >
      <section className="inventory-hero" aria-label="Inventory item summary">
        <ProductThumbnail
          className="inventory-hero__thumb"
          src={item.productImageUrl}
          name={productHeading}
          size="md"
        />
        <div className="inventory-hero__body">
          <div className="inventory-hero__title-row">
            <h3 className="inventory-hero__title">{productHeading}</h3>
            <StatusBadge compact withDot tone={STOCK_STATUS_BADGE_TONE[status]}>
              {STOCK_STATUS_LABEL[status]}
            </StatusBadge>
          </div>
          <div className="inventory-hero__meta">
            {item.productSku ? (
              <span className="mono-text">{item.productSku}</span>
            ) : (
              <span className="text-muted">No SKU</span>
            )}
            <span aria-hidden="true" className="inventory-hero__sep">
              ·
            </span>
            <span className="text-muted">{variantLabel}</span>
            <span aria-hidden="true" className="inventory-hero__sep">
              ·
            </span>
            <span className="text-muted">
              Updated <TimeDisplay iso={item.updatedAt} />
            </span>
          </div>
          <code className="inventory-hero__id mono-text" title={item.id}>
            {item.id}
          </code>
        </div>
      </section>

      <section className="inventory-detail__kpi" aria-label="Stock levels">
        <KpiCard
          label="Available"
          tone={STOCK_STATUS_KPI_TONE[status]}
          value={item.availableQuantity}
          description={
            <>
              {item.reservedQuantity} reserved · {onHand} on hand
            </>
          }
        />
      </section>

      <section className="detail-section">
        <h3 className="detail-section__title">Item details</h3>
        <KeyValueList items={buildDetailItems(item)} />
      </section>

      <section className="detail-section">
        <h3 className="detail-section__title">
          Listings using this stock
          {listings.length > 0 ? ` (${listings.length})` : ''}
        </h3>
        {listingsQuery.isLoading ? (
          <p className="text-muted">Loading listings…</p>
        ) : listingsQuery.error ? (
          <p className="text-muted">Couldn&rsquo;t load listings.</p>
        ) : listings.length === 0 ? (
          <p className="text-muted">No listings reference this stock yet.</p>
        ) : (
          <DataTable
            caption="Listings that reference this inventory item"
            columns={LISTINGS_COLUMNS}
            rows={listings}
            rowKey={(row) => row.id}
          />
        )}
      </section>
    </PageLayout>
  );
}
