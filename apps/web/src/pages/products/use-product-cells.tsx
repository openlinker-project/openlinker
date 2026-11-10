/**
 * Product cells and the product peek view (#4027, #4026 follow-up)
 *
 * The renderers a product row and its peek share - stock, the stock badge,
 * listings coverage, the deleted-at-source flag, the origin chip - and
 * `buildPeekView`, which assembles a `ProductPeekView` from them. The products
 * list and the order peek's product drawer both use this, so a product reads
 * the same wherever it opens.
 *
 * @module apps/web/src/pages/products
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { StatusBadge } from '../../shared/ui/status-badge';
import { usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import { formatAmount } from '../../shared/format/format-amount';
import type { Product } from '../../features/products/api/products.types';
import {
  ConnectionChip,
  readConnectionEnvironment,
  useConnectionsQuery,
} from '../../features/connections';
import type { Connection, ConnectionChipChannel } from '../../features/connections';
import { selectPublishDestinations } from '../../features/listings';
import {
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from '../../features/products';
import { deriveAtpStatus } from '../../features/inventory';
import { deriveProductStaleness } from '../../features/products/lib/product-staleness';
import { interpolate, useFormat, useMessages, usePlural, type Formatters } from '../../shared/i18n';
import { ListingsCoveragePills } from './listings-coverage-pills';
import { ProductRowDetail } from './product-row-detail';
import { ProductTaxRateBadge, type ProductPeekView } from './product-peek';

// When currency is missing, the raw amount is shown muted with a hover-reveal
// rather than silently emitting a bare decimal — explicit ambiguity is safer.
export function formatPrice(
  price: number | null,
  currency: string | null,
  currencyUnknownLabel: string,
  format: Formatters
): ReactNode {
  if (price === null) {
    return <span className="text-muted">-</span>;
  }
  if (currency) {
    return formatAmount(price, currency);
  }
  return (
    <span className="text-muted" title={currencyUnknownLabel}>
      {format.number(price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export interface BuildProductPeekViewOptions {
  /** Present only when the operator may publish; the view decides when a gap exists. */
  onPublish?: (productId: string) => void;
  /** Whether the peek's "+ Create offer" CTAs render (write access, incl. demo read-only). */
  canCreateOffers: boolean;
}

