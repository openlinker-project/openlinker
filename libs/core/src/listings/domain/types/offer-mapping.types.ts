/**
 * Offer Mapping Types
 *
 * Type definitions for offer mapping read operations. Defines filters,
 * pagination, and paginated result types for querying offer-to-variant
 * mappings stored in the identifier_mappings table.
 *
 * @module libs/core/src/listings/domain/types
 */
import type { IdentifierMapping } from '@openlinker/core/identifier-mapping';

import type { OfferLifecycle } from './offer-lifecycle.types';
import type { OfferPublicationStatus } from './offer-status-read.types';
import type { OfferValidationProblem } from './offer-validation-problem.types';

/**
 * Offer mapping list filters
 * Criteria for querying offer mappings. All fields are optional.
 */
export interface OfferMappingFilters {
  /** Filter by connection ID */
  connectionId?: string;
  /** Filter by linked internal ID (variant ID) */
  internalId?: string;
  /**
   * Case-insensitive search across the row's human-readable identity -
   * product name, variant label, variant SKU, product SKU, EAN, GTIN - and the
   * external offer ID (#2025). `ean` and `gtin` are separate, independently
   * populated columns, so both are matched (mirroring the sibling variant
   * search in `ProductVariantRepository`).
   */
  search?: string;
  /**
   * Restrict the page to one lifecycle bucket (#2026). Server-side on purpose:
   * filtering the current page client-side would show "nothing has ended yet"
   * to a seller whose 300 ended offers all sit past page 1.
   */
  lifecycle?: OfferLifecycle;
}

/**
 * Filters accepted by the per-bucket count read (#2026).
 *
 * `lifecycle` is excluded AT THE TYPE LEVEL, not merely ignored: the counts
 * feed the tab bar, so scoping them to the selected tab would zero every other
 * tab the moment one is clicked. Every other filter is shared with `findMany`
 * verbatim, which is what makes the counts sum to the list's total.
 *
 * `Omit` alone would NOT be that lock - it only drops the key, so a wider
 * object (an `OfferMappingFilters` variable that happens to carry a bucket)
 * stays structurally assignable and forwards `lifecycle` right through.
 * `lifecycle?: never` makes the field unrepresentable, so the exclusion holds
 * for a passed variable and not just for a fresh object literal at the one
 * call site that exists today.
 */
export type OfferMappingCountFilters = Omit<OfferMappingFilters, 'lifecycle'> & {
  lifecycle?: never;
};

/**
 * Catalog identity joined onto an offer mapping for the listings read model
 * (#2025). `null` on the list item when `internalId` no longer resolves to a
 * live variant (a synced-in offer whose variant was deleted).
 */
export interface OfferMappingIdentity {
  /** Internal product ID owning the linked variant. */
  productId: string;
  /**
   * `products.name` is NOT NULL behind a real FK, so `null` here can only mean
   * a corrupt row - reported honestly rather than rendered as a blank cell.
   */
  productName: string | null;
  /**
   * Distinguishing attribute values joined for display (e.g. `Limonka · 24 cm`).
   * `null` for a simple product's synthetic variant, which carries no attributes.
   */
  variantLabel: string | null;
  sku: string | null;
  ean: string | null;
  /**
   * First image of the owning product - there is no dedicated thumbnail column,
   * so the list renders `products.images[0]`. `null` when the product has none.
   */
  imageUrl: string | null;
  /**
   * `product_variants.isStale` (#1689). A stale variant's offers were zeroed by
   * the stale-offer pause, so without this flag the row reads as
   * `availableQuantity: 0` + `Active` and is indistinguishable from a genuine
   * sell-out - sending the operator hunting for stock that has no master record.
   */
  isStale: boolean;
}

/**
 * Channel-side publication state joined from `offer_status_snapshots` (#816).
 *
 * Always present on a list item: when no status has ever been read for the
 * offer the projection carries `lifecycle: 'Unsynced'` with a `null`
 * `publicationStatus` / `lastStatusSyncedAt`, so every row has a lifecycle
 * bucket and the five buckets genuinely partition the filtered total.
 */
export interface OfferMappingChannelStatus {
  /**
   * Raw neutral observation, kept so the row can badge a mid-transition offer.
   * `null` exactly when `lifecycle` is `Unsynced`.
   */
  publicationStatus: OfferPublicationStatus | null;
  /** Bucket the redesigned lifecycle tabs partition on. */
  lifecycle: OfferLifecycle;
  /** Marketplace validator messages; empty when the validator raised none. */
  validationMessages: readonly string[];
  /**
   * The same refusals in structured form (#2231): platform code, one-line
   * summary, and the scope that decides WHERE each renders - offer-scoped on the
   * row, account-scoped once per connection above the table. Empty on a snapshot
   * written before #2231, in which case a consumer falls back to
   * `validationMessages` and renders exactly what it rendered then.
   */
  validationProblems: readonly OfferValidationProblem[];
  /**
   * When the channel status was last read - the list's "Updated" column.
   * `null` exactly when `lifecycle` is `Unsynced`.
   */
  lastStatusSyncedAt: Date | null;
}

