/**
 * Variant Stock Table (#1752)
 *
 * Full-width variants table for the product-detail Overview tab, rebuilt in the
 * products-cockpit row language: how much each variant can sell (#3569), per-channel
 * coverage pills, a "+ Create offer" CTA on listing gaps, master variant price, and
 * an expandable per-variant drawer that shows the stock behind the number and rich
 * per-listing detail (status, price, quantity, offer-id link, category,
 * marketplace URL) fetched lazily on expand. Below 640px the table folds into
 * stacked accordion cards.
 *
 * Stock arrives as a ready-made model from the page, built from the one stock
 * view it already reads - this table runs no request of its own for it.
 *
 * @module apps/web/src/pages/products
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import type { Connection } from '../../features/connections';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import { useListingMarketplaceOfferQuery } from '../../features/listings/hooks/use-listing-marketplace-offer-query';
import { useCategoryPathQuery } from '../../features/listings/hooks/use-category-path-query';
import type { OfferMapping } from '../../features/listings/api/listings.types';
import {
  StockActions,
  StockCell,
  StockMetaCells,
  StockNarrative,
  type ProductStockModel,
  type StockRowModel,
} from '../../features/inventory';
import type { StockViewChannel } from '../../features/inventory';
import type { ProductVariant, TaxRateUnknownReason } from '../../features/products/api/products.types';
import { formatTaxRate } from '../../shared/format/format-tax-rate';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { usePlatforms } from '../../shared/plugins';
import { findPlatformDisplayName, resolvePlatformLabel } from '../../features/mappings';

interface VariantStockTableProps {
  variants: ProductVariant[];
  /** Product currency, used to format the master variant price. */
  currency: string | null;
  /**
   * The PRODUCT's tax rate (#2255). A variant with no override of its own
   * inherits it, and rendering that as an absence would send the operator to
   * fix the wrong record.
   */
  productTaxRate?: string | null;
  /**
   * Why the product's rate is missing (#2264), when it is. Threaded through
   * only as far as the "product has none either" fallback needs it - a
   * variant's own override never carries this reason on this cell, because a
   * variant that named its own rate is not in the no-rate branch at all.
   */
  productTaxRateUnknownReason?: TaxRateUnknownReason | null;
  /** Active OfferCreator connections — the coverage pill set is derived from these. */
  connections: readonly Connection[];
  /** Whether the "+ Create offer" CTA renders (write access, incl. demo). */
  canCreateOffers: boolean;
  /** Opens the create-offer flow for this product (picker or wizard). */
  onCreateOffers: () => void;
  onListingsCount: (variantId: string, count: number) => void;
  /** Per-variant stock figures; without it the Stock column is empty. */
  stock?: ProductStockModel | null;
}

const MOBILE_QUERY = '(max-width: 639.98px)';

