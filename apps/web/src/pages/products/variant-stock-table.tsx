/**
 * Variant Stock Table (#1752)
 *
 * Full-width variants table for the product-detail Overview tab, rebuilt in the
 * products-cockpit row language: per-variant stock (available / reserved) with
 * an IN STOCK badge, per-channel coverage pills, a "+ Create offer" CTA on
 * listing gaps, master variant price, and an expandable per-variant drawer that
 * shows rich per-listing detail (status, price, quantity, offer-id link,
 * category, marketplace URL) fetched lazily on expand. Below 640px the table
 * folds into stacked accordion cards.
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
import type { ProductVariant } from '../../features/products/api/products.types';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { usePlatforms } from '../../shared/plugins';
import {
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from './product-stock-status';

interface VariantStockTableProps {
  variants: ProductVariant[];
  stockByVariant: Map<string, InventoryItem>;
  /** Product currency, used to format the master variant price. */
  currency: string | null;
  /** Active OfferCreator connections — the coverage pill set is derived from these. */
  connections: readonly Connection[];
  /** Whether the "+ Create offer" CTA renders (write access, incl. demo). */
  canCreateOffers: boolean;
  /** Opens the create-offer flow for this product (picker or wizard). */
  onCreateOffers: () => void;
  onListingsCount: (variantId: string, count: number) => void;
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
            stock={props.stockByVariant.get(variant.id)}
            currency={props.currency}
            connections={props.connections}
            canCreateOffers={props.canCreateOffers}
            onCreateOffers={props.onCreateOffers}
            onListingsCount={props.onListingsCount}
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
              stock={props.stockByVariant.get(variant.id)}
              currency={props.currency}
              connections={props.connections}
              canCreateOffers={props.canCreateOffers}
              onCreateOffers={props.onCreateOffers}
              onListingsCount={props.onListingsCount}
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

