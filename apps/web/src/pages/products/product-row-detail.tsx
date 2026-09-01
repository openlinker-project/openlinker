/**
 * Product Row Detail
 *
 * Expandable-drawer body for the products cockpit (#1720), matching the
 * approved mockup: a links strip, a 4-up field grid (internal id / source
 * external id / currency / stock freshness), then a compact per-variant
 * list with a per-connection listings breakdown (one pill per active
 * OfferCreator connection, or a "+ Create offer" CTA when that connection
 * has no mapping for the variant). Mounted only when a row is expanded (or
 * an in-card disclosure is open), so its queries fire lazily.
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement } from 'react';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useProductQuery } from '../../features/products/hooks/use-product-query';
import { useInventoryQuery } from '../../features/inventory/hooks/use-inventory-query';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import { OfferPublicationStatusPanel } from '../../features/listings/components/offer-publication-status-panel';
import { ProductDetailFields, ProductDetailLinks } from '../../features/products';
import type { Product, ProductVariant } from '../../features/products/api/products.types';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';
import type { Connection } from '../../features/connections';
import { usePlatforms } from '../../shared/plugins';
import { findPlatformDisplayName } from '../../features/mappings';
import {
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from './product-stock-status';

export interface ProductRowDetailProps {
  product: Product;
  /** Active OfferCreator connections - the per-variant pill set is derived from these. */
  connections: readonly Connection[];
  /** Whether the "+ Create offer" CTA should render (write access, incl. demo read-only). */
  canCreateOffers: boolean;
  onCreateOffers: (productId: string) => void;
}

export function ProductRowDetail({
  product,
  connections,
  canCreateOffers,
  onCreateOffers,
}: ProductRowDetailProps): ReactElement {
  const productQuery = useProductQuery(product.id);
  const inventoryQuery = useInventoryQuery({ productId: product.id });

  const linksStrip = <ProductDetailLinks productId={product.id} />;
  const fieldsGrid = <ProductDetailFields productId={product.id} product={product} />;

  if (productQuery.isLoading || inventoryQuery.isLoading) {
    return (
      <div className="products-row-detail">
        {linksStrip}
        <LoadingState liveRegion="off" title="Loading variants" message="Fetching variant stock..." />
      </div>
    );
  }

  if (productQuery.error || !productQuery.data) {
    return (
      <div className="products-row-detail">
        {linksStrip}
        <ErrorState
          title="Unable to load variants"
          message={productQuery.error?.message ?? 'Product not found'}
        />
      </div>
    );
  }

  if (inventoryQuery.error) {
    return (
      <div className="products-row-detail">
        {linksStrip}
        <ErrorState title="Unable to load stock" message={inventoryQuery.error.message} />
      </div>
    );
  }

  const variants = productQuery.data.variants ?? [];
  const inventoryItems = inventoryQuery.data?.items ?? [];
  const stockByVariant = new Map<string, InventoryItem>(
    inventoryItems
      .filter((item) => item.productVariantId !== null)
      .map((item) => [item.productVariantId as string, item]),
  );

  return (
    <div className="products-row-detail">
      {linksStrip}
      {fieldsGrid}
      <div className="products-detail-variants">
        <div className="products-detail-field__label">
          Variants &amp; stock{variants.length > 0 ? ` (${variants.length})` : ''}
        </div>
        {variants.length === 0 ? (
          <p className="text-muted">No variants found for this product.</p>
        ) : (
          <div className="products-variant-list">
            {variants.map((variant) => (
              <ProductVariantRow
                key={variant.id}
                variant={variant}
                stock={stockByVariant.get(variant.id)}
                connections={connections}
                canCreateOffers={canCreateOffers}
                onCreateOffer={() => { onCreateOffers(product.id); }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="products-detail-publication-status">
        <div className="products-detail-field__label">Live marketplace status</div>
        <OfferPublicationStatusPanel productId={product.id} />
      </div>
    </div>
  );
}

function ProductVariantRow({
  variant,
  stock,
  connections,
  canCreateOffers,
  onCreateOffer,
}: {
  variant: ProductVariant;
  stock: InventoryItem | undefined;
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffer: () => void;
}): ReactElement {
  const platforms = usePlatforms();
  // A variant realistically has a handful of listings (one per connection) -
  // 50 comfortably covers every real install without pagination.
  const listingsQuery = useListingsQuery({ internalId: variant.id }, { limit: 50, offset: 0 });
  const listings = listingsQuery.data?.items ?? [];
  const listedConnectionIds = new Set(listings.map((l) => l.connectionId));

  const available = stock?.availableQuantity ?? 0;
  const reserved = stock?.reservedQuantity ?? 0;
  const status = deriveStockStatus(available);

  const attrs = variant.attributes && Object.keys(variant.attributes).length > 0
    ? Object.entries(variant.attributes)
        .map(([key, value]: [string, string]) => `${key}: ${value}`)
        .join(', ')
    : (variant.sku ?? variant.id);

  const metaParts = [
    variant.ean ? `EAN ${variant.ean}` : null,
    variant.sku,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="products-variant-row">
      <div className="products-variant-row__id">
        <span className="products-variant-row__attrs">{attrs}</span>
        {metaParts.length > 0 ? (
          <span className="products-variant-row__meta mono-text">{metaParts.join(' · ')}</span>
        ) : null}
      </div>
      {/* #2447 — the master deleted this specific variant; its offers are
          auto-paused (#1689), so stock/listings below are historical. */}
      {variant.isStale ? (
        <StatusBadge tone="error" withDot compact>
          Deleted at source
        </StatusBadge>
      ) : (
        <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
          {STOCK_STATUS_LABEL[status]}
        </StatusBadge>
      )}
      <span className="products-variant-row__stock mono tabular">
        {available}
        <span className="products-variant-row__stock-reserved">/ res {reserved}</span>
      </span>
      <div className="products-variant-row__listings">
        {connections
          .filter((connection) => listedConnectionIds.has(connection.id))
          .map((connection) => {
            const soleOfPlatform =
              connections.filter((c) => c.platformType === connection.platformType).length === 1;
            const label = soleOfPlatform
              ? (findPlatformDisplayName(platforms, connection) ?? connection.name)
              : connection.name;
            return (
              <span
                key={connection.id}
                className="coverage-pill coverage-pill--full"
                data-channel={connection.platformType}
              >
                {label}
              </span>
            );
          })}
        {/* The CTA opens the same product-level wizard regardless of which
            connection is missing a listing - one button covers every gap,
            not one per gap (#1720 review). */}
        {canCreateOffers && connections.some((c) => !listedConnectionIds.has(c.id)) ? (
          <button type="button" className="products-row-cta" onClick={onCreateOffer}>
            + Create offer
          </button>
        ) : null}
      </div>
    </div>
  );
}
