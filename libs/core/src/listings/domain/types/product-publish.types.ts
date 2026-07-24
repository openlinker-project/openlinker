/**
 * Product Publish Types
 *
 * Command and result types for publishing a master catalog product onto a
 * **shop** destination (WooCommerce, Shopify, …) via
 * `ShopProductManagerPort.publishProduct`. The shop-listing sibling of
 * `offer-create.types.ts`: where a marketplace `createOffer` lists a thin
 * sell-record over a catalog card into a closed taxonomy, a shop publish
 * creates/owns the product record itself — multi-category placement,
 * draft/published status, owned-record content/images/SEO, and price/stock as
 * product fields (ADR-024 §1, §3).
 *
 * Projected/operator category parameters travel on the typed neutral
 * `parameters: OfferParameter[]` field (#1072) — the same domain channel the
 * offer side uses (#1039), not the opaque `platformParams` bag. `OfferParameter`
 * is a domain type, so the command references it without a domain→application
 * edge. `platformParams` is reserved for un-modeled shop knobs only.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link ShopProductManagerPort} for the port that consumes these.
 */

import type { OfferParameter } from './offer-parameter.types';
import type { OfferVariantAttribute } from './offer-create.types';

/**
 * Publication state of a shop product. Distinct from record existence and from
 * data sync — a shop publish does not assume create ⇒ visible (ADR-024 §3:
 * Woo `status` draft→publish; Shopify `status` + per-channel publish).
 *
 * - `draft`: record created/updated on the shop, not buyer-visible.
 * - `published`: record live and visible on the storefront.
 */
export const PublishProductStatusValues = ['draft', 'published'] as const;
export type PublishProductStatus = (typeof PublishProductStatusValues)[number];

/**
 * Neutral tax-treatment values for a shop product. Mirrors the common shop
 * vocabulary (taxable / shipping-only / not-taxed); adapters map it to their
 * platform field (WooCommerce `tax_status`).
 */
export const PublishTaxStatusValues = ['taxable', 'shipping', 'none'] as const;
export type PublishTaxStatus = (typeof PublishTaxStatusValues)[number];

/**
 * Owned-record content fields. Extracted as a named type (not inline on the
 * command) so the `shop.product.publish` job payload can reference the same
 * shape without indexed-access coupling.
 *
 * Fields typed `T | null | undefined` follow the `CreateOfferOverrides`
 * convention: both `null` and `undefined` mean "no value supplied" and fall
 * back to a value the builder derives from the master variant/product.
 */
export interface PublishProductContent {
  /** Product title. Falls back to variant/product name. */
  title?: string;
  /** Product description (HTML or rich text). `null`/`undefined` → no override. */
  description?: string | null;
  /** Short/excerpt description. `null`/`undefined` → no override. */
  shortDescription?: string | null;
  /** Marketing tags for the storefront product. `null`/`undefined` → no override. */
  tags?: string[] | null;
  /** Image URLs in display order. `null`/`undefined` → no override. */
  imageUrls?: string[] | null;
  /** SEO metadata for the storefront product page. */
  seo?: {
    title?: string;
    description?: string | null;
    slug?: string;
  };
}

/**
 * Operator-supplied commerce/physical product fields beyond the core
 * name/price/stock. Shop-neutral: WooCommerce, Shopify, … adapters map the keys
 * they support and ignore the rest. Every field is optional; an absent field is
 * left unset on the shop (never sent as empty/zero).
 */
export interface PublishProductCommerce {
  /**
   * Discounted sale price. Currency should match the shop/connection locale
   * (shops typically apply the store currency, so adapters may use only the
   * amount). Absent ⇒ no sale price is set.
   */
  salePrice?: { amount: number; currency: string };
  /** ISO 8601 datetime the sale price becomes active. Absent ⇒ immediate/unset. */
  saleStartsAt?: string;
  /** ISO 8601 datetime the sale price expires. Absent ⇒ open-ended/unset. */
  saleEndsAt?: string;
  /** Physical dimensions. Each axis optional; an absent axis is left unset. */
  dimensions?: { length?: number; width?: number; height?: number };
  /** Tax class slug (shop-defined, e.g. WooCommerce "reduced-rate"). Absent ⇒ shop default. */
  taxClass?: string;
  /** Whether/how the product is taxed. Absent ⇒ shop default. */
  taxStatus?: PublishTaxStatus;
}

/**
 * Cross-shop variant-grouping hint (#1836), the shop-publish sibling of
 * `OfferVariantGroup` (#1065). Present only when this variant is one sibling of
 * a multi-variant product that should publish as ONE grouped shop record
 * (WooCommerce variable product + variations; Shopify product + variants) —
 * absent means standalone (single-variant / simple products keep the exact
 * pre-#1836 simple-product path).
 *
 * Distinct from `OfferVariantGroup` (not reused) because a shop grouping needs
 * two things a marketplace offer grouping does not: the full union of
 * distinguishing attribute values across every sibling (a shop parent record
 * must declare its variation axes up front — WC "variation-flagged" attribute
 * options, Shopify product `options`), and the already-resolved parent
 * shop-native id so the adapter can upsert the parent instead of guessing.
 */
