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
 * Platform-specific fields (and projected category parameters, applied by the
 * #1042 builder) ride in `platformParams` as an opaque record the adapter
 * interprets — mirroring `CreateOfferOverrides.platformParams`. The command is
 * deliberately free of the application-layer `ResolvedParameter` shape so it
 * stays domain-pure (no domain→application edge).
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link ShopProductManagerPort} for the port that consumes these.
 */

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
 * Command to publish (create-or-upsert) a product onto a shop destination.
 *
 * Shop-neutral contract. WooCommerce, Shopify, … adapters translate this into
 * their platform-specific create/update product API call internally.
 */
export interface PublishProductCommand {
  /** OL internal variant id being published. */
  internalVariantId: string;
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
   * Shop-native product id when this is an upsert (already published). Absent /
   * `null` → create a new product and map it. Resolved by the #1042 execution
   * service via `IdentifierMapping`.
   */
  externalProductId?: string | null;
  /** Optional idempotency key for deduplication at the adapter / job layer. */
  idempotencyKey?: string;
  /**
   * Platform-specific fields the adapter interprets directly (tax class,
   * shipping class, product type, projected category parameters, …). The
   * core command stays platform-neutral; adapters read only the keys they know.
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
  /** Shop-native id of the created/updated product. */
  externalProductId: string;
  /** Observed publication state immediately after the publish call. */
  status: PublishProductStatus;
  /** Non-fatal warnings (e.g. an optional attribute the shop dropped). Omitted when empty. */
  warnings?: string[];
}
