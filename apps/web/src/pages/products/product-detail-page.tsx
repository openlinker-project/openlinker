import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import type { KpiCardTone } from '../../shared/ui/kpi-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { ContentEditor } from '../../features/content/components/content-editor';
import { useProductQuery } from '../../features/products/hooks/use-product-query';
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
import { useBundleQuery } from '../../features/bundles/hooks/use-bundle-queries';
import { BundleGuide, BundleGuideButton } from '../../features/bundles/components/bundle-guide';
import { useBundleUsedInManyQuery } from '../../features/bundles/hooks/use-bundle-queries';
import { BundleProductView } from '../../features/bundles/components/bundle-product-view';
import { ProductOverview, ConnectionChips } from './product-overview';
import { VariantStockTable, VariantDetailPanel } from './variant-stock-table';
import { MarketplacePickerModal } from './marketplace-picker-modal';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from '../../features/products';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

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
  const copy = useMessages('products').productDetailPage;
  const format = useFormat();
  const plural = usePlural();
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
  const [moreOpen, setMoreOpen] = useState(false);

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
    [searchParams, setSearchParams]
  );

  const [, setListingsCounts] = useState<Record<string, number>>({});
  const handleListingsCount = useCallback((variantId: string, count: number) => {
    setListingsCounts((prev) =>
      prev[variantId] === count ? prev : { ...prev, [variantId]: count }
    );
  }, []);

  // Create-offer launch (mirrors products-list-page #1096): target connections
  // by the OfferCreator capability — never a literal platformType. The CTA is
  // gated on `listings:write` (demo viewers see it and hit the gated confirm).
  const navigate = useNavigate();
  const connectionsQuery = useConnectionsQuery();
  const demoMode = useDemoMode();
  const write = useWriteAccess('listings:write', demoMode);
  const canAdjustStock = usePermission('inventory:write');
  const bundleCopy = useMessages('bundles');
  const bundleWrite = useWriteAccess('bundles:write', demoMode);
  // A 404 here means "not a bundle" (an answer, not a failure). Only the first
  // variant is asked, so a multi-variant product whose later variant is the
  // bundle still offers the action.
  const bundleProbe = useBundleQuery(query.data?.variants?.[0]?.id);
  const isBundle = bundleProbe.isSuccess;
  const usedInVariantIds = (query.data?.variants ?? []).map((variant) => variant.id);
  const usedIn = useBundleUsedInManyQuery(isBundle ? [] : usedInVariantIds);
  const bundleCount = new Set((usedIn.data ?? []).map((entry) => entry.bundleVariantId)).size;
  const [adjustTarget, setAdjustTarget] = useState<StockAdjustTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const offerCreatorConnections = useMemo<Connection[]>(
    () =>
      (connectionsQuery.data ?? [])
        .filter((c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferCreator'))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [connectionsQuery.data]
  );
  const goToWizard = useCallback(
    (connectionId?: string): void => {
      const params = new URLSearchParams({ productIds: id });
      if (connectionId) params.set('connectionId', connectionId);
      void navigate(`/listings/bulk-create/wizard?${params.toString()}`);
    },
    [id, navigate]
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
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <ErrorState
          title={copy.loadError.title}
          message={query.error ? describeApiError(query.error, 'products') : copy.loadError.notFound}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {copy.retry}
            </Button>
          }
        />
      </PageLayout>
    );
  }

  const product = query.data;
  const variants = product.variants ?? [];
  const inventoryItems = inventoryQuery.data?.items ?? [];

  const totalAvailable = inventoryItems.reduce((sum, item) => sum + item.availableQuantity, 0);
  const stockForbidden =
    stockViewQuery.error instanceof ApiError && stockViewQuery.error.isForbidden();
  // To sell is an inventory:read figure. A session without it (or one the server
  // refuses mid-session) sees the shop's own count and a plain notice - not
  // "not known, try again", which a retry never fixes.
  const stockRestricted = !canReadStockView || stockForbidden;
  const stockPending = !stockRestricted && stockViewQuery.isPending && !stockViewQuery.isError;
  const stockView = stockRestricted ? null : stockViewQuery.data ?? null;
  const masterConnectionId = product.externalIds?.[0]?.connectionId ?? null;
  const stockRows = buildStockRows({
    variants,
    inventoryItems,
    stockByVariant: stockView
      ? new Map(stockView.variants.map((v) => [v.productVariantId, v]))
      : null,
    pending: stockPending,
    restricted: stockRestricted,
    canAdjust: canAdjustStock,
    fallbackMasterName: masterConnectionId ? connectionNames.get(masterConnectionId) ?? null : null,
  });
  const stockModel: ProductStockModel = {
    rows: stockRows,
    channelsStatus: stockView?.channelsStatus ?? 'ok',
    canAdjust: canAdjustStock,
    onAdjust: setAdjustTarget,
    onShowHistory: (variantId) => {
      setHistoryVariantId(variantId);
      setMoreOpen(true);
      // The history lives inside "More"; let it open before scrolling to it.
      window.setTimeout(() => {
        const section = document.getElementById('stock-history');
        if (section && typeof section.scrollIntoView === 'function') {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
    },
  };
  const shortCount = [...stockRows.values()].filter(
    (row) => deriveRowStatus(row).kind === 'short'
  ).length;
  const productMasterName =
    [...stockRows.values()].find((row) => row.sourceNames.length > 0)?.masterName ??
    (masterConnectionId ? connectionNames.get(masterConnectionId) ?? null : null);
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
  const headlineQuantity =
    headline.kind === 'atp' || headline.kind === 'master' ? headline.quantity : null;
  const availableTone: KpiCardTone =
    headlineQuantity === null ? 'neutral' : deriveAvailableTone(headlineQuantity, shortCount);
  const stockStatus = headlineQuantity === null ? null : deriveStockStatus(headlineQuantity);

  // Distinct stock locations across the product's inventory rows (fallback 1
  // when the master reports no location). Feeds the Available KPI sub-line.
  const distinctLocationCount =
    new Set(
      inventoryItems
        .map((item) => item.locationId)
        .filter((locationId): locationId is string => locationId !== null)
    ).size || 1;
  const availableDescription = plural(distinctLocationCount, copy.kpis.acrossLocations, {
    n: format.number(distinctLocationCount),
  });

  const isSingleVariant = variants.length === 1;
  const sourceConnectionId = product.externalIds?.[0]?.connectionId;
  const sourceName =
    (connectionsQuery.data ?? []).find((c) => c.id === sourceConnectionId)?.name ?? null;

  const makeBundleButton = bundleWrite.canWrite ? (
    <Link
      className="button button--secondary button--sm"
      to={`/products/bundles/new?componentProduct=${encodeURIComponent(product.id)}`}
    >
      {bundleCopy.list.makeBundle}
    </Link>
  ) : null;

  const moreBody = (
    <>
      <section className="detail-section" data-testid="variant-detail-section">
        <div className="detail-section__title-row">
          <h3 className="detail-section__title">{copy.overview.detailsHeading}</h3>
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
              {copy.variants.stockSynced}{' '}
              <TimeDisplay iso={stockSummary.lastSyncedAt} format="time" />
            </span>
          ) : null}
        </div>
        {inventoryQuery.isLoading ? (
          <LoadingState
            liveRegion="off"
            title={copy.variants.loading.title}
            message={copy.variants.loading.message}
          />
        ) : inventoryQuery.error ? (
          <ErrorState
            title={copy.variants.loadError}
            message={describeApiError(inventoryQuery.error, 'products')}
            action={
              <Button
                onClick={() => {
                  void inventoryQuery.refetch();
                }}
              >
                {copy.retry}
              </Button>
            }
          />
        ) : variants.length === 0 ? null : (
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
                sourceName={sourceName}
                currency={product.currency}
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
                sourceName={sourceName}
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
    </>
  );

  const page = (
    <PageLayout
      backTo={{
        to: '/products',
        label: isBundle ? bundleCopy.view.back : copy.backToProducts,
        'data-testid': 'stock-back-to-products',
      }}
      eyebrow={isBundle ? bundleCopy.view.eyebrow : copy.overview.eyebrow}
      title={
        isBundle ? (
          <span className="pm-title">
            {product.name}
            {stockStatus !== null ? (
              <StatusBadge compact withDot tone={STOCK_STATUS_BADGE_TONE[stockStatus]}>
                {STOCK_STATUS_LABEL[stockStatus]}
              </StatusBadge>
            ) : null}
            <span className="cx-tag">{bundleCopy.view.bundleTag}</span>
          </span>
        ) : (
          <span className="pm-title">
            {product.name}
            {stockStatus !== null ? (
              <StatusBadge
                compact
                withDot
                tone={STOCK_STATUS_BADGE_TONE[stockStatus]}
                data-testid="product-stock-badge"
              >
                {STOCK_STATUS_LABEL[stockStatus]}
              </StatusBadge>
            ) : (
              <StatusBadge compact withDot tone="neutral" data-testid="product-stock-badge-unknown">
                {headline.kind === 'loading' ? copy.hero.checkingStock : copy.hero.stockNotKnown}
              </StatusBadge>
            )}
          </span>
        )
      }
      description={
        isBundle ? (
          <>
            {bundleCopy.view.description}
            <span className="pm-meta">
              <span className="pm-hint">{bundleCopy.view.sku}</span>
              <span className="mono">{product.sku ?? '—'}</span>
            </span>
          </>
        ) : (
          <span className="pm-meta">
            <span className="pm-hint">{bundleCopy.view.sku}</span>
            <span className="mono">{product.sku ?? '—'}</span>
            {sourceConnectionId ? (
              <>
                <span className="pm-hint" style={{ marginLeft: 8 }}>
                  {copy.source}
                </span>
                <ConnectionChips connectionIds={[sourceConnectionId]} />
              </>
            ) : null}
          </span>
        )
      }
      actions={
        isBundle ? (
          <span className="page-header__actions--row">
            <BundleGuideButton />
            <Link
              className="button button--secondary button--sm"
              to={`/listings/bulk-create/wizard?${new URLSearchParams({ productIds: product.id, variantIds: variants[0]?.id ?? '' }).toString()}`}
              data-testid="bundle-view-list-offer"
            >
              {bundleCopy.view.listOffer}
            </Link>
            {bundleWrite.canWrite ? (
              <Link
                className="button button--sm"
                to={`/products/bundles/${encodeURIComponent(variants[0]?.id ?? '')}`}
                data-testid="bundle-view-edit"
              >
                {bundleCopy.view.editComposition}
              </Link>
            ) : null}
          </span>
        ) : (
          <span className="page-header__actions--row">
            <BundleGuideButton />
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={() => {
                setActiveView(VIEW_CONTENT);
              }}
              data-testid="product-detail-edit-content"
            >
              {copy.overview.editContent}
            </button>
            {bundleWrite.canWrite ? (
              <Link
                className="button button--primary button--sm"
                to={`/products/bundles/new?componentProduct=${encodeURIComponent(product.id)}`}
                data-testid="product-detail-make-bundle"
              >
                {bundleCopy.list.makeBundle}
              </Link>
            ) : (
              <span
                className="button button--primary button--sm"
                role="button"
                aria-disabled="true"
                tabIndex={0}
                title={bundleCopy.form.viewOnlyReason}
                data-testid="product-detail-make-bundle"
              >
                {bundleCopy.list.makeBundle}
              </span>
            )}
          </span>
        )
      }
    >
      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList aria-label={copy.tabs.label}>
          <TabsTrigger value={VIEW_OVERVIEW}>{copy.tabs.overview}</TabsTrigger>
          <TabsTrigger value={VIEW_CONTENT}>{copy.tabs.content}</TabsTrigger>
        </TabsList>

        <TabsContent value={VIEW_OVERVIEW}>
          {isBundle && variants[0] ? (
            <BundleProductView bundleVariantId={variants[0].id} productId={product.id} />
          ) : (
            <ProductOverview
              product={product}
              variants={variants}
              stockRows={stockRows}
              availableQuantity={headlineQuantity}
              availableTone={availableTone}
              availableSub={
                headline.kind === 'atp' && stockSummary ? (
                  <>
                    {copy.kpis.toSell}
                    {' · '}
                    <span data-testid="stock-summary-master">
                      {interpolate(copy.kpis.inMaster, {
                        n: format.number(stockSummary.masterStock),
                        source: productMasterName ?? copy.kpis.theMaster,
                      })}
                    </span>
                    {stockSummary.heldCounted !== null && stockSummary.heldCounted > 0 ? (
                      <>
                        {' · '}
                        <span data-testid="stock-summary-held">
                          {interpolate(copy.kpis.reserved, {
                            n: format.number(stockSummary.heldCounted),
                          })}
                        </span>
                      </>
                    ) : null}
                    {shortCount > 0 ? (
                      <>
                        {' · '}
                        {interpolate(copy.kpis.short, { n: format.number(shortCount) })}
                      </>
                    ) : null}
                  </>
                ) : headline.kind === 'unknown' ? (
                  copy.kpis.notKnown
                ) : headline.kind === 'loading' ? (
                  copy.kpis.workingOut
                ) : (
                  availableDescription
                )
              }
              stockSyncedAt={stockSummary?.lastSyncedAt ?? null}
              offerConnections={offerCreatorConnections}
              canCreateOffers={write.visible}
              onCreateOffer={goToWizard}
              usedInVariantIds={usedInVariantIds}
              bundleCount={bundleCount}
              makeBundleAction={makeBundleButton}
              more={moreBody}
              moreOpen={moreOpen}
              onMoreOpenChange={setMoreOpen}
            />
          )}
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
  return <BundleGuide>{page}</BundleGuide>;
}
