/**
 * Product overview (#3935, mockup "Kawa ziarnista 250 g")
 *
 * What the Overview tab of a plain product shows: a compact KPI row, the
 * bundles the product is a component of, the variants with their stock and the
 * channels they are listed on, the offers per channel, and a side rail with the
 * product's source and pictures.
 *
 * The stock correction, cost, per-variant detail and stock history are not
 * dropped: they sit one step down, behind "More", so the page reads at a glance
 * and nothing it could do before is out of reach.
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { usePlatforms } from '../../shared/plugins';
import { ComposerSection } from '../../shared/ui/composer-section';
import { RichTextView } from '../../shared/ui';
import { StatusBadge } from '../../shared/ui/status-badge';
import type { StatusBadgeTone } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import {
  ConnectionChip,
  readConnectionEnvironment,
  useConnectionsQuery,
} from '../../features/connections';
import type { Connection } from '../../features/connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import { useVariantListingsQueries } from '../../features/listings';
import type { OfferLifecycle } from '../../features/listings';
import { ProductUsedInBundles } from '../../features/bundles/components/product-used-in-bundles';
import { ProductGallery } from '../../features/products/components/product-gallery';
import type { Product, ProductVariant } from '../../features/products';
import type { StockRowModel } from '../../features/inventory';

const LIFECYCLE_TONE: Record<OfferLifecycle, StatusBadgeTone> = {
  Active: 'success',
  Draft: 'neutral',
  Invalid: 'error',
  Ended: 'neutral',
  Unsynced: 'neutral',
};

export interface ProductOverviewProps {
  product: Product;
  variants: readonly ProductVariant[];
  stockRows: ReadonlyMap<string, StockRowModel>;
  /** To-sell quantity, `null` when OpenLinker does not know (never zero). */
  availableQuantity: number | null;
  availableSub: ReactNode;
  availableTone: 'success' | 'warning' | 'error' | 'neutral';
  stockSyncedAt: string | null;
  offerConnections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffer: (connectionId: string) => void;
  usedInVariantIds: readonly string[];
  bundleCount: number;
  makeBundleAction: ReactNode;
  /** Stock alerts, per-variant detail, correction and history: the "More" body. */
  more: ReactNode;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
}

export function ConnectionChips({
  connectionIds,
}: {
  connectionIds: readonly string[];
}): ReactElement {
  const connections = useConnectionsQuery();
  const platforms = usePlatforms();
  const byId = new Map((connections.data ?? []).map((c) => [c.id, c]));
  return (
    <span className="gift-chans">
      {connectionIds.map((id) => {
        const connection = byId.get(id);
        return (
          <ConnectionChip
            key={id}
            connectionId={id}
            name={connection?.name ?? null}
            loading={connections.isLoading}
            channel={{
              platformType: connection?.platformType,
              label: connection ? resolvePlatformLabel(platforms, connection.platformType) : null,
              shortLabel: connection
                ? resolvePlatformShortLabel(platforms, connection.platformType)
                : null,
              environment: readConnectionEnvironment(connection?.config),
            }}
          />
        );
      })}
    </span>
  );
}

