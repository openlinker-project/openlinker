/**
 * StockHistorySection (#3568, M7 state `variant-history`)
 *
 * The product-detail "Stock history" section: scoped to one variant chosen in a
 * select, with a summary strip, the movement table and a link to the global
 * page pre-filtered to the SKU. Read-only for every role that can see the page.
 *
 * "Available now" is the sum of the variant's inventory rows; "Promised (held)"
 * is the sum of its held reservations (a promise never lowers the stock). "Last
 * change" is the newest APPLIED movement on the page - never a reservation.
 *
 * @module apps/web/src/features/inventory/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Select } from '../../../shared/ui/select';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useInventoryQuery } from '../hooks/use-inventory-query';
import { useInventoryMovementsQuery } from '../hooks/use-inventory-movements-query';
import { useConnectionNames } from '../hooks/use-connection-names';
import { StockMovementsTable } from './stock-movements-table';

export interface StockHistoryVariant {
  id: string;
  sku: string | null;
  attributes: Record<string, string> | null;
}

export interface StockHistorySectionProps {
  productId: string;
  productName?: string | null;
  variants: readonly StockHistoryVariant[];
}

const HISTORY_PAGE_SIZE = 10;
const PROMISED_SCAN_LIMIT = 100;

function variantLabel(variant: StockHistoryVariant): string {
  const attributes = Object.values(variant.attributes ?? {}).join(', ');
  const parts = [attributes, variant.sku].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' — ') : variant.id;
}

export function StockHistorySection({
  productId,
  productName,
  variants,
}: StockHistorySectionProps): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const variant = variants.find((v) => v.id === selectedId) ?? variants[0];
  const variantId = variant?.id;
  const connectionNames = useConnectionNames();

  const filters = { productId, productVariantId: variantId };
  const rows = useInventoryMovementsQuery(
    filters,
    { limit: HISTORY_PAGE_SIZE, offset: 0 },
    { enabled: variantId !== undefined },
  );
  const promised = useInventoryMovementsQuery(
    { ...filters, kind: 'promised' },
    { limit: PROMISED_SCAN_LIMIT, offset: 0 },
    { enabled: variantId !== undefined },
  );
  const stock = useInventoryQuery(
    { productId, productVariantId: variantId, excludeStale: true },
    { limit: 100 },
  );

  if (variant === undefined) return null;

  const items = rows.data?.items ?? [];
  const lastApplied = items.find((row) => row.kind === 'movement' && row.status === 'applied');
  const masterId = items.find((row) => row.sourceConnectionId !== null)?.sourceConnectionId ?? null;
  const availableNow = stock.data
    ? stock.data.items.reduce((sum, item) => sum + item.availableQuantity, 0)
    : null;
  const promisedHeld = promised.data
    ? promised.data.items
        .filter((row) => row.status === 'held')
        .reduce((sum, row) => sum + row.quantityDelta, 0)
    : null;

  const viewAllHref = `/inventory/movements?productVariantId=${encodeURIComponent(variant.id)}`;

  return (
    <div className="panel" data-testid="stock-history">
      <div className="panel__header">
        <div>
          {productName ? (
            <p className="eyebrow" style={{ marginBottom: 2 }}>
              {productName}
            </p>
          ) : null}
          <h3 style={{ margin: 0 }}>Stock history</h3>
        </div>
        <Select
          aria-label="Choose variant"
          style={{ minWidth: '16rem' }}
          data-testid="stock-history-variant"
          value={variant.id}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {variantLabel(v)}
            </option>
          ))}
        </Select>
      </div>

      <dl className="stock-history__summary" data-testid="stock-history-summary">
        <div>
          <dt>Available now</dt>
          <dd className="mono-text tabular">{availableNow ?? '—'}</dd>
        </div>
        <div>
          <dt>Promised (held)</dt>
          <dd className="mono-text tabular">{promisedHeld ?? '—'}</dd>
        </div>
        <div>
          <dt>Last change</dt>
          <dd className="mono-text">
            {lastApplied ? <TimeDisplay iso={lastApplied.occurredAt} /> : '—'}
          </dd>
        </div>
        <div>
          <dt>Master connection</dt>
          <dd>{masterId ? (connectionNames.get(masterId) ?? masterId) : '—'}</dd>
        </div>
      </dl>

      {rows.isLoading ? (
        <LoadingState liveRegion="off" title="Loading stock history" message="Fetching movements…" />
      ) : rows.error ? (
        <ErrorState
          title="Unable to load stock history"
          message={rows.error.message}
          action={
            <Button
              onClick={() => {
                void rows.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <p className="muted-text" data-testid="stock-history-empty">
          No stock movements recorded for this variant yet.
        </p>
      ) : (
        <StockMovementsTable
          rows={items}
          connectionNames={connectionNames}
          layout="variant"
          caption={`Stock history for ${variant.sku ?? variant.id}`}
        />
      )}

      <div className="stock-history__actions">
        <Link
          className="button button--ghost button--sm"
          to={viewAllHref}
          data-testid="stock-history-view-all"
        >
          View all stock movements for this SKU
        </Link>
      </div>
    </div>
  );
}
