/**
 * Product Row Detail
 *
 * The body of the product peek (#4027, before that the expanded row of #1720):
 * three titled sections - a variants table (variant, stock, the connections it
 * is listed on with one "+ Create offer" CTA for the gaps), the live marketplace
 * status table and the identifiers as a key-value table. The peek's header carries the Open product / Edit content links.
 * Mounted only while the peek shows the product, so its queries fire lazily.
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement } from 'react';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useProductQuery } from '../../features/products/hooks/use-product-query';
import { useInventoryQuery } from '../../features/inventory/hooks/use-inventory-query';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import { OfferPublicationStatusPanel } from '../../features/listings/components/offer-publication-status-panel';
import {
  deriveStockStatus,
  ProductDetailFields,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from '../../features/products';
import type { Product, ProductVariant } from '../../features/products/api/products.types';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';
import type { Connection } from '../../features/connections';
import { usePlatforms } from '../../shared/plugins';
import { BundleComposition, ProductUsedInBundles } from '../../features/bundles';
import { findPlatformDisplayName } from '../../features/mappings';
import { interpolate, useFormat, useMessages } from '../../shared/i18n';

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
  const copy = useMessages('products').productRowDetail;
  const format = useFormat();
  const productQuery = useProductQuery(product.id);
  const inventoryQuery = useInventoryQuery({ productId: product.id });

  const fieldsGrid = <ProductDetailFields productId={product.id} product={product} />;

  if (productQuery.isLoading || inventoryQuery.isLoading) {
    return (
      <div className="products-row-detail">
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </div>
    );
  }

  if (productQuery.error || !productQuery.data) {
    return (
      <div className="products-row-detail">
        <ErrorState
          title={copy.variantsError.title}
          message={productQuery.error?.message ?? copy.variantsError.notFound}
        />
      </div>
    );
  }

  if (inventoryQuery.error) {
    return (
      <div className="products-row-detail">
        <ErrorState title={copy.stockError} message={inventoryQuery.error.message} />
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

  const variantColumns: DataTableColumn<ProductVariant>[] = [
    {
      id: 'variant',
      header: copy.columns.variant,
      cell: (variant) => <VariantIdentity variant={variant} />,
      lines: 2,
    },
    {
      id: 'stock',
      header: copy.columns.stock,
      align: 'right',
      cell: (variant) => <VariantStock variant={variant} stock={stockByVariant.get(variant.id)} />,
    },
    {
      id: 'listed',
      header: copy.columns.listedOn,
      cell: (variant) => (
        <VariantListedOn
          variant={variant}
          connections={connections}
          canCreateOffers={canCreateOffers}
          onCreateOffer={() => {
            onCreateOffers(product.id);
          }}
        />
      ),
    },
  ];

  return (
    <div className="products-row-detail">
      {product.bundle ? null : (
      <section className="peek-section" aria-labelledby={`${product.id}-variants`}>
        <h3 className="peek-section__title" id={`${product.id}-variants`}>
          {copy.variantsHeading}
          {variants.length > 0 ? (
            <span className="peek-section__count tabular">{format.number(variants.length)}</span>
          ) : null}
        </h3>
        {variants.length === 0 ? (
          <p className="peek-section__empty">{copy.noVariants}</p>
        ) : (
          <DataTable
            className="peek-table"
            caption={copy.variantsHeading}
            columns={variantColumns}
            rows={variants}
            rowKey={(variant) => variant.id}
            cardView={{
              title: (variant) => <VariantIdentity variant={variant} />,
              meta: (variant) => <VariantStock variant={variant} stock={stockByVariant.get(variant.id)} />,
            }}
          />
        )}
      </section>
      )}
      {/* #3624 - what a bundle row is made of; mounted only while the peek is open. */}
      {product.bundle ? (
        <BundleComposition
          variantId={product.bundle.variantId}
          testId={`bundle-list-composition-${product.sku ?? product.id}`}
        />
      ) : null}
      {/* #3624 - the bundles this product is a component of. */}
      <ProductUsedInBundles variantIds={variants.map((variant) => variant.id)} />
      <section className="peek-section" aria-labelledby={`${product.id}-offers`}>
        <h3 className="peek-section__title" id={`${product.id}-offers`}>
          {copy.liveMarketplaceStatus}
        </h3>
        <OfferPublicationStatusPanel
          productId={product.id}
          emptyAction={
            canCreateOffers && connections.length > 0 ? (
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => {
                  onCreateOffers(product.id);
                }}
              >
                {copy.createOffer}
              </button>
            ) : undefined
          }
        />
      </section>
      <section className="peek-section" aria-labelledby={`${product.id}-ids`}>
        <h3 className="peek-section__title" id={`${product.id}-ids`}>
          {copy.identifiersHeading}
        </h3>
        {fieldsGrid}
      </section>
    </div>
  );
}