export function ProductOverview(props: ProductOverviewProps): ReactElement {
  const {
    product,
    variants,
    stockRows,
    availableQuantity,
    availableSub,
    stockSyncedAt,
    offerConnections,
    canCreateOffers,
    onCreateOffer,
    usedInVariantIds,
    bundleCount,
    more,
  } = props;
  const copy = useMessages('products').productDetailPage;
  const view = useMessages('bundles').view;
  const sourceCopy = useMessages('products').productSourceSection;
  const format = useFormat();
  const plural = usePlural();
  const connections = useConnectionsQuery();
  const { moreOpen, onMoreOpenChange } = props;

  // One read per variant: the listings API filters by the variant it maps.
  const { byVariant: listingsByVariant, loaded: listingsLoaded } = useVariantListingsQueries(
    variants.map((variant) => variant.id)
  );
  const allListings = [...listingsByVariant.values()].flat();
  const offerRows = offerConnections.map((connection) => ({
    connection,
    listings: allListings.filter((l) => l.connectionId === connection.id),
  }));
  const missing = offerRows
    .filter((row) => row.listings.length === 0)
    .map((row) => row.connection.name);
  const currency = product.currency ?? undefined;
  const sourceMapping = product.externalIds?.[0];
  const sourceConnection = (connections.data ?? []).find(
    (c) => c.id === sourceMapping?.connectionId
  );
  const taxRate = product.taxRate ?? variants[0]?.taxRate ?? null;
  const images = product.images ?? [];

  return (
    <div className="pm-grid" data-testid="product-overview">
      <div className="pm-col">
        <ComposerSection
          title={copy.kpis.title}
          aside={
            stockSyncedAt ? (
              <>
                {copy.variants.stockSynced} <TimeDisplay iso={stockSyncedAt} />
              </>
            ) : undefined
          }
          riseIndex={2}
        >
          <div className="pm-kpis" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
            <div className="pm-kpi" data-tone={props.availableTone}>
              <span className="pm-kpi__l">{copy.kpis.available}</span>
              <span className="pm-kpi__n mono tabular" data-testid="stock-summary-atp">
                {availableQuantity === null ? '—' : format.number(availableQuantity)}{' '}
                <small>{view.unit}</small>
              </span>
              <span className="pm-kpi__s">{availableSub}</span>
            </div>
            <div className="pm-kpi">
              <span className="pm-kpi__l">{copy.kpis.price}</span>
              <span className="pm-kpi__n mono tabular">
                {product.price === null ? '—' : format.money(product.price, currency)}
              </span>
              <span className="pm-kpi__s">{currency ?? ''}</span>
            </div>
            <div className="pm-kpi">
              <span className="pm-kpi__l">{copy.kpis.listings}</span>
              <span className="pm-kpi__n mono tabular">{format.number(allListings.length)}</span>
              <span className="pm-kpi__s">
                {listingsLoaded && missing.length > 0
                  ? interpolate(copy.overview.missingOn, { list: missing.join(', ') })
                  : ''}
              </span>
            </div>
            <div className="pm-kpi">
              <span className="pm-kpi__l">{view.inBundles}</span>
              <span className="pm-kpi__n mono tabular">{format.number(bundleCount)}</span>
              <span className="pm-kpi__s">{view.asComponent}</span>
            </div>
          </div>
        </ComposerSection>

        <ProductUsedInBundles
          card
          title={copy.overview.bundlesTitle}
          variantIds={usedInVariantIds}
          action={props.makeBundleAction}
        />

        <ComposerSection
          title={
            variants.length > 1
              ? interpolate(copy.variants.headingWithCount, { n: format.number(variants.length) })
              : copy.variants.heading
          }
          aside={plural(variants.length, copy.hero.variantCount, {
            n: format.number(variants.length),
          })}
          riseIndex={4}
          data-testid="variant-table-section"
        >
          {variants.length === 0 ? (
            <p className="text-muted">{copy.variants.empty}</p>
          ) : (
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>{copy.overview.variantCol}</th>
                  <th>{copy.overview.stockCol}</th>
                  <th>{copy.overview.reservedCol}</th>
                  <th>{copy.overview.listedOnCol}</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => {
                  const row = stockRows.get(variant.id);
                  const known = row !== undefined && (row.state === 'ok' || row.state === 'staled');
                  const label =
                    variants.length === 1
                      ? copy.overview.defaultVariant
                      : Object.values(variant.attributes ?? {}).join(' / ') ||
                        variant.sku ||
                        variant.id;
                  const channelIds = [
                    ...new Set(
                      (listingsByVariant.get(variant.id) ?? []).map((l) => l.connectionId)
                    ),
                  ];
                  return (
                    <tr key={variant.id}>
                      <td>
                        {label}
                        {variant.sku ? <span className="cx-sub mono"> {variant.sku}</span> : null}
                      </td>
                      <td className="mono tabular">
                        {row === undefined || !known ? '—' : format.number(row.masterAvailable)}
                      </td>
                      <td className="mono tabular">
                        {row === undefined || !known ? '—' : format.number(row.masterReserved)}
                      </td>
                      <td>
                        {channelIds.length > 0 ? (
                          <ConnectionChips connectionIds={channelIds} />
                        ) : (
                          <span className="cx-sub">{view.notListed}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ComposerSection>

        <ComposerSection
          title={copy.kpis.listings}
          aside={plural(allListings.length, copy.hero.listingCount, {
            n: format.number(allListings.length),
          })}
          riseIndex={5}
          data-testid="product-offers"
        >
          <ul className="cx-offers">
            {offerRows.map(({ connection, listings }) => {
              const listing = listings[0];
              return (
                <li key={connection.id}>
                  <span>
                    <ConnectionChips connectionIds={[connection.id]} />
                  </span>
                  {listing ? (
                    <>
                      <span>
                        <StatusBadge
                          compact
                          withDot
                          tone={LIFECYCLE_TONE[listing.channelStatus?.lifecycle ?? 'Unsynced']}
                        >
                          {view.status[listing.channelStatus?.lifecycle ?? 'Unsynced']}
                        </StatusBadge>
                      </span>
                      <span className="mono tabular">
                        {listing.commercial?.availableQuantity != null
                          ? interpolate(view.offerQty, { n: listing.commercial.availableQuantity })
                          : ''}
                        {listing.commercial?.price
                          ? ` · ${format.money(Number(listing.commercial.price), listing.commercial.currency ?? currency)}`
                          : ''}
                      </span>
                      <Link
                        className="button button--ghost button--sm"
                        to={`/listings?search=${encodeURIComponent(listing.externalId)}`}
                      >
                        {view.open}
                      </Link>
                    </>
                  ) : (
                    <>
                      <span className="cx-sub">{view.notListed}</span>
                      <span />
                      {canCreateOffers ? (
                        <button
                          type="button"
                          className="button button--secondary button--sm"
                          onClick={() => {
                            onCreateOffer(connection.id);
                          }}
                        >
                          {view.listHere}
                        </button>
                      ) : (
                        <span />
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </ComposerSection>

        {product.features && product.features.length > 0 ? (
          <ComposerSection title={copy.attributes} riseIndex={6}>
            <div className="attr-chips">
              {product.features.map((feature) => (
                <span className="attr-chip" key={`${feature.name}:${feature.value}`}>
                  <b>{feature.name}</b>
                  {feature.value}
                </span>
              ))}
            </div>
          </ComposerSection>
        ) : null}

        {product.description ? (
          <ComposerSection
            title={copy.description.title}
            aside={copy.description.readOnlyBadge}
            riseIndex={6}
          >
            <RichTextView
              html={product.description}
              className="description-block"
              emptyLabel={copy.description.empty}
            />
          </ComposerSection>
        ) : null}

        <div className="pm-disc pm-rise" style={{ ['--rise-i' as string]: 7 }}>
          <button
            type="button"
            className="pm-disc__btn"
            aria-expanded={moreOpen}
            data-testid="product-more-toggle"
            onClick={() => {
              onMoreOpenChange(!moreOpen);
            }}
          >
            <span className="pm-disc__caret" aria-hidden="true" />
            <span>{copy.overview.moreTitle}</span>
            <span className="pm-disc__sum">{copy.overview.moreSummary}</span>
          </button>
          <div className={`pm-disc__body${moreOpen ? ' is-open' : ''}`}>
            <div>
              <div className="pm-disc__inner pm-more">{more}</div>
            </div>
          </div>
        </div>
      </div>

      <aside className="pm-col pm-rail">
        <ComposerSection title={copy.source} riseIndex={3}>
          <div className="pm-sub">
            {sourceMapping ? (
              <div className="pm-benefit">
                <ConnectionChips connectionIds={[sourceMapping.connectionId]} />
                <span className="orders-cell-stack">
                  <span>
                    {sourceConnection?.name ?? sourceMapping.platformType}{' '}
                    <StatusBadge tone="neutral" compact>
                      {sourceCopy.masterTag}
                    </StatusBadge>
                  </span>
                  <span className="cx-sub">
                    {sourceMapping.platformType} · {sourceMapping.externalId}
                  </span>
                </span>
              </div>
            ) : (
              <span className="text-muted">{copy.overview.noSource}</span>
            )}
            <dl className="pm-facts" style={{ marginTop: 4 }}>
              <div>
                <dt>{copy.overview.vat}</dt>
                <dd>{taxRate ? `${taxRate}%` : '—'}</dd>
              </div>
              <div>
                <dt>{copy.overview.productId}</dt>
                <dd>
                  <code className="mono-text" title={product.id}>
                    {product.id}
                  </code>
                </dd>
              </div>
              <div>
                <dt>{copy.hero.category}</dt>
                <dd>
                  {product.categoryBreadcrumb && product.categoryBreadcrumb.length > 0
                    ? product.categoryBreadcrumb.map((n) => n.name).join(' › ')
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{copy.hero.created}</dt>
                <dd>
                  <TimeDisplay iso={product.createdAt} />
                </dd>
              </div>
              <div>
                <dt>{copy.overview.updated}</dt>
                <dd>
                  <TimeDisplay iso={product.updatedAt} />
                </dd>
              </div>
            </dl>
          </div>
        </ComposerSection>
        <ComposerSection
          title={copy.overview.photos}
          aside={
            images.length > 0
              ? plural(images.length, copy.overview.photoCount, { n: format.number(images.length) })
              : undefined
          }
          riseIndex={4}
        >
          <ProductGallery images={images} name={product.name} productId={product.id} />
        </ComposerSection>
      </aside>
    </div>
  );
}
