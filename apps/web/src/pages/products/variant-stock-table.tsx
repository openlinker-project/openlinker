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
            <th className="data-table__cell--right">Updated</th>
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

function variantMetaLine(variant: ProductVariant): string | null {
  const attrs =
    variant.attributes && Object.keys(variant.attributes).length > 0
      ? Object.entries(variant.attributes)
          .map(([key, value]: [string, string]) => `${key}: ${value}`)
          .join(', ')
      : null;
  const parts = [
    variant.ean ? `EAN ${variant.ean}` : null,
    // Show the SKU on the meta line only when it isn't already the headline.
    variant.sku ? `SKU ${variant.sku}` : null,
    attrs,
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

function VariantDrawer({
  listings,
  total,
  isLoading,
  isError,
  open,
}: {
  listings: OfferMapping[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  open: boolean;
}): ReactElement {
  return (
    <div className="variant-drawer">
      <div className="variant-drawer__label">Listings{total > 0 ? ` (${total})` : ''}</div>
      {isLoading ? (
        <p className="variant-listing-card__note">Loading listings…</p>
      ) : isError ? (
        <p className="variant-listing-card__note">Couldn&rsquo;t load listings.</p>
      ) : listings.length === 0 ? (
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
  const label =
    platforms.find((p) => p.platformType === listing.platformType)?.displayName ??
    listing.platformType;

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
      <div className="variant-listing-card__meta">
        <span className="variant-listing-meta">
          Offer{' '}
          <Link to={`/listings/${listing.id}`}>
            {listing.externalId} ↗
          </Link>
        </span>
        {offer ? (
          <span className="variant-listing-meta">
            <b>Qty</b> {offer.availableQuantity}
          </span>
        ) : null}
        {offer?.category ? (
          <span className="variant-listing-meta">
            <b>Category</b> {offer.category.name ?? offer.category.id}
          </span>
        ) : null}
        {offer?.marketplaceUrl ? (
          <span className="variant-listing-meta">
            <a href={offer.marketplaceUrl} target="_blank" rel="noreferrer">
              Open on marketplace ↗
            </a>
          </span>
        ) : null}
        <span className="variant-listing-meta">
          <b>Updated</b> <TimeDisplay iso={listing.updatedAt} />
        </span>
      </div>
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
            <span className="variant-stock-table__sku mono-text">{variant.sku ?? variant.id}</span>
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
        <td className="data-table__cell--right">
          <TimeDisplay className="mono-text tabular" iso={variant.updatedAt} />
        </td>
      </tr>
      <tr className={`variant-stock-table__expand-row${isOpen ? ' is-open' : ''}`}>
        <td colSpan={6}>
          <div className="variant-stock-table__expand-content">
            <div className="variant-stock-table__expand-content-inner">
              <VariantDrawer
                listings={listings}
                total={total}
                isLoading={isLoading}
                isError={isError}
                open={isOpen}
              />
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
          <span className="variant-stock-table__sku mono-text">{variant.sku ?? variant.id}</span>
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
          <VariantDrawer
            listings={listings}
            total={total}
            isLoading={isLoading}
            isError={isError}
            open={isOpen}
          />
        </div>
      ) : null}
    </div>
  );
}