function stockValueClass(availableQuantity: number): string {
  const status = deriveStockStatus(availableQuantity);
  if (status === 'out-of-stock' || status === 'oversold') {
    return 'variant-stock-table__stock-value stock-cell--error';
  }
  if (status === 'low-stock') return 'variant-stock-table__stock-value stock-cell--warning';
  return 'variant-stock-table__stock-value';
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
    platforms.find((p) => p.platformType === platformType)?.displayName ?? platformType;

  const listedConnections = connections.filter((c) => listedConnectionIds.has(c.id));

  // Prefer one full pill per listed OfferCreator connection (matches the
  // cockpit). When no OfferCreator connections resolve (edge/demo), fall back
  // to one pill per listing so the column is never mysteriously empty.
  const pills =
    listedConnections.length > 0
      ? listedConnections.map((connection) => {
          const soleOfPlatform =
            connections.filter((c) => c.platformType === connection.platformType).length === 1;
          const label = soleOfPlatform ? platformLabel(connection.platformType) : connection.name;
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
  const label =
    platforms.find((p) => p.platformType === listing.platformType)?.displayName ??
    listing.platformType;
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
function VariantMetaGrid({
  variant,
  available,
  reserved,
}: {
  variant: ProductVariant;
  available: number;
  reserved: number;
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
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">Stock</span>
        <span className="variant-drawer__meta-value mono-text tabular">
          {available}
          <span className="variant-drawer__meta-muted"> / res {reserved}</span>
        </span>
      </div>
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
    platforms.find((p) => p.platformType === platformType)?.displayName ?? platformType;
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
  available,
  reserved,
  connections,
  listings,
  total,
  isLoading,
  isError,
  open,
}: {
  variant: ProductVariant;
  available: number;
  reserved: number;
  connections: readonly Connection[];
  listings: OfferMapping[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  open: boolean;
}): ReactElement {
  return (
    <>
      {listings.length > 0 ? (
        <div className="variant-drawer__links">
          {listings.map((listing) => (
            <DrawerChannelLink key={listing.id} listing={listing} enabled={open} />
          ))}
        </div>
      ) : null}

      <VariantMetaGrid variant={variant} available={available} reserved={reserved} />

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
              <div className="variant-listing-cards">
                {listings.map((listing) => (
                  <ListingDetailCard key={listing.id} listing={listing} enabled={open} />
                ))}
              </div>
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
  stock,
  connections,
  onListingsCount,
}: {
  variant: ProductVariant;
  stock: InventoryItem | undefined;
  connections: readonly Connection[];
  onListingsCount: (variantId: string, count: number) => void;
}): ReactElement {
  const { listings, total, isLoading, isError } = useVariantListings(variant, onListingsCount);
  return (
    <div className="variant-drawer variant-drawer--flush">
      <VariantDetailBody
        variant={variant}
        available={stock?.availableQuantity ?? 0}
        reserved={stock?.reservedQuantity ?? 0}
        connections={connections}
        listings={listings}
        total={total}
        isLoading={isLoading}
        isError={isError}
        open
      />
    </div>
  );
}

function ListingDetailCard({
  listing,
  enabled,
}: {
  listing: OfferMapping;
  enabled: boolean;
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
  const label =
    platforms.find((p) => p.platformType === listing.platformType)?.displayName ??
    listing.platformType;

  // Meta items are conditional (Qty / Category only when the live offer
  // resolves). Build the rendered nodes first, then interleave a muted `·`
  // separator so we never emit a leading / trailing / double separator.
  const metaItems: ReactNode[] = [
    <span key="offer" className="variant-listing-meta">
      Offer <Link to={`/listings/${listing.id}`}>{listing.externalId} ↗</Link>
    </span>,
  ];
  if (offer) {
    metaItems.push(
      <span key="qty" className="variant-listing-meta">
        <b>Qty</b> {offer.availableQuantity}
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
    <div className="variant-listing-card">
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
  stock,
  currency,
  connections,
  canCreateOffers,
  onCreateOffers,
  onListingsCount,
}: {
  variant: ProductVariant;
  stock: InventoryItem | undefined;
  currency: string | null;
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffers: () => void;
  onListingsCount: (variantId: string, count: number) => void;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const { listings, total, isLoading, isError } = useVariantListings(variant, onListingsCount);

  const available = stock?.availableQuantity ?? 0;
  const reserved = stock?.reservedQuantity ?? 0;
  const status = deriveStockStatus(available);
  const meta = variantMetaLine(variant);

  return (
    <>
      <tr className={isOpen ? 'is-open' : undefined}>
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
          <div className="variant-stock-table__name">
            <span className="variant-stock-table__sku mono-text">{variantHeadline(variant)}</span>
            {meta ? <span className="variant-stock-table__meta">{meta}</span> : null}
          </div>
        </td>
        <td>
          <span className="variant-stock-table__stock">
            <span>
              <span className={stockValueClass(available)}>{available}</span>
              <span className="variant-stock-table__stock-reserved">/ res {reserved}</span>
            </span>
            <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
              {STOCK_STATUS_LABEL[status]}
            </StatusBadge>
          </span>
        </td>
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
        <td colSpan={5}>
          <div className="variant-stock-table__expand-content">
            <div className="variant-stock-table__expand-content-inner">
              <div className="variant-drawer">
                <VariantDetailBody
                  variant={variant}
                  available={available}
                  reserved={reserved}
                  connections={connections}
                  listings={listings}
                  total={total}
                  isLoading={isLoading}
                  isError={isError}
                  open={isOpen}
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
  stock,
  currency,
  connections,
  canCreateOffers,
  onCreateOffers,
  onListingsCount,
}: {
  variant: ProductVariant;
  stock: InventoryItem | undefined;
  currency: string | null;
  connections: readonly Connection[];
  canCreateOffers: boolean;
  onCreateOffers: () => void;
  onListingsCount: (variantId: string, count: number) => void;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const { listings, total, isLoading, isError } = useVariantListings(variant, onListingsCount);

  const available = stock?.availableQuantity ?? 0;
  const reserved = stock?.reservedQuantity ?? 0;
  const status = deriveStockStatus(available);
  const meta = variantMetaLine(variant);

  return (
    <div className="variant-card">
      <button
        type="button"
        className="variant-card__header"
        aria-expanded={isOpen}
        aria-label={`Toggle details for ${variant.sku ?? variant.id}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="variant-stock-table__name">
          <span className="variant-stock-table__sku mono-text">{variantHeadline(variant)}</span>
          {meta ? <span className="variant-stock-table__meta">{meta}</span> : null}
        </span>
        <span className="variant-card__aside">
          <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
            {STOCK_STATUS_LABEL[status]}
          </StatusBadge>
          <span className="variant-card__disclosure" aria-hidden="true">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2l4 4-4 4" />
            </svg>
          </span>
        </span>
      </button>
      {isOpen ? (
        <div className="variant-card__body">
          <div className="variant-card__grid">
            <span className="variant-card__cell">
              <span className="variant-card__cell-label">Available</span>
              <span className="variant-card__cell-value">
                {available} / res {reserved}
              </span>
            </span>
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
              available={available}
              reserved={reserved}
              connections={connections}
              listings={listings}
              total={total}
              isLoading={isLoading}
              isError={isError}
              open={isOpen}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
