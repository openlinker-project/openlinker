import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import type { OfferMapping } from '../../features/listings/api/listings.types';
import type { ProductVariant } from '../../features/products/api/products.types';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge } from '../../shared/ui/status-badge';
import { deriveStockStatus } from './product-stock-status';

interface VariantStockTableProps {
  variants: ProductVariant[];
  stockByVariant: Map<string, InventoryItem>;
  onListingsCount: (variantId: string, count: number) => void;
}

export function VariantStockTable({
  variants,
  stockByVariant,
  onListingsCount,
}: VariantStockTableProps): ReactElement {
  return (
    <div className="data-table__container">
      <table className="data-table">
        <caption className="sr-only">Product variants, stock levels, and marketplace listings</caption>
        <thead>
          <tr>
            <th aria-hidden="true"></th>
            <th>Variant</th>
            <th>EAN</th>
            <th>Attributes</th>
            <th>Available</th>
            <th>Reserved</th>
            <th>Listings</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => (
            <VariantStockRow
              key={variant.id}
              variant={variant}
              stock={stockByVariant.get(variant.id)}
              onListingsCount={onListingsCount}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stockCellClass(availableQuantity: number): string {
  const status = deriveStockStatus(availableQuantity);
  if (status === 'out-of-stock') return 'tabular stock-cell--error';
  if (status === 'low-stock') return 'tabular stock-cell--warning';
  return 'tabular';
}

function VariantStockRow({
  variant,
  stock,
  onListingsCount,
}: {
  variant: ProductVariant;
  stock: InventoryItem | undefined;
  onListingsCount: (variantId: string, count: number) => void;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const listingsQuery = useListingsQuery({ internalId: variant.id }, { limit: 50, offset: 0 });
  const listings = listingsQuery.data?.items ?? [];
  const listingsCount = listingsQuery.data?.total ?? 0;

  useEffect(() => {
    if (listingsQuery.data) {
      onListingsCount(variant.id, listingsQuery.data.total);
    }
  }, [variant.id, listingsQuery.data, onListingsCount]);

  const available = stock?.availableQuantity ?? 0;
  const reserved = stock?.reservedQuantity ?? 0;

  return (
    <>
      <tr>
        <td className="variant-stock-table__expand-cell">
          <button
            type="button"
            className="variant-stock-table__expand-btn"
            aria-expanded={isOpen}
            aria-label={`Toggle listings for ${variant.sku ?? variant.id}`}
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2l4 4-4 4" />
            </svg>
          </button>
        </td>
        <td>
          <div className="variant-stock-table__variant-cell">
            {variant.sku ? (
              <span className="mono-text">{variant.sku}</span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </td>
        <td className="mono-text">{variant.ean ?? <span className="text-muted">—</span>}</td>
        <td className="mono-text">
          {variant.attributes && Object.keys(variant.attributes).length > 0 ? (
            Object.entries(variant.attributes)
              .map(([key, value]: [string, string]) => `${key}: ${value}`)
              .join(', ')
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className={stockCellClass(available)}>{available}</td>
        <td className="tabular">{reserved > 0 ? reserved : <span className="text-muted">0</span>}</td>
        <td>
          <StatusBadge tone="info" compact>
            {listingsCount}
          </StatusBadge>
        </td>
      </tr>
      <tr className={`variant-stock-table__expand-row${isOpen ? ' is-open' : ''}`}>
        <td colSpan={7}>
          <div className="variant-stock-table__expand-content">
            <div className="variant-stock-table__expand-content-inner">
              <div className="listings-panel">
                <p className="listings-panel__title">
                  Listings using this stock{listingsCount > 0 ? ` (${listingsCount})` : ''}
                </p>
                {listingsQuery.isLoading ? (
                  <p className="text-muted">Loading listings…</p>
                ) : listingsQuery.error ? (
                  <p className="text-muted">Couldn&rsquo;t load listings.</p>
                ) : listings.length === 0 ? (
                  <p className="listings-subtable__empty">
                    No marketplace listings reference this variant yet.
                  </p>
                ) : (
                  <ListingsSubtable listings={listings} />
                )}
              </div>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

function ListingsSubtable({ listings }: { listings: OfferMapping[] }): ReactElement {
  return (
    <table className="listings-subtable">
      <thead>
        <tr>
          <th>Platform</th>
          <th>Connection</th>
          <th>External ID</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {listings.map((listing) => (
          <tr key={listing.id}>
            <td>
              <Link className="listings-subtable__link" to={`/listings/${listing.id}`}>
                {listing.platformType}
              </Link>
            </td>
            <td>
              <ConnectionEntityLabel connectionId={listing.connectionId} showId={false} />
            </td>
            <td className="mono-text">
              <Link className="listings-subtable__link" to={`/listings/${listing.id}`}>
                {listing.externalId}
              </Link>
            </td>
            <td className="mono-text tabular">
              <TimeDisplay iso={listing.updatedAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
