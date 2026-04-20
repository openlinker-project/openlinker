import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { TimeDisplay } from '../../shared/ui/time-display';
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

  const items: KeyValueItem[] = [
    { id: 'itemId', label: 'Item ID', value: item.id, mono: true },
  ];
  if (item.productName) {
    items.push({ id: 'productName', label: 'Product', value: item.productName });
  }
  if (item.productSku) {
    items.push({ id: 'productSku', label: 'Product SKU', value: item.productSku, mono: true });
  }
  items.push(
    { id: 'productId', label: 'Product ID', value: item.productId, mono: true },
    {
      id: 'variantId',
      label: 'Variant ID',
      value: item.productVariantId ?? <span className="text-muted">—</span>,
      mono: Boolean(item.productVariantId),
    },
    { id: 'available', label: 'Available Quantity', value: item.availableQuantity },
    { id: 'reserved', label: 'Reserved Quantity', value: item.reservedQuantity },
    {
      id: 'location',
      label: 'Location',
      value: item.locationId ?? <span className="text-muted">default</span>,
      mono: Boolean(item.locationId),
    },
    { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={item.updatedAt} /> },
  );

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
        <KeyValueList items={items} />
      </section>
    </PageLayout>
  );
}
