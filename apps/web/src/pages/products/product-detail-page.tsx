import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { EntityLabel } from '../../shared/ui/entity-label';
import { KpiCard, type KpiCardTone } from '../../shared/ui/kpi-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { ContentEditor } from '../../features/content/components/content-editor';
import { useProductQuery } from '../../features/products/hooks/use-product-query';
import { ProductGallery } from '../../features/products/components/product-gallery';
import { ProductSourceSection } from '../../features/products/components/product-source-section';
import { useInventoryQuery } from '../../features/inventory/hooks/use-inventory-query';
import { useConnectionsQuery, type Connection } from '../../features/connections';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { VariantStockTable, VariantDetailPanel } from './variant-stock-table';
import { MarketplacePickerModal } from './marketplace-picker-modal';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from './product-stock-status';

const VIEW_PARAM = 'view';
const VIEW_OVERVIEW = 'overview';
const VIEW_CONTENT = 'content';

function formatPrice(price: number | null, currency: string | null): ReactNode {
  if (price === null) {
    return <span className="text-muted">—</span>;
  }
  if (currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  }
  return (
    <span className="text-muted" title="Currency unknown">
      {price.toFixed(2)}
    </span>
  );
}

function deriveAvailableTone(totalAvailable: number, oversoldCount: number): KpiCardTone {
  if (totalAvailable <= 0) return 'error';
  if (oversoldCount > 0) return 'warning';
  if (totalAvailable <= DEFAULT_LOW_STOCK_THRESHOLD) return 'warning';
  return 'success';
}

