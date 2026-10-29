import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { RichTextView } from '../../shared/ui';
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
import {
  buildStockRows,
  deriveRowStatus,
  StockAlerts,
  StockCorrectionDialog,
  StockHistorySection,
  summarizeStock,
  useConnectionNames,
  useStockViewQuery,
  type ProductStockModel,
  type StockAdjustTarget,
} from '../../features/inventory';
import { ApiError } from '../../shared/api/api-error';
import { useConnectionsQuery, type Connection } from '../../features/connections';
import { usePermission, useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { VariantStockTable, VariantDetailPanel } from './variant-stock-table';
import { MarketplacePickerModal } from './marketplace-picker-modal';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from '../../features/products';

/**
 * What the product's headline stock figures say. Available to promise when the
 * stock view can be read (the panel's own number), the master count only for a
 * session that may not read the view, and never a number when OpenLinker does
 * not know - "Unknown" is not zero.
 */
type HeadlineStock =
  | { kind: 'loading' }
  | { kind: 'unknown' }
  | { kind: 'atp'; quantity: number }
  | { kind: 'master'; quantity: number };

const VIEW_PARAM = 'view';
const VIEW_OVERVIEW = 'overview';
const VIEW_CONTENT = 'content';

function deriveAvailableTone(totalAvailable: number, shortCount: number): KpiCardTone {
  if (totalAvailable <= 0) return 'error';
  if (shortCount > 0) return 'warning';
  if (totalAvailable <= DEFAULT_LOW_STOCK_THRESHOLD) return 'warning';
  return 'success';
}

export function ProductDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useProductQuery(id);
  const inventoryQuery = useInventoryQuery({ productId: id });
  const canReadStockView = usePermission('inventory:read');
  // One cache entry, one request: the headline, the alerts and every row of the
  // variants table read this same stock view.
  const stockViewQuery = useStockViewQuery(id, { enabled: canReadStockView });
  const connectionNames = useConnectionNames();
  const [historyVariantId, setHistoryVariantId] = useState<string | null>(null);

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
  const canAdjustStock = usePermission('inventory:write');
  const [adjustTarget, setAdjustTarget] = useState<StockAdjustTarget | null>(null);
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

  const totalAvailable = inventoryItems.reduce((sum, item) => sum + item.availableQuantity, 0);
  const stockForbidden = stockViewQuery.error instanceof ApiError && stockViewQuery.error.isForbidden();
  // To sell is an inventory:read figure. A session without it (or one the server
  // refuses mid-session) sees the shop's own count and a plain notice - not
  // "not known, try again", which a retry never fixes.
  const stockRestricted = !canReadStockView || stockForbidden;
  const stockPending = !stockRestricted && stockViewQuery.isPending && !stockViewQuery.isError;
  const stockView = stockRestricted ? null : (stockViewQuery.data ?? null);
  const masterConnectionId = product.externalIds?.[0]?.connectionId ?? null;
  const stockRows = buildStockRows({
    variants,
    inventoryItems,
    stockByVariant: stockView ? new Map(stockView.variants.map((v) => [v.productVariantId, v])) : null,
    pending: stockPending,
    restricted: stockRestricted,
    canAdjust: canAdjustStock,
    fallbackMasterName: masterConnectionId ? (connectionNames.get(masterConnectionId) ?? null) : null,
  });
  const stockModel: ProductStockModel = {
    rows: stockRows,
    channelsStatus: stockView?.channelsStatus ?? 'ok',
    canAdjust: canAdjustStock,
    onAdjust: setAdjustTarget,
    onShowHistory: (variantId) => {
      setHistoryVariantId(variantId);
      const section = document.getElementById('stock-history');
      if (section && typeof section.scrollIntoView === 'function') {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
  };
  const shortCount = [...stockRows.values()].filter((row) => deriveRowStatus(row).kind === 'short').length;
  const productMasterName = [...stockRows.values()].find((row) => row.sourceNames.length > 0)?.masterName
    ?? (masterConnectionId ? (connectionNames.get(masterConnectionId) ?? null) : null);
  const stockSummary = stockView ? summarizeStock(stockView.variants) : null;
  const staleSync = stockView?.variants.some((v) => v.isStaleSync) ?? false;
  let headline: HeadlineStock;
  if (stockRestricted) headline = { kind: 'master', quantity: totalAvailable };
  else if (stockPending) headline = { kind: 'loading' };
  else if (
    stockSummary !== null &&
    stockSummary.availableToPromise !== null &&
    // A variant the view does not name is a variant OpenLinker cannot vouch for.
    variants.every((variant) => stockView?.variants.some((v) => v.productVariantId === variant.id))
  ) {
    headline = { kind: 'atp', quantity: stockSummary.availableToPromise };
  } else headline = { kind: 'unknown' };
  const headlineQuantity = headline.kind === 'atp' || headline.kind === 'master' ? headline.quantity : null;
  const availableTone: KpiCardTone =
    headlineQuantity === null ? 'neutral' : deriveAvailableTone(headlineQuantity, shortCount);
  const stockStatus = headlineQuantity === null ? null : deriveStockStatus(headlineQuantity);

  // Distinct stock locations across the product's inventory rows (fallback 1
  // when the master reports no location). Feeds the Available KPI sub-line.
  const distinctLocationCount =
    new Set(
      inventoryItems
        .map((item) => item.locationId)
        .filter((locationId): locationId is string => locationId !== null),
    ).size || 1;
  const availableDescription = `across ${distinctLocationCount} location${distinctLocationCount === 1 ? '' : 's'}`;

  const isSingleVariant = variants.length === 1;

  const totalListings = variants.reduce(
    (sum, variant) => sum + (listingsCounts[variant.id] ?? 0),
    0,
  );

  return (
    <PageLayout
      backTo={{ to: '/products', label: 'Products', 'data-testid': 'stock-back-to-products' }}
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
                {stockStatus !== null ? (
                  <StatusBadge compact withDot tone={STOCK_STATUS_BADGE_TONE[stockStatus]}>
                    {STOCK_STATUS_LABEL[stockStatus]}
                  </StatusBadge>
                ) : (
                  <StatusBadge compact withDot tone="neutral" data-testid="product-stock-badge-unknown">
                    {headline.kind === 'loading' ? 'Checking stock' : 'Stock not known'}
                  </StatusBadge>
                )}
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
                  <span className="product-detail-hero__fact-label">Category</span>
                  {product.categoryBreadcrumb && product.categoryBreadcrumb.length > 0 ? (
                    <span>{product.categoryBreadcrumb.map((node) => node.name).join(' › ')}</span>
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
                label="Price (gross)"
                value={product.price !== null ? product.price.toFixed(2) : '—'}
                description={product.currency ?? undefined}
              />
              <KpiCard
                label="Available"
                tone={availableTone}
                value={
                  <span data-testid="stock-summary-atp">
                    {headlineQuantity ?? (headline.kind === 'loading' ? '…' : '—')}
                  </span>
                }
                description={
                  headline.kind === 'atp' && stockSummary ? (
                    <>
                      to sell ·{' '}
                      <span data-testid="stock-summary-master">
                        {stockSummary.masterStock} in {productMasterName ?? 'the master'}
                      </span>
                      {stockSummary.heldCounted !== null && stockSummary.heldCounted > 0 ? (
                        <>
                          {' · '}
                          <span data-testid="stock-summary-held">{stockSummary.heldCounted} reserved</span>
                        </>
                      ) : null}
                      {shortCount > 0 ? ` · ${shortCount} short` : null}
                    </>
                  ) : headline.kind === 'unknown' ? (
                    'not known right now'
                  ) : headline.kind === 'loading' ? (
                    'working out what you can sell'
                  ) : (
                    availableDescription
                  )
                }
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
                {/* ADR-046: rendered, not printed. This block interpolated the
                    value into a <p>, so React escaped it and a shop description
                    read as a wall of angle brackets. */}
                <RichTextView
                  html={product.description}
                  className="description-block"
                  emptyLabel="No description synced from the source. Draft and publish one per channel in the Content tab."
                />
              </section>
            </div>

            <div className="product-detail__stack">
              {product.features && product.features.length > 0 ? (
                <section className="detail-section" aria-label="Attributes">
                  <h3 className="detail-section__title">Attributes</h3>
                  <div className="attr-chips">
                    {product.features.map((feature) => (
                      <span className="attr-chip" key={`${feature.name}:${feature.value}`}>
                        <b>{feature.name}</b>
                        {feature.value}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}
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
                  ? 'Variants & stock'
                  : `Variants & stock${variants.length > 0 ? ` (${variants.length})` : ''}`}
              </h3>
              {stockSummary?.lastSyncedAt ? (
                <span
                  className="sync-freshness"
                  data-testid="stock-summary-synced"
                  style={staleSync ? { color: 'var(--status-warning-fg)' } : undefined}
                >
                  <span
                    className="sync-freshness__dot"
                    aria-hidden="true"
                    style={staleSync ? { background: 'var(--status-warning-strong)' } : undefined}
                  ></span>
                  Stock synced <TimeDisplay iso={stockSummary.lastSyncedAt} format="time" />
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
            ) : (
              <>
                <StockAlerts
                  rows={stockRows}
                  view={stockView}
                  restricted={stockRestricted}
                  pending={stockPending}
                  canAdjust={canAdjustStock}
                  onRetry={() => {
                    void stockViewQuery.refetch();
                  }}
                  masterConnectionId={masterConnectionId}
                />
                {isSingleVariant ? (
                  <VariantDetailPanel
                    variant={variants[0]!}
                    productTaxRate={product.taxRate ?? null}
                    productTaxRateUnknownReason={product.taxRateUnknownReason ?? null}
                    connections={offerCreatorConnections}
                    onListingsCount={handleListingsCount}
                    stock={stockModel}
                  />
                ) : (
                  <VariantStockTable
                    variants={variants}
                    currency={product.currency}
                    productTaxRate={product.taxRate ?? null}
                    productTaxRateUnknownReason={product.taxRateUnknownReason ?? null}
                    connections={offerCreatorConnections}
                    canCreateOffers={write.visible}
                    onCreateOffers={handleCreateOffers}
                    onListingsCount={handleListingsCount}
                    stock={stockModel}
                  />
                )}
              </>
            )}
          </section>
          {canAdjustStock ? (
            <StockCorrectionDialog target={adjustTarget} onClose={() => setAdjustTarget(null)} />
          ) : null}
          <StockHistorySection
            productId={product.id}
            productName={product.name}
            variants={variants}
            selectedVariantId={historyVariantId}
            onSelectedVariantChange={setHistoryVariantId}
          />
        </TabsContent>

        <TabsContent value={VIEW_CONTENT}>
          <ContentEditor productId={product.id} />
        </TabsContent>
      </Tabs>

      <MarketplacePickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        productCount={1}
        // Single-product offer creation stays marketplace-only here; shop
        // publishing from the product detail page is #1830 (shop edit mode).
        destinations={offerCreatorConnections.map((c) => ({
          connection: c,
          kind: 'marketplace' as const,
        }))}
        onContinue={(connectionId) => {
          setPickerOpen(false);
          goToWizard(connectionId);
        }}
      />
    </PageLayout>
  );
}