function VariantIdentity({ variant }: { variant: ProductVariant }): ReactElement {
  const copy = useMessages('products').productRowDetail;
  const attrs =
    variant.attributes && Object.keys(variant.attributes).length > 0
      ? Object.entries(variant.attributes)
          .map(([key, value]: [string, string]) => `${key}: ${value}`)
          .join(', ')
      : (variant.sku ?? variant.id);
  const metaParts = [variant.ean ? interpolate(copy.ean, { ean: variant.ean }) : null, variant.sku].filter(
    (part): part is string => Boolean(part),
  );
  return (
    <span className="products-variant-row__id">
      <span className="products-variant-row__attrs">{attrs}</span>
      {metaParts.length > 0 ? (
        <span className="products-variant-row__meta mono-text">{metaParts.join(' · ')}</span>
      ) : null}
    </span>
  );
}

function VariantStock({
  variant,
  stock,
}: {
  variant: ProductVariant;
  stock: InventoryItem | undefined;
}): ReactElement {
  const copy = useMessages('products').productRowDetail;
  const format = useFormat();
  const available = stock?.availableQuantity ?? 0;
  const reserved = stock?.reservedQuantity ?? 0;
  const status = deriveStockStatus(available);
  return (
    <span className="products-variant-row__stock-cell">
      {/* #2447 - the master deleted this specific variant; its offers are
          auto-paused (#1689), so the stock shown is historical. */}
      {variant.isStale ? (
        <StatusBadge tone="error" withDot compact>
          {copy.deletedAtSource}
        </StatusBadge>
      ) : (
        <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
          {STOCK_STATUS_LABEL[status]}
        </StatusBadge>
      )}
      <span className="products-variant-row__stock tabular">
        {format.number(available)}
        {reserved > 0 ? (
          <span className="products-variant-row__stock-reserved">
            {interpolate(copy.reservedShort, { n: format.number(reserved) })}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function VariantListedOn({
  variant,
  connections,
  canCreateOffers,
  onCreateOffer,
}: {
  variant: ProductVariant;
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffer: () => void;
}): ReactElement {
  const copy = useMessages('products').productRowDetail;
  const platforms = usePlatforms();
  // A variant realistically has a handful of listings (one per connection) -
  // 50 comfortably covers every real install without pagination.
  const listingsQuery = useListingsQuery({ internalId: variant.id }, { limit: 50, offset: 0 });
  const listedConnectionIds = new Set((listingsQuery.data?.items ?? []).map((l) => l.connectionId));
  const listed = connections.filter((connection) => listedConnectionIds.has(connection.id));

  return (
    <span className="products-variant-row__listings">
      {listed.map((connection) => {
        const soleOfPlatform = connections.filter((c) => c.platformType === connection.platformType).length === 1;
        const label = soleOfPlatform
          ? (findPlatformDisplayName(platforms, connection) ?? connection.name)
          : connection.name;
        return (
          <span key={connection.id} className="coverage-pill coverage-pill--full" data-channel={connection.platformType}>
            {label}
          </span>
        );
      })}
      {listed.length === 0 && !(canCreateOffers && connections.length > 0) ? (
        <span className="text-muted">-</span>
      ) : null}
      {/* One CTA opens the product-level wizard whichever connection is
          missing a listing - not one per gap (#1720 review). */}
      {canCreateOffers && connections.some((c) => !listedConnectionIds.has(c.id)) ? (
        <button type="button" className="products-row-cta" onClick={onCreateOffer}>
          {copy.createOffer}
        </button>
      ) : null}
    </span>
  );
}
