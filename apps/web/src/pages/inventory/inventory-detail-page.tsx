import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { useInventoryItemQuery } from '../../features/inventory/hooks/use-inventory-item-query';

export function InventoryDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useInventoryItemQuery(id);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Inventory" title="Inventory item">
        <LoadingState liveRegion="off" title="Loading inventory item" message="Fetching item details…" />
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
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      </PageLayout>
    );
  }

  const item = query.data;

  return (
    <PageLayout
      eyebrow="Inventory"
      title={`Inventory — ${item.id}`}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to inventory
        </Link>
      }
    >
      <section className="detail-section">
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Item ID</dt>
            <dd><span className="mono-text">{item.id}</span></dd>
          </div>
          {item.productName ? (
            <div className="detail-list__row">
              <dt>Product</dt>
              <dd>{item.productName}</dd>
            </div>
          ) : null}
          {item.productSku ? (
            <div className="detail-list__row">
              <dt>Product SKU</dt>
              <dd><span className="mono-text">{item.productSku}</span></dd>
            </div>
          ) : null}
          <div className="detail-list__row">
            <dt>Product ID</dt>
            <dd><span className="mono-text">{item.productId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Variant ID</dt>
            <dd>
              {item.productVariantId ? (
                <span className="mono-text">{item.productVariantId}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Available Quantity</dt>
            <dd>{item.availableQuantity}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Reserved Quantity</dt>
            <dd>{item.reservedQuantity}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Location</dt>
            <dd>
              {item.locationId ? (
                <span className="mono-text">{item.locationId}</span>
              ) : (
                <span className="text-muted">default</span>
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Updated</dt>
            <dd>{new Date(item.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>
    </PageLayout>
  );
}