export interface PublishProductVariantGroup {
  /**
   * Opaque, stable grouping token shared by every sibling of the same product
   * (today the parent OL product id). Adapters treat it as an opaque key, same
   * contract as `OfferVariantGroup.groupId` — never parsed or path-routed.
   */
  groupId: string;
  /** This variant's own distinguishing attribute values, flattened from `ProductVariant.attributes`. */
  attributes: OfferVariantAttribute[];
  /**
   * Union of every sibling's distinguishing attribute values, keyed by
   * attribute name (e.g. `{ Color: ['Red', 'Blue'], Size: ['S', 'M'] }`) — the
   * full option set the destination's parent record must declare so any
   * sibling variation can select from it. Assembled once by the builder from
   * `getVariantsByProductId`, so every sibling's publish carries the same set
   * regardless of publish order.
   */
  groupAttributeValues: Record<string, string[]>;
  /**
   * The parent's shop-native product id when it has already been published on
   * this connection (resolved by the execution service via the `ShopProduct`
   * mapping keyed on `groupId`). `null`/absent ⇒ the parent does not exist yet;
   * the adapter creates it as part of this call.
   */
  externalParentProductId?: string | null;
}

/**
 * Command to publish (create-or-upsert) a product onto a shop destination.
 *
 * Shop-neutral contract. WooCommerce, Shopify, … adapters translate this into
 * their platform-specific create/update product API call internally.
 */
export interface PublishProductCommand {
  /** OL internal variant id being published. */
  internalVariantId: string;
  /**
   * Variant SKU / reference (OL variants own the SKU). Populated from
   * `ProductVariant.sku` by the publish builder. Optional: publishers that
   * expose a SKU field map it; those that don't simply ignore it. Absent ⇒ the
   * publisher does not set a SKU (created without one / left unchanged on update).
   */
  sku?: string;
  /** Target shop connection id. */
  connectionId: string;
  /**
   * Destination category ids the product is placed under. Multiple, because
   * shops (unlike marketplaces) allow multi-category placement (ADR-024 §1).
   * Resolved/provisioned upstream by the ADR-023 placement chain +
   * `CategoryProvisioner`.
   */
  destinationCategoryIds: string[];
  /** Product price. Currency should match the shop/connection locale. */
  price: { amount: number; currency: string };
  /** Stock quantity, as a product/variant field on the shop. */
  stock: number;
  /** Target publication state (visibility is decoupled from record creation). */
  status: PublishProductStatus;
  /** Owned-record content fields (title, description, images, SEO). */
  content?: PublishProductContent;
  /**
   * Product barcode (GTIN/EAN). Master-derived by the builder from the variant
   * (`ProductVariant.gtin` ?? `ProductVariant.ean`). Absent ⇒ the variant has no
   * barcode and the field is left unset on the shop.
   */
  barcode?: string;
  /**
   * Physical weight in the shop's configured weight unit. Master-derived by the
   * builder (`ProductVariant.weight` ?? `Product.weight`). Absent ⇒ left unset.
   */
  weight?: number;
  /**
   * Operator-supplied commerce/physical fields (sale price + schedule,
   * dimensions, tax class/status). Shop-neutral; adapters map the keys they
   * support. Absent ⇒ no operator overrides for these fields.
   */
  commerce?: PublishProductCommerce;
  /**
   * Neutral, section-tagged projected/operator category parameters (#1072,
   * ADR-024 §Flow). Produced by core (attribute projection on the ADR-023
   * open-provenance pass-through); shaped to the shop's wire form **only** in
   * the destination adapter (WooCommerce → global/custom attributes, Shopify →
   * category metafields). Shares the exact `OfferParameter` channel the offer
   * side uses (#1039) so offer and shop carry projected parameters identically
   * — they do **not** ride `platformParams`. Absent/empty ⇒ no projected
   * parameters for this product.
   */
  parameters?: OfferParameter[];
  /**
   * Shop-native product id when this is an upsert (already published). Absent /
   * `null` → create a new product and map it. Resolved by the #1042 execution
   * service via `IdentifierMapping`. For a **grouped** publish (`variantGroup`
   * present), this is the variant's own variation id (or absent to create a
   * new variation under the parent) — the parent id lives on
   * `variantGroup.externalParentProductId`.
   */
  externalProductId?: string | null;
  /**
   * Platform-neutral variant-grouping hint (#1836), populated by
   * `ProductPublishBuilderService` for a sibling of a multi-variant product.
   * Adapters that support native variable-product grouping (WooCommerce)
   * publish one shared parent record + one child variation per sibling;
   * adapters without that concept ignore it and publish standalone. Absent ⇒
   * single-variant / simple products, unchanged simple-product path.
   */
  variantGroup?: PublishProductVariantGroup;
  /** Optional idempotency key for deduplication at the adapter / job layer. */
  idempotencyKey?: string;
  /**
   * Un-modeled platform-specific shop knobs the adapter interprets directly
   * (tax class, shipping class, product type, …). **NOT** category parameters —
   * those travel on `parameters` as the neutral `OfferParameter` channel (#1072).
   * The core command stays platform-neutral; adapters read only the keys they know.
   */
  platformParams?: Record<string, unknown>;
}

/**
 * Result returned by `ShopProductManagerPort.publishProduct`.
 *
 * A non-throwing response means the product record was successfully created or
 * updated on the shop (the `externalProductId` exists). Adapters throw
 * `ProductPublishRejectedException` only on rejections where no record was
 * created/updated.
 */
export interface PublishProductResult {
  /**
   * Shop-native id of the created/updated product. For a grouped publish
   * (`command.variantGroup` present) this is the variant's own variation id,
   * NOT the parent id — the parent id is reported separately on
   * `externalParentProductId`.
   */
  externalProductId: string;
  /** Observed publication state immediately after the publish call. */
  status: PublishProductStatus;
  /** Non-fatal warnings (e.g. an optional attribute the shop dropped). Omitted when empty. */
  warnings?: string[];
  /**
   * The resolved (created-or-reused) parent product id, present only when
   * `command.variantGroup` was set (#1836). The execution service persists the
   * `ShopProduct` mapping keyed on `variantGroup.groupId` from this value when
   * no such mapping existed yet — same idempotent-write posture as the
   * variant's own `externalProductId`.
   */
  externalParentProductId?: string;
}