export function useProductCells() {
  const copy = useMessages('products').productsListPage;
  const bundleCopy = useMessages('bundles');
  const format = useFormat();
  const plural = usePlural();
  const platforms = usePlatforms();
  const connectionsQuery = useConnectionsQuery();
  const offerManagerConnections = useMemo<Connection[]>(
    () =>
      (connectionsQuery.data ?? [])
        // OfferCreator (not coarse OfferManager, #1498): a quantity-only
        // OfferManager (WooCommerce stock write-back) must not surface in
        // offer-creation flows.
        .filter((c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferCreator'))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [connectionsQuery.data]
  );

  // Unified publish targets (#1828): offer marketplaces (OfferCreator) OR
  // online shops (ProductPublisher), capability-driven. Drives the publish
  // CTAs + picker. The gaps KPI / "Unlisted on" chips / per-row gap detection
  // stay keyed to the marketplace `offerManagerConnections` subset above -
  // "gap" is a narrower, offer-specific concept. The coverage PILLS, however,
  // answer "is this published anywhere" and must include shop destinations
  // too (#1838 follow-up fix - a product published to a WooCommerce
  // connection previously rendered no pill at all).
  const publishDestinations = useMemo(
    () => selectPublishDestinations(connectionsQuery.data ?? []),
    [connectionsQuery.data]
  );
  const hasShopDestination = useMemo(
    () => publishDestinations.some((d) => d.kind === 'shop'),
    [publishDestinations]
  );
  // Coverage-pill connection set (#1838 follow-up fix): every active publish
  // destination (marketplace OR shop) - the same union `publishDestinations`
  // already resolves, since a connection carries at most one listing-mapping
  // kind (#1837) so it can never double-count here either.
  const coveragePillConnections = useMemo(
    () => publishDestinations.map((d) => d.connection),
    [publishDestinations]
  );

  // One batched read, indexed once — the Source column's `ConnectionCell` must
  // never cost a request per row (#1996). A whole `Connection` structurally
  // satisfies `ConnectionCellFacts` (`{ name, status }`), so this existing map
  // feeds the cell directly rather than growing a second, parallel index.
  const connectionById = useMemo(() => {
    const map = new Map<string, Connection>();
    (connectionsQuery.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [connectionsQuery.data]);

  // The origin chip's channel (#3670): the registry's short label for the face,
  // and the connection's environment so a sandbox source never reads the same
  // as its production twin. The platformType comes off the product's own
  // external-id row, so the chip renders even while the connection itself is
  // still unresolved.
  const originChipChannel = useCallback(
    (origin: { connectionId: string; platformType: string }): ConnectionChipChannel => ({
      platformType: origin.platformType,
      label: resolvePlatformLabel(platforms, origin.platformType),
      shortLabel: resolvePlatformShortLabel(platforms, origin.platformType),
      environment: readConnectionEnvironment(connectionById.get(origin.connectionId)?.config),
    }),
    [platforms, connectionById]
  );

  /**
   * Row gap detection for the per-row CTA: any active OfferCreator connection
   * covering fewer variants than the product has. Requires the BE-enriched
   * `variantCount`; rows without it (older payloads) render no CTA.
   */
  const hasListingGap = useCallback(
    (product: Product): boolean => {
      const variantCount = product.variantCount ?? 0;
      if (variantCount === 0 || offerManagerConnections.length === 0) return false;
      const listedByConnection = new Map(
        (product.listingsCoverage ?? []).map((c) => [c.connectionId, c.listedVariants])
      );
      return offerManagerConnections.some(
        (c) => (listedByConnection.get(c.id) ?? 0) < variantCount
      );
    },
    [offerManagerConnections]
  );

  const renderStockCell = useCallback(
    (product: Product): ReactNode => {
      // #3569 - available to promise leads when the list carries it. `null` is
      // "OpenLinker does not know", so it is never drawn as 0 or as Out of stock.
      if (product.availableToPromise !== undefined) {
        const atpStatus = deriveAtpStatus(product.availableToPromise);
        return (
          <span
            className="products-cell-stack"
            data-testid={`stock-list-cell-${product.sku ?? product.id}`}
          >
            {product.availableToPromise === null && product.bundle ? (
              <StatusBadge
                tone="warning"
                withDot
                compact
                data-testid={`bundle-list-reason-badge-${product.sku ?? product.id}`}
              >
                {bundleCopy.list.availabilityUnknown}
              </StatusBadge>
            ) : product.availableToPromise === null ? (
              <span className="av-unknown" title={copy.stock.notKnownTitle}>
                {copy.stock.notKnown}
              </span>
            ) : (
              <span>
                <span
                  className="products-stock-value mono tabular"
                  data-testid={
                    product.bundle ? `bundle-list-available-${product.sku ?? product.id}` : undefined
                  }
                >
                  {product.availableToPromise}
                </span>{' '}
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                  {copy.stock.toSell}
                </span>
              </span>
            )}
            {atpStatus === 'unknown' ? (
              <StatusBadge tone="neutral" withDot compact>
                {copy.stock.notKnown}
              </StatusBadge>
            ) : (
              <StatusBadge tone={STOCK_STATUS_BADGE_TONE[atpStatus]} withDot compact>
                {STOCK_STATUS_LABEL[atpStatus]}
              </StatusBadge>
            )}
            {product.availableToPromise === null && product.bundle ? (
              <span
                className="text-muted products-cell-sub"
                data-testid={`bundle-list-reason-${product.sku ?? product.id}`}
              >
                {product.bundle.unknownComponent !== null
                  ? interpolate(bundleCopy.list.unknownReason, {
                      name: product.name,
                      component:
                        product.bundle.unknownComponent.name ??
                        product.bundle.unknownComponent.sku ??
                        '',
                    })
                  : interpolate(bundleCopy.list.unknownReasonGeneric, { name: product.name })}
              </span>
            ) : null}
            {product.totalAvailable !== undefined ? (
              <span className="text-muted products-cell-sub tabular">
                {interpolate(copy.stock.master, { n: format.number(product.totalAvailable) })}
              </span>
            ) : null}
          </span>
        );
      }
      if (product.totalAvailable === undefined) {
        return <span className="text-muted">-</span>;
      }
      const status = deriveStockStatus(product.totalAvailable);
      return (
        <span className="products-cell-stack">
          <span className="products-stock-value mono tabular">{product.totalAvailable}</span>
          <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
            {STOCK_STATUS_LABEL[status]}
          </StatusBadge>
          {(product.totalReserved ?? 0) > 0 ? (
            <span className="text-muted products-cell-sub tabular">
              {interpolate(copy.stock.reserved, { n: format.number(product.totalReserved ?? 0) })}
            </span>
          ) : null}
        </span>
      );
    },
    [bundleCopy, copy, format]
  );

  /** The product's stock state as one badge (the peek header). */
  const renderStockBadge = useCallback(
    (product: Product): ReactNode => {
      const n =
        product.availableToPromise !== undefined
          ? product.availableToPromise
          : product.totalAvailable;
      if (n === undefined) return null;
      if (n === null) {
        return (
          <StatusBadge tone="neutral" withDot compact>
            {copy.stock.notKnown}
          </StatusBadge>
        );
      }
      const status = deriveStockStatus(n);
      return (
        <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
          {STOCK_STATUS_LABEL[status]}
        </StatusBadge>
      );
    },
    [copy]
  );

  const renderCoveragePills = useCallback(
    (product: Product): ReactNode => (
      <ListingsCoveragePills
        coverage={product.listingsCoverage}
        variantCount={product.variantCount ?? 0}
        connections={coveragePillConnections}
      />
    ),
    [coveragePillConnections]
  );

  /**
   * #2447 — deleted-at-source flag, shared by the desktop row and the mobile
   * card meta. "some" (warning) vs "all" (error) so a partially-live
   * multi-variant product doesn't read as fully gone.
   */
  const renderStalenessBadge = useCallback((product: Product): ReactNode => {
    const staleness = deriveProductStaleness(product);
    if (!staleness) return null;
    return (
      <StatusBadge tone={staleness.tone} withDot compact>
        {staleness.label}
      </StatusBadge>
    );
  }, []);

  const buildPeekView = useCallback(
    (
      product: Product,
      { onPublish, canCreateOffers }: BuildProductPeekViewOptions
    ): ProductPeekView => ({
      product,
      source: product.externalIds?.[0] ? (
        <ConnectionChip
          connectionId={product.externalIds[0].connectionId}
          name={connectionById.get(product.externalIds[0].connectionId)?.name ?? null}
          loading={connectionsQuery.isLoading}
          channel={originChipChannel(product.externalIds[0])}
        />
      ) : null,
      variants:
        (product.variantCount ?? 0) > 1
          ? plural(product.variantCount ?? 0, copy.row.variantsBadge)
          : null,
      price: formatPrice(product.price, product.currency, copy.price.currencyUnknown, format),
      stockBadge: renderStockBadge(product),
      stock: renderStockCell(product),
      listings: renderCoveragePills(product),
      taxRate: (
        <>
          <ProductTaxRateBadge product={product} />
          {renderStalenessBadge(product)}
        </>
      ),
      onPublish:
        onPublish && (hasListingGap(product) || hasShopDestination)
          ? () => {
              onPublish(product.id);
            }
          : undefined,
      detail: (
        <ProductRowDetail
          product={product}
          connections={offerManagerConnections}
          canCreateOffers={canCreateOffers}
          onCreateOffers={(productId) => {
            onPublish?.(productId);
          }}
        />
      ),
    }),
    [
      connectionById,
      connectionsQuery.isLoading,
      originChipChannel,
      plural,
      copy,
      format,
      renderStockBadge,
      renderStockCell,
      renderCoveragePills,
      renderStalenessBadge,
      hasListingGap,
      hasShopDestination,
      offerManagerConnections,
    ]
  );

  return {
    connectionsQuery,
    offerManagerConnections,
    publishDestinations,
    hasShopDestination,
    coveragePillConnections,
    connectionById,
    originChipChannel,
    hasListingGap,
    renderStockCell,
    renderStockBadge,
    renderCoveragePills,
    renderStalenessBadge,
    buildPeekView,
  };
}