/**
 * Channel-side price + quantity joined from `offer_commercial_snapshots` (#2024).
 *
 * `lastCommercialSyncedAt` ships alongside the values because ADR-009's #2024
 * amendment makes it a hard requirement of any read surface: a both-null
 * observation is deliberately never written, so a persisted row can legitimately
 * be days old. A price rendered without its age is a price an operator acts on.
 *
 * `price` / `availableQuantity` are independently nullable and `null` never
 * means zero - it means the marketplace did not report the field.
 */
export interface OfferMappingCommercial {
  /**
   * A decimal STRING (e.g. `"99.99"`), not a number (#2032 review thread 6) -
   * mirrors `MarketplaceOfferPrice.amount`. `numeric` round-trips through
   * Postgres/TypeORM as a string specifically to avoid float64 precision
   * loss; coercing to `number` here would throw that precision away one hop
   * before the wire.
   */
  price: string | null;
  currency: string | null;
  availableQuantity: number | null;
  lastCommercialSyncedAt: Date;
}

/**
 * One row of the `GET /listings` read model (#2025): the mapping itself plus
 * the three independently-nullable projections the redesigned page renders.
 *
 * Extends the mapping entity rather than nesting it so the content
 * publisher's variant walk - the one remaining `findMany` consumer outside
 * the listings page itself, since offer stock restore and status sync moved
 * to the narrower `findMappingPage` (#2032 review round 1, thread 11) - keeps
 * reading `.externalId` / `.internalId` unchanged.
 */
export interface OfferMappingListItem extends IdentifierMapping {
  identity: OfferMappingIdentity | null;
  channelStatus: OfferMappingChannelStatus;
  commercial: OfferMappingCommercial | null;
}

/**
 * Join a variant's distinguishing attribute values into a display label.
 * Pure. Attribute KEYS are deliberately dropped - the operator recognises
 * `Limonka · 24 cm`, not `Kolor: Limonka · Rozmiar: 24 cm`.
 *
 * Values are coerced before trimming: `attributes` is jsonb, so a numeric or
 * boolean value reaches here despite the `Record<string, string>` type and
 * would otherwise throw on `.trim()`.
 *
 * Unlike the FE `variantShortLabel` selector this returns `null` rather than
 * falling back to SKU or variant id, and it drops blank values - the row
 * already renders SKU in its own column, so a fallback would duplicate it.
 */
export function deriveVariantLabel(attributes: Record<string, string> | null): string | null {
  if (!attributes) return null;
  const values = Object.values(attributes)
    .map((value) => String(value).trim())
    .filter((value) => value !== '');
  return values.length > 0 ? values.join(' · ') : null;
}

/**
 * Offset-based pagination parameters for offer mappings
 */
export interface OfferMappingPagination {
  /** Number of items to return (1–100) */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Paginated offer mappings result
 */
export interface PaginatedOfferMappings {
  items: OfferMappingListItem[];
  total: number;
}

/**
 * Bare paginated `identifier_mappings` rows, with none of `findMany`'s four
 * read-model reporting joins (#2032 review thread 11). Backs
 * `OfferMappingRepositoryPort.findMappingPage` - the write/sync-path query
 * shape from before #2025, for callers that only ever read `.externalId` /
 * `.internalId` off the mapping and would otherwise pay for the enriched
 * read model's joins and its separate `COUNT(DISTINCT)` on every tick.
 */
export interface PaginatedIdentifierMappings {
  items: IdentifierMapping[];
  total: number;
}

/**
 * Per-product, per-connection listed-variant count (#1720 - products catalog
 * cockpit coverage pills).
 *
 * One row per (product, connection) pair that has at least one variant with
 * an Offer mapping; `listedVariants` is the count of DISTINCT variants of the
 * product that carry at least one Offer mapping on that connection. Products
 * or connections with zero listed variants are simply absent from the result.
 */
export interface ProductListingsCoverage {
  productId: string;
  connectionId: string;
  platformType: string;
  listedVariants: number;
}

/**
 * A variant with an Offer mapping on a connection whose canonical
 * `product_variants.isStale` flag is currently `true` (#1689). Backs the
 * stale-offer-pause reconcile sweep — see
 * `OfferMappingRepositoryPort.findStaleMappedVariants` for the cross-context
 * join this is read from.
 */
export interface StaleMappedVariant {
  variantId: string;
  externalOfferId: string;
  staleAt: Date;
}

/**
 * Options for `findRecentlyListedVariantIds` (#1983 needs-attention aggregates).
 * Shared by `OfferMappingRepositoryPort` and `ShopProductMappingRepositoryPort`
 * so both listing kinds expose the identical candidate-pool read shape.
 */
export interface FindRecentlyListedVariantIdsOptions {
  /** Scope to one connection; omit to enumerate across every connection. */
  connectionId?: string;
  /** Maximum number of distinct variants to return. */
  limit: number;
}

/**
 * One row of `findRecentlyListedVariantIds` — the variant id plus its parent
 * product id, so a caller can build a deep-link without a second lookup.
 * `latestMappedAt` (the row's own `ORDER BY` key) lets a caller merging rows
 * from both `OfferMappingRepositoryPort` and `ShopProductMappingRepositoryPort`
 * re-sort by recency instead of trusting insertion order.
 */
export interface RecentlyListedVariant {
  variantId: string;
  productId: string;
  latestMappedAt: Date;
}