export function VariantStockTable(props: VariantStockTableProps): ReactElement {
  const isMobile = useMediaQuery(MOBILE_QUERY);

  if (isMobile) {
    return (
      <div className="variant-cards">
        {props.variants.map((variant) => (
          <VariantStockCard
            key={variant.id}
            variant={variant}
            currency={props.currency}
            taxRate={{
              productTaxRate: props.productTaxRate ?? null,
              productTaxRateUnknownReason: props.productTaxRateUnknownReason ?? null,
            }}
            connections={props.connections}
            canCreateOffers={props.canCreateOffers}
            onCreateOffers={props.onCreateOffers}
            onListingsCount={props.onListingsCount}
            stock={props.stock ?? null}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="data-table__container variant-stock-table__container">
      <table className="data-table variant-stock-table">
        <caption className="sr-only">Product variants, stock levels, and marketplace listings</caption>
        <thead>
          <tr>
            <th aria-hidden="true"></th>
            <th>Variant</th>
            <th>Tax rate</th>
            <th>Stock</th>
            <th>Listings</th>
            <th className="data-table__cell--right">Price</th>
          </tr>
        </thead>
        <tbody>
          {props.variants.map((variant) => (
            <VariantStockRow
              key={variant.id}
              variant={variant}
              productTaxRate={props.productTaxRate ?? null}
              productTaxRateUnknownReason={props.productTaxRateUnknownReason ?? null}
              currency={props.currency}
              connections={props.connections}
              canCreateOffers={props.canCreateOffers}
              onCreateOffers={props.onCreateOffers}
              onListingsCount={props.onListingsCount}
              stock={props.stock ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────

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

/**
 * Map marketplace-native offer status to our badge palette (mirrors the
 * listing-detail section). Unknown statuses fall back to neutral — the wire
 * value is an intentional string passthrough.
 */
function statusTone(status: string): StatusBadgeTone {
  const normalised = status.trim().toUpperCase();
  if (normalised === 'ACTIVE' || normalised === 'BIDDING') return 'success';
  if (normalised === 'ENDED' || normalised === 'INACTIVE') return 'warning';
  return 'neutral';
}

function variantHasAttributes(variant: ProductVariant): boolean {
  return Boolean(variant.attributes && Object.keys(variant.attributes).length > 0);
}

/**
 * Row/card headline. When the variant carries distinguishing attributes we lead
 * with their joined values ("Black · M") — the human-meaningful identity — and
 * demote the SKU to the meta line. Otherwise the SKU (or id) stays the headline.
 */
function variantHeadline(variant: ProductVariant): string {
  if (variantHasAttributes(variant)) {
    return Object.values(variant.attributes as Record<string, string>).join(' · ');
  }
  return variant.sku ?? variant.id;
}

function variantMetaLine(variant: ProductVariant): string | null {
  const hasAttrs = variantHasAttributes(variant);
  const parts = [
    // SKU appears on the meta line only when attributes took the headline.
    hasAttrs && variant.sku ? `SKU ${variant.sku}` : null,
    variant.ean ? `EAN ${variant.ean}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** One TanStack Query per variant for its listings, plus the count callback. */
function useVariantListings(
  variant: ProductVariant,
  onListingsCount: (variantId: string, count: number) => void,
): {
  listings: OfferMapping[];
  total: number;
  isLoading: boolean;
  isError: boolean;
} {
  const listingsQuery = useListingsQuery({ internalId: variant.id }, { limit: 50, offset: 0 });
  const listings = listingsQuery.data?.items ?? [];
  const total = listingsQuery.data?.total ?? 0;

  useEffect(() => {
    if (listingsQuery.data) {
      onListingsCount(variant.id, listingsQuery.data.total);
    }
  }, [variant.id, listingsQuery.data, onListingsCount]);

  return { listings, total, isLoading: listingsQuery.isLoading, isError: Boolean(listingsQuery.error) };
}

// ── Coverage pills (cockpit language) ────────────────────────────────────────

function VariantCoverage({
  listings,
  connections,
  canCreateOffers,
  onCreateOffers,
}: {
  listings: OfferMapping[];
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffers: () => void;
}): ReactElement {
  const platforms = usePlatforms();
  const listedConnectionIds = new Set(listings.map((l) => l.connectionId));
  const platformLabel = (platformType: string): string =>
    resolvePlatformLabel(platforms, platformType);

  const listedConnections = connections.filter((c) => listedConnectionIds.has(c.id));

  // Prefer one full pill per listed OfferCreator connection (matches the
  // cockpit). When no OfferCreator connections resolve (edge/demo), fall back
  // to one pill per listing so the column is never mysteriously empty.
  const pills =
    listedConnections.length > 0
      ? listedConnections.map((connection) => {
          const soleOfPlatform =
            connections.filter((c) => c.platformType === connection.platformType).length === 1;
          // Same fallback as the other two renderings of this pill
          // (`listings-coverage-pills.tsx`, `product-row-detail.tsx`): with no
          // registered platform, the operator-authored connection name beats a
          // lowercase slug. Before #2088 this one site disagreed with its two
          // siblings, so the same variant read `My Shopify Store` on the products
          // list and `shopify` on the product detail page.
          const label = soleOfPlatform
            ? (findPlatformDisplayName(platforms, connection) ?? connection.name)
            : connection.name;
          return { key: connection.id, label, channel: connection.platformType };
        })
      : listings.map((listing) => ({
          key: listing.id,
          label: platformLabel(listing.platformType),
          channel: listing.platformType,
        }));

  const hasGap = connections.some((c) => !listedConnectionIds.has(c.id));

  if (pills.length === 0 && !(canCreateOffers && hasGap)) {
    return <span className="text-muted">—</span>;
  }

  return (
    <div className="variant-stock-table__listings-cell">
      {pills.map((pill) => (
        <span key={pill.key} className="coverage-pill coverage-pill--full" data-channel={pill.channel}>
          {pill.label}
        </span>
      ))}
      {canCreateOffers && hasGap ? (
        <button type="button" className="products-row-cta" onClick={onCreateOffers}>
          + Create offer
        </button>
      ) : null}
    </div>
  );
}

// ── Rich per-listing drawer ──────────────────────────────────────────────────

/**
 * Top-of-drawer deep-link pill for one listing that resolves a marketplace URL.
 * Runs the same `useListingMarketplaceOfferQuery` as its `ListingDetailCard`
 * sibling — TanStack Query dedupes by queryKey, so the two share ONE network
 * request. Renders nothing until (and unless) the offer exposes a URL.
 */
function DrawerChannelLink({
  listing,
  enabled,
}: {
  listing: OfferMapping;
  enabled: boolean;
}): ReactElement | null {
  const platforms = usePlatforms();
  const isOffer = listing.entityType === 'Offer';
  const offerQuery = useListingMarketplaceOfferQuery(listing.id, { enabled: enabled && isOffer });
  const url = offerQuery.data?.marketplaceUrl;
  if (!url) return null;
  const label = resolvePlatformLabel(platforms, listing);
  return (
    <a
      className="variant-drawer__link"
      data-channel={listing.platformType}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <span className="variant-drawer__dot" aria-hidden="true"></span>
      Open on {label} <span className="variant-drawer__arrow" aria-hidden="true">↗</span>
    </a>
  );
}

/** Attribute chips + variant identity metadata grid, above the listings block. */
/**
 * The product-level tax facts a variant inherits. Passed only where the
 * surrounding view has no "Tax rate" column of its own (the single-variant
 * panel and the mobile card); the desktop table shows it per row already.
 */
interface InheritedTaxRate {
  productTaxRate: string | null;
  productTaxRateUnknownReason: TaxRateUnknownReason | null;
}

function VariantMetaGrid({
  variant,
  taxRate,
  stockRow,
}: {
  variant: ProductVariant;
  taxRate?: InheritedTaxRate;
  stockRow?: StockRowModel;
}): ReactElement {
  const hasAttrs = variantHasAttributes(variant);
  return (
    <div className="variant-drawer__meta">
      {hasAttrs ? (
        <div className="variant-drawer__meta-cell">
          <span className="variant-drawer__meta-label">Attributes</span>
          <span className="attr-chips">
            {Object.entries(variant.attributes as Record<string, string>).map(([key, value]) => (
              <span key={key} className="attr-chip">
                <b>{key}</b>
                {value}
              </span>
            ))}
          </span>
        </div>
      ) : null}
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">Variant ID</span>
        <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap mono-text">
          {variant.id}
        </span>
      </div>
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">EAN / GTIN</span>
        <span className="variant-drawer__meta-value mono-text">
          {variant.ean ?? variant.gtin ?? '—'}
        </span>
      </div>
      {taxRate ? (
        <div className="variant-drawer__meta-cell">
          <span className="variant-drawer__meta-label">Tax rate</span>
          <VariantTaxRateCell
            variant={variant}
            productTaxRate={taxRate.productTaxRate}
            productTaxRateUnknownReason={taxRate.productTaxRateUnknownReason}
          />
        </div>
      ) : null}
      {stockRow ? <StockMetaCells row={stockRow} /> : null}
    </div>
  );
}

/** Honest "n listed · m gap · Channels" summary under the Listings label. */
function ListingsSummary({
  listings,
  connections,
}: {
  listings: OfferMapping[];
  connections: readonly Connection[];
}): ReactElement {
  const platforms = usePlatforms();
  const platformLabel = (platformType: string): string =>
    resolvePlatformLabel(platforms, platformType);
  const listedConnectionIds = new Set(listings.map((l) => l.connectionId));
  const gapConnections = connections.filter((c) => !listedConnectionIds.has(c.id));
  const gapChannels = Array.from(
    new Set(gapConnections.map((c) => platformLabel(c.platformType))),
  );

  return (
    <div className="listings-summary">
      <span>{listings.length} listed</span>
      {gapConnections.length > 0 ? (
        <>
          <span className="lmeta__sep" aria-hidden="true">·</span>
          <span>{gapConnections.length} gap</span>
          <span className="lmeta__sep" aria-hidden="true">·</span>
          <span>{gapChannels.join(', ')}</span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Shared drawer body used by the expanded table row, the mobile card, and the
 * single-product "Listed on" section. Order: (1) channel-link strip, (2)
 * variant metadata grid, (3) listings block (label + summary + detail cards).
 */
function VariantDetailBody({
  variant,
  connections,
  listings,
  total,
  isLoading,
  isError,
  open,
  taxRate,
  stock,
}: {
  variant: ProductVariant;
  connections: readonly Connection[];
  listings: OfferMapping[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  open: boolean;
  taxRate?: InheritedTaxRate;
  stock?: ProductStockModel | null;
}): ReactElement {
  const stockRow = stock?.rows.get(variant.id);
  const showsChannelFigures =
    stockRow !== undefined && stockRow.stock !== null && (stockRow.state === 'ok' || stockRow.state === 'unknown' || stockRow.state === 'staled');
  return (
    <>
      {listings.length > 0 ? (
        <div className="variant-drawer__links">
          {listings.map((listing) => (
            <DrawerChannelLink key={listing.id} listing={listing} enabled={open} />
          ))}
        </div>
      ) : null}

      <VariantMetaGrid variant={variant} taxRate={taxRate} stockRow={stockRow} />

      {stockRow && stock ? (
        <>
          <StockNarrative row={stockRow} />
          <StockActions row={stockRow} stock={stock} />
        </>
      ) : null}

      <div className="variant-drawer__listings">
        <div className="variant-drawer__label">Listings{total > 0 ? ` (${total})` : ''}</div>
        {isLoading ? (
          <p className="variant-listing-card__note">Loading listings…</p>
        ) : isError ? (
          <p className="variant-listing-card__note">Couldn&rsquo;t load listings.</p>
        ) : (
          <>
            <ListingsSummary listings={listings} connections={connections} />
            {listings.length === 0 ? (
              <p className="variant-listing-card__note">
                No marketplace listings reference this variant yet.
              </p>
            ) : (
              <>
                <div
                  className="variant-listing-cards"
                  data-testid={stockRow ? `stock-channels-${stockRow.key}` : undefined}
                >
                  {stockRow && stock && showsChannelFigures && stock.channelsStatus !== 'ok' ? (
                    <p
                      className="variant-listing-card__note"
                      data-testid={`stock-channels-partial-${stockRow.key}`}
                    >
                      {stock.channelsStatus === 'partial'
                        ? 'Some marketplace figures couldn\u2019t be loaded right now. What OpenLinker sends is still correct.'
                        : 'Marketplace figures couldn\u2019t be loaded right now. What OpenLinker sends is still correct.'}
                    </p>
                  ) : null}
                  {listings.map((listing) => (
                    <ListingDetailCard
                      key={listing.id}
                      listing={listing}
                      enabled={open}
                      stockRow={showsChannelFigures ? stockRow : undefined}
                    />
                  ))}
                </div>
                {showsChannelFigures ? (
                  <p className="variant-drawer__note">
                    Sends = what OpenLinker publishes. Qty = what the offer shows now, read live when you open this
                    row. Last check = the offer status sync, which goes through 100 offers an hour.
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Single-product panel — the same drawer body, always expanded, for the
 * `variants.length === 1` "Listed on" section. Owns the per-variant listings
 * query so `onListingsCount` still feeds the Listings KPI.
 */
export function VariantDetailPanel({
  variant,
  productTaxRate,
  productTaxRateUnknownReason,
  connections,
  onListingsCount,
  stock = null,
}: {
  variant: ProductVariant;
  productTaxRate: string | null;
  productTaxRateUnknownReason?: TaxRateUnknownReason | null;
  connections: readonly Connection[];
  onListingsCount: (variantId: string, count: number) => void;
  stock?: ProductStockModel | null;
}): ReactElement {
  const { listings, total, isLoading, isError } = useVariantListings(variant, onListingsCount);
  const stockRow = stock?.rows.get(variant.id);
  return (
    <div
      className="variant-drawer variant-drawer--flush"
      data-testid={stockRow ? `stock-variant-row-${stockRow.key}` : undefined}
    >
      {stockRow ? (
        <div className="variant-drawer__stockline">
          <StockCell row={stockRow} />
        </div>
      ) : null}
      <VariantDetailBody
        stock={stock}
        variant={variant}
        connections={connections}
        listings={listings}
        total={total}
        isLoading={isLoading}
        isError={isError}
        open
        taxRate={{
          productTaxRate,
          productTaxRateUnknownReason: productTaxRateUnknownReason ?? null,
        }}
      />
    </div>
  );
}

/** What OpenLinker sends one channel, in words: the number and why it is not the full count. */
function describeSends(row: StockRowModel, channel: StockViewChannel): string {
  const sends = channel.willPublish.quantity;
  if (row.state === 'unknown' || sends === null) return 'Paused';
  const toSell = row.stock?.availableToPromise ?? null;
  const buffer = channel.rule?.stockSafetyBuffer ?? 0;
  const threshold = channel.rule?.stockZeroThreshold ?? 0;
  if (toSell !== null && toSell > 0 && sends === 0 && threshold > 0) {
    return `Sends 0 (0 below ${threshold})`;
  }
  if (toSell !== null && sends < toSell && buffer > 0) {
    return `Sends ${sends} (${toSell - sends} kept as buffer)`;
  }
  return `Sends ${sends}`;
}

function ListingDetailCard({
  listing,
  enabled,
  stockRow,
}: {
  listing: OfferMapping;
  enabled: boolean;
  /** Present when the stock figures for this variant are known and may be shown. */
  stockRow?: StockRowModel;
}): ReactElement {
  const platforms = usePlatforms();
  const isOffer = listing.entityType === 'Offer';
  // Rich marketplace state is fetched lazily — only when the row is open and
  // the mapping is an Offer (the endpoint 404s / 422s otherwise). One query
  // per listing, retry-off, 30s stale (see the hook).
  const offerQuery = useListingMarketplaceOfferQuery(listing.id, { enabled: enabled && isOffer });
  const offer = offerQuery.data;
  // Resolve the offer's raw category id to a human breadcrumb (#1752). The
  // offer payload carries only `category.id`; fall back to the raw id / name
  // while loading or on 404/422.
  const categoryPathQuery = useCategoryPathQuery(listing.connectionId, offer?.category?.id, {
    enabled: enabled && Boolean(offer?.category?.id),
  });
  const categoryBreadcrumb =
    categoryPathQuery.data && categoryPathQuery.data.length > 0
      ? categoryPathQuery.data.map((segment) => segment.name).join(' › ')
      : null;
  const label = resolvePlatformLabel(platforms, listing);

  // Meta items are conditional (Qty / Category only when the live offer
  // resolves). Build the rendered nodes first, then interleave a muted `·`
  // separator so we never emit a leading / trailing / double separator.
  const metaItems: ReactNode[] = [
    <span key="offer" className="variant-listing-meta">
      Offer <Link to={`/listings/${listing.id}`}>{listing.externalId} ↗</Link>
    </span>,
  ];
  const channel = stockRow?.stock?.channels.find((c) => c.connectionId === listing.connectionId);
  if (stockRow && channel) {
    metaItems.push(
      <span key="sends" className="variant-listing-meta" data-testid={`stock-channel-sends-${stockRow.key}-${channel.platformType}-${listing.externalId}`}>
        {describeSends(stockRow, channel)}
      </span>,
    );
  }
  if (offer) {
    metaItems.push(
      <span key="qty" className="variant-listing-meta">
        <b>Qty</b> {offer.availableQuantity}
      </span>,
    );
  }
  if (stockRow && channel) {
    metaItems.push(
      <span key="check" className="variant-listing-meta">
        {channel.channelShows.quantity !== null ? (
          <>
            Last check{' '}
            {channel.channelShows.observedAt ? (
              <TimeDisplay iso={channel.channelShows.observedAt} format="time" />
            ) : null}
            : {channel.channelShows.quantity}
          </>
        ) : (
          'Not checked yet'
        )}
      </span>,
    );
  }
  if (offer?.category) {
    metaItems.push(
      <span key="category" className="variant-listing-meta">
        <b>Category</b> {categoryBreadcrumb ?? offer.category.name ?? offer.category.id}
      </span>,
    );
  }
  metaItems.push(
    <span key="updated" className="variant-listing-meta">
      <b>Offer updated</b> <TimeDisplay iso={listing.updatedAt} />
    </span>,
  );

  const metaWithSeparators: ReactNode[] = [];
  metaItems.forEach((node, index) => {
    if (index > 0) {
      metaWithSeparators.push(
        <span key={`sep-${index}`} className="lmeta__sep" aria-hidden="true">
          ·
        </span>,
      );
    }
    metaWithSeparators.push(node);
  });

  return (
    <div
      className="variant-listing-card"
      data-testid={stockRow && channel ? `stock-channel-${stockRow.key}-${channel.platformType}-${listing.externalId}` : undefined}
    >
      <div className="variant-listing-card__top">
        <span className="variant-listing-card__left">
          <span className="channel-pill" data-channel={listing.platformType}>
            {label}
          </span>
          <ConnectionEntityLabel connectionId={listing.connectionId} showId={false} />
          {offer ? (
            <StatusBadge tone={statusTone(offer.status)} compact>
              {offer.status}
            </StatusBadge>
          ) : null}
        </span>
        {offer ? (
          <span className="variant-listing-card__price">
            {offer.price.amount} {offer.price.currency}
          </span>
        ) : null}
      </div>
      <div className="variant-listing-card__meta">{metaWithSeparators}</div>
      {enabled && offerQuery.isLoading ? (
        <p className="variant-listing-card__note">Loading live marketplace data…</p>
      ) : null}
    </div>
  );
}

// ── Desktop row ──────────────────────────────────────────────────────────────

function VariantStockRow({
  variant,
  productTaxRate,
  productTaxRateUnknownReason,
  currency,
  connections,
  canCreateOffers,
  onCreateOffers,
  onListingsCount,
  stock,
}: {
  variant: ProductVariant;
  productTaxRate: string | null;
  productTaxRateUnknownReason?: TaxRateUnknownReason | null;
  currency: string | null;
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffers: () => void;
  onListingsCount: (variantId: string, count: number) => void;
  stock: ProductStockModel | null;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const stockRow = stock?.rows.get(variant.id);
  const { listings, total, isLoading, isError } = useVariantListings(variant, onListingsCount);

  const meta = variantMetaLine(variant);

  return (
    <>
      <tr
        className={isOpen ? 'is-open' : undefined}
        data-testid={stockRow ? `stock-variant-row-${stockRow.key}` : undefined}
      >
        <td className="variant-stock-table__expand-cell">
          <button
            type="button"
            className="variant-stock-table__expand-btn"
            aria-expanded={isOpen}
            aria-label={`Toggle details for ${variant.sku ?? variant.id}`}
            data-testid={stockRow ? `stock-variant-toggle-${stockRow.key}` : undefined}
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2l4 4-4 4" />
            </svg>
          </button>
        </td>
        <td>
          <div className="variant-stock-table__name">
            <span className="variant-stock-table__sku mono-text">{variantHeadline(variant)}</span>
            {meta ? <span className="variant-stock-table__meta">{meta}</span> : null}
          </div>
        </td>
        <td>
          <VariantTaxRateCell
            variant={variant}
            productTaxRate={productTaxRate}
            productTaxRateUnknownReason={productTaxRateUnknownReason}
          />
        </td>
        <td>{stockRow ? <StockCell row={stockRow} /> : <span className="text-muted">—</span>}</td>
        <td>
          <VariantCoverage
            listings={listings}
            connections={connections}
            canCreateOffers={canCreateOffers}
            onCreateOffers={onCreateOffers}
          />
        </td>
        <td className="data-table__cell--right variant-stock-table__price">
          {formatPrice(variant.price, currency)}
        </td>
      </tr>
      <tr className={`variant-stock-table__expand-row${isOpen ? ' is-open' : ''}`}>
        <td colSpan={6}>
          <div className="variant-stock-table__expand-content">
            <div className="variant-stock-table__expand-content-inner">
              <div className="variant-drawer">
                <VariantDetailBody
                  variant={variant}
                  connections={connections}
                  listings={listings}
                  total={total}
                  isLoading={isLoading}
                  isError={isError}
                  open={isOpen}
                  stock={stock}
                />
              </div>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

// ── Mobile accordion card ────────────────────────────────────────────────────

function VariantStockCard({
  variant,
  currency,
  taxRate,
  connections,
  canCreateOffers,
  onCreateOffers,
  onListingsCount,
  stock,
}: {
  variant: ProductVariant;
  currency: string | null;
  taxRate: InheritedTaxRate;
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffers: () => void;
  onListingsCount: (variantId: string, count: number) => void;
  stock: ProductStockModel | null;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const stockRow = stock?.rows.get(variant.id);
  const { listings, total, isLoading, isError } = useVariantListings(variant, onListingsCount);

  const meta = variantMetaLine(variant);

  return (
    <div className="variant-card" data-testid={stockRow ? `stock-variant-row-${stockRow.key}` : undefined}>
      <button
        type="button"
        className="variant-card__header"
        aria-expanded={isOpen}
        aria-label={`Toggle details for ${variant.sku ?? variant.id}`}
        data-testid={stockRow ? `stock-variant-toggle-${stockRow.key}` : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="variant-stock-table__name">
          <span className="variant-stock-table__sku mono-text">{variantHeadline(variant)}</span>
          {meta ? <span className="variant-stock-table__meta">{meta}</span> : null}
        </span>
        <span className="variant-card__aside">
          <span className="variant-card__disclosure" aria-hidden="true">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2l4 4-4 4" />
            </svg>
          </span>
        </span>
      </button>
      {stockRow ? (
        <div className="variant-card__stock">
          <StockCell row={stockRow} />
        </div>
      ) : null}
      {isOpen ? (
        <div className="variant-card__body">
          <div className="variant-card__grid">
            <span className="variant-card__cell">
              <span className="variant-card__cell-label">Price</span>
              <span className="variant-card__cell-value">{formatPrice(variant.price, currency)}</span>
            </span>
            <span className="variant-card__cell variant-card__cell--full">
              <span className="variant-card__cell-label">Listings</span>
              <VariantCoverage
                listings={listings}
                connections={connections}
                canCreateOffers={canCreateOffers}
                onCreateOffers={onCreateOffers}
              />
            </span>
          </div>
          <div className="variant-drawer">
            <VariantDetailBody
              variant={variant}
              connections={connections}
              listings={listings}
              total={total}
              isLoading={isLoading}
              isError={isError}
              open={isOpen}
              taxRate={taxRate}
              stock={stock}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One variant's tax rate (#2255).
 *
 * **Inherited is not the same as absent**, and drawing it as absent sends the
 * operator to fix the wrong record. A variant with no override of its own takes
 * the product's rate, so it renders that rate with an `inherited from the
 * product` caption. Only a variant whose PRODUCT has no rate either shows the
 * badge - and then the fix is on the product, not the variant.
 *
 * A present override wins outright, matching `effectiveTaxRate` on the backend:
 * it is the more specific statement of the same fact, not a conflict.
 */
function VariantTaxRateCell({
  variant,
  productTaxRate,
  productTaxRateUnknownReason,
}: {
  variant: ProductVariant;
  productTaxRate: string | null;
  productTaxRateUnknownReason?: TaxRateUnknownReason | null;
}): ReactElement {
  if (variant.taxRate) {
    return (
      <span className="variant-stock-table__name">
        <span className="mono-text">{formatTaxRate(variant.taxRate)}</span>
        <span className="variant-stock-table__meta">variant override</span>
      </span>
    );
  }
  if (productTaxRate) {
    return (
      <span className="variant-stock-table__name">
        <span className="mono-text">{formatTaxRate(productTaxRate)}</span>
        <span className="variant-stock-table__meta">inherited from the product</span>
      </span>
    );
  }
  return (
    <span className="variant-stock-table__name">
      <StatusBadge tone="error" withDot compact>
        No tax rate
      </StatusBadge>
      <span className="variant-stock-table__meta">
        {taxRateUnknownReasonCaption(productTaxRateUnknownReason)}
      </span>
    </span>
  );
}

/**
 * Distinguish WHY the product has no rate (#2264) - a plain "product has none
 * either" collapsed a shop with no tax configuration and one with several
 * candidate rates and no unambiguous pick into one caption, and the two need
 * different fixes: add a rate versus resolve which of several is right.
 */
function taxRateUnknownReasonCaption(reason: TaxRateUnknownReason | null | undefined): string {
  switch (reason) {
    case 'ambiguous':
      return 'product has several candidate rates - resolve which one is right in the shop';
    case 'unreadable':
      return 'product has none either';
    case 'not-configured':
    default:
      return 'product has none either';
  }
}