export function ProductDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useProductQuery(id);
  const inventoryQuery = useInventoryQuery({ productId: id });

  const activeView = searchParams.get(VIEW_PARAM) === VIEW_CONTENT ? VIEW_CONTENT : VIEW_OVERVIEW;
  const setActiveView = useCallback(
    (value: string): void => {
      const next = new URLSearchParams(searchParams);
      if (value === VIEW_OVERVIEW) {
        next.delete(VIEW_PARAM);
      } else {
        next.set(VIEW_PARAM, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [listingsCounts, setListingsCounts] = useState<Record<string, number>>({});
  const handleListingsCount = useCallback((variantId: string, count: number) => {
    setListingsCounts((prev) => (prev[variantId] === count ? prev : { ...prev, [variantId]: count }));
  }, []);

  // Create-offer launch (mirrors products-list-page #1096): target connections
  // by the OfferCreator capability — never a literal platformType. The CTA is
  // gated on `listings:write` (demo viewers see it and hit the gated confirm).
  const navigate = useNavigate();
  const connectionsQuery = useConnectionsQuery();
  const demoMode = useDemoMode();
  const write = useWriteAccess('listings:write', demoMode);
  const [pickerOpen, setPickerOpen] = useState(false);
  const offerCreatorConnections = useMemo<Connection[]>(
    () =>
      (connectionsQuery.data ?? [])
        .filter((c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferCreator'))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [connectionsQuery.data],
  );
  const goToWizard = useCallback(
    (connectionId?: string): void => {
      const params = new URLSearchParams({ productIds: id });
      if (connectionId) params.set('connectionId', connectionId);
      void navigate(`/listings/bulk-create/wizard?${params.toString()}`);
    },
    [id, navigate],
  );
  const handleCreateOffers = useCallback((): void => {
    if (offerCreatorConnections.length === 1) {
      goToWizard(offerCreatorConnections[0]!.id);
    } else if (offerCreatorConnections.length > 1) {
      setPickerOpen(true);
    }
  }, [offerCreatorConnections, goToWizard]);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Products" title="Product detail">
        <LoadingState liveRegion="off" title="Loading product" message="Fetching product details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Products" title="Product detail">
        <ErrorState
          title="Unable to load product"
          message={query.error?.message ?? 'Product not found'}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      </PageLayout>
    );
  }

  const product = query.data;
  const variants = product.variants ?? [];
  const inventoryItems = inventoryQuery.data?.items ?? [];

  const stockByVariant = new Map(
    inventoryItems.filter((item) => item.productVariantId !== null).map((item) => [item.productVariantId as string, item]),
  );

  const totalAvailable = inventoryItems.reduce((sum, item) => sum + item.availableQuantity, 0);
  const oversoldCount = inventoryItems.filter((item) => item.availableQuantity < 0).length;
  const availableTone = deriveAvailableTone(totalAvailable, oversoldCount);
  const stockStatus = deriveStockStatus(totalAvailable);

  // Distinct stock locations across the product's inventory rows (fallback 1
  // when the master reports no location). Feeds the Available KPI sub-line.
  const distinctLocationCount =
    new Set(
      inventoryItems
        .map((item) => item.locationId)
        .filter((locationId): locationId is string => locationId !== null),
    ).size || 1;
  const availableDescription =
    oversoldCount > 0
      ? `${oversoldCount} oversold`
      : `across ${distinctLocationCount} location${distinctLocationCount === 1 ? '' : 's'}`;

  const isSingleVariant = variants.length === 1;

  const totalListings = variants.reduce(
    (sum, variant) => sum + (listingsCounts[variant.id] ?? 0),
    0,
  );

  const latestStockSync = inventoryItems.reduce<string | null>((latest, item) => {
    if (!latest || item.updatedAt > latest) return item.updatedAt;
    return latest;
  }, null);

  return (
    <PageLayout
      backTo={{ to: '/products', label: 'Products' }}
      eyebrow="Products"
      title={<EntityLabel id={product.id} name={product.name} />}
    >
      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList aria-label="Product views">
          <TabsTrigger value={VIEW_OVERVIEW}>Overview</TabsTrigger>
          <TabsTrigger value={VIEW_CONTENT}>Content</TabsTrigger>
        </TabsList>

        <TabsContent value={VIEW_OVERVIEW}>
          <section className="product-detail-hero" aria-label="Product summary">
            <ProductGallery images={product.images ?? []} name={product.name} />
            <div className="product-detail-hero__body">
              <div className="product-detail-hero__badges">
                <StatusBadge compact withDot tone={STOCK_STATUS_BADGE_TONE[stockStatus]}>
                  {STOCK_STATUS_LABEL[stockStatus]}
                </StatusBadge>
                <StatusBadge compact tone="neutral">
                  {variants.length} variant{variants.length === 1 ? '' : 's'}
                </StatusBadge>
                <StatusBadge compact tone="info">
                  {totalListings} listing{totalListings === 1 ? '' : 's'}
                </StatusBadge>
              </div>
              <h3 className="product-detail-hero__title">{product.name}</h3>
              <code className="product-detail-hero__id mono-text" title={product.id}>
                {product.id}
              </code>
              <div className="product-detail-hero__facts">
                <span className="product-detail-hero__fact">
                  <span className="product-detail-hero__fact-label">SKU</span>
                  {product.sku ? (
                    <span className="mono-text">{product.sku}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </span>
                <span className="product-detail-hero__fact">
                  <span className="product-detail-hero__fact-label">Created</span>
                  <TimeDisplay className="mono-text tabular" iso={product.createdAt} />
                </span>
                <span className="product-detail-hero__fact">
                  <span className="product-detail-hero__fact-label">Catalog updated</span>
                  <TimeDisplay className="mono-text tabular" iso={product.updatedAt} />
                </span>
              </div>
            </div>
          </section>

          <section className="detail-section" aria-label="At a glance">
            <h3 className="detail-section__title">At a glance</h3>
            <div className="product-detail__kpi-row product-detail__kpi-row--cols-4">
              <KpiCard
                label="Price"
                value={formatPrice(product.price, product.currency)}
                description={product.currency ?? undefined}
              />
              <KpiCard
                label="Available"
                tone={availableTone}
                value={totalAvailable}
                description={availableDescription}
              />
              <KpiCard label="Variants" value={variants.length} />
              <KpiCard label="Listings" value={totalListings} />
            </div>
          </section>

          <div className="product-detail__primary-grid--split">
            <div className="product-detail__stack">
              <section className="detail-section">
                <div className="detail-section__title-row">
                  <h3 className="detail-section__title">
                    Description{' '}
                    <StatusBadge tone="neutral" compact>
                      Source · read-only
                    </StatusBadge>
                  </h3>
                  <Link className="detail-section__edit-link" to="?view=content">
                    Edit in Content →
                  </Link>
                </div>
                {product.description ? (
                  <p className="description-block">{product.description}</p>
                ) : (
                  <p className="text-muted">
                    No description synced from the source. Draft and publish one per channel in the
                    Content tab.
                  </p>
                )}
              </section>
            </div>

            <div className="product-detail__stack">
              <section className="detail-section">
                <h3 className="detail-section__title">Source</h3>
                <ProductSourceSection
                  mappings={product.externalIds ?? []}
                  connections={connectionsQuery.data ?? []}
                />
              </section>
            </div>
          </div>

          <section className="detail-section">
            <div className="detail-section__title-row">
              <h3 className="detail-section__title">
                {isSingleVariant
                  ? 'Listed on'
                  : `Variants & stock${variants.length > 0 ? ` (${variants.length})` : ''}`}
              </h3>
              {latestStockSync ? (
                <span className="sync-freshness">
                  <span className="sync-freshness__dot" aria-hidden="true"></span>
                  Stock synced <TimeDisplay iso={latestStockSync} />
                </span>
              ) : null}
            </div>
            {inventoryQuery.isLoading ? (
              <LoadingState
                liveRegion="off"
                title="Loading stock"
                message="Fetching inventory data…"
              />
            ) : inventoryQuery.error ? (
              <ErrorState
                title="Unable to load stock"
                message={inventoryQuery.error.message}
                action={
                  <Button onClick={() => { void inventoryQuery.refetch(); }}>Retry</Button>
                }
              />
            ) : variants.length === 0 ? (
              <p className="text-muted">No variants found for this product.</p>
            ) : isSingleVariant ? (
              <VariantDetailPanel
                variant={variants[0]!}
                stock={stockByVariant.get(variants[0]!.id)}
                connections={offerCreatorConnections}
                onListingsCount={handleListingsCount}
              />
            ) : (
              <VariantStockTable
                variants={variants}
                stockByVariant={stockByVariant}
                currency={product.currency}
                connections={offerCreatorConnections}
                canCreateOffers={write.visible}
                onCreateOffers={handleCreateOffers}
                onListingsCount={handleListingsCount}
              />
            )}
          </section>
        </TabsContent>

        <TabsContent value={VIEW_CONTENT}>
          <ContentEditor productId={product.id} />
        </TabsContent>
      </Tabs>

      <MarketplacePickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        productCount={1}
        connections={offerCreatorConnections}
        onContinue={(connectionId) => {
          setPickerOpen(false);
          goToWizard(connectionId);
        }}
      />
    </PageLayout>
  );
}
