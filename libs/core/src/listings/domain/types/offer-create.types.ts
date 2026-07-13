/**
 * Offer Create Types
 *
 * Command and result types for creating a new offer on a marketplace (outbound,
 * OpenLinker → marketplace) via `OfferManagerPort.createOffer`. Command is
 * marketplace-neutral; adapter-specific fields (Allegro delivery policy IDs,
 * eBay shipping options, WooCommerce tax classes, etc.) are carried through
 * `overrides.platformParams` as an opaque record the adapter interprets.
 *
 * @module libs/core/src/listings/domain/types
 */

import type { OfferParameter } from './offer-parameter.types';

/**
 * Marketplace-neutral item condition (#1500).
 *
 * A small closed set sufficient for the marketplaces OL targets today (Allegro's
 * "Stan", Erli's borrowed Allegro taxonomy); richer vocabularies (refurbished,
 * damaged, …) can extend it later. The neutral value carries no platform id —
 * each destination adapter owns the neutral → wire mapping (Allegro "Stan" 11323
 * dictionary value id; Erli `source:"allegro"` 11323). Marketplaces require a
 * condition on offer creation, so `OfferBuilderService` defaults it to `'new'`
 * when the operator supplies none.
 */
export const OfferConditionValues = ['new', 'used'] as const;
export type OfferCondition = (typeof OfferConditionValues)[number];

/**
 * A source-shop category reference carried through from the master catalog
 * (#1096). Platform-neutral: a destination that accepts shop-native taxonomy
 * (Erli `source:"shop"`, ADR-025 §3) maps these to its wire shape when no
 * marketplace category was resolved; destinations that require a resolved
 * marketplace category (Allegro) ignore them. `name` is best-effort (the master
 * may expose only ids).
 */
export interface SourceCategoryRef {
  id: string;
  name?: string;
}

/**
 * A source-shop product attribute (product *feature*) carried through from the
 * master catalog (#1096, F2). Platform-neutral: a destination that accepts
 * shop-native attributes (Erli `externalAttributes` `source:"shop"`, ADR-025 §3)
 * maps these to its wire shape; destinations that require a resolved marketplace
 * parameter (Allegro) ignore them. Distinct from `OfferParameter` (resolved,
 * marketplace-scoped parameters) and from `OfferVariantAttribute` (a variant's
 * distinguishing grouping axis). `id` is a stable slug of the feature name; `name`
 * is the human label; `unit` is best-effort (the master may expose only name/value).
 */
export interface SourceAttribute {
  id?: string;
  name: string;
  value: string;
  unit?: string;
}

/**
 * Overrides for fields that can optionally be customized per-offer.
 * Any field omitted here falls back to a value derived by the core builder
 * service from the OL variant (e.g. variant.name, variant.description).
 *
 * For fields typed `T | null | undefined`, the builder strips both `null`
 * and `undefined` before the command reaches an adapter — both mean "no
 * override" and fall back to the variant/product value if any.
 */
export interface CreateOfferOverrides {
  /** Offer title. Falls back to variant name. */
  title?: string;
  /**
   * Offer description (HTML or rich text depending on platform). Falls back
   * to variant description. `null` or `undefined` both mean "no override".
   */
  description?: string | null;
  /** Platform-specific category id (e.g. Allegro category id). */
  categoryId?: string;
  /**
   * Platform-specific catalogue product-card id resolved from the variant's
   * barcode (e.g. an Allegro product-card UUID). When present, adapters that
   * support catalogue smart-linking (#431) link the offer to the existing
   * card — so required product parameters (Brand, Type, EAN, …) are inherited
   * from the card rather than supplied inline. Carried FE→BE so a resolution
   * the wizard already performed isn't redone (and weakened) at create time.
   */
  productCardId?: string;
  /**
   * Image URLs in display order. Falls back to variant images. `null` or
   * `undefined` both mean "no override".
   */
  imageUrls?: string[] | null;
  /**
   * Operator-supplied neutral category parameters (#1071). Section-tagged
   * `OfferParameter[]` the operator picked in the wizard — the *request* half
   * of the carriage `CreateOfferCommand.parameters` carries as merged output.
   * The builder merges these with attribute-projection output (operator wins
   * by id) into `command.parameters`; the destination adapter does the wire
   * shaping. Distinct from `platformParams` (un-modeled platform knobs) — and
   * **not** copied onto `command.overrides`; it is consumed into
   * `command.parameters` only. Rides the existing `overrides` threading
   * (enqueue → execute → snapshot → retry) so operator params persist for free.
   */
  parameters?: OfferParameter[];
  /**
   * Platform-specific parameters the adapter interprets directly.
   *
   * Examples by platform:
   * - Allegro: `{ deliveryPolicyId, returnPolicyId, warrantyId, impliedWarrantyId }`
   * - eBay: shipping service options, listing duration
   * - WooCommerce: tax class, shipping class, product type
   *
   * `platformParams` no longer carries category parameters (#1071) — those
   * travel on `parameters` above. The core command stays platform-neutral;
   * adapters read only the keys they know.
   */
  platformParams?: Record<string, unknown>;
}

/**
 * One distinguishing axis of a grouped variant, e.g. `{ name: 'Color', value: 'Red' }`.
 * Flattened from `ProductVariant.attributes` (`Record<string, string>`) by the
 * core builder. Platform-neutral: an adapter that groups explicitly (Erli) maps
 * it field-for-field to its own wire shape; auto-grouping adapters ignore it.
 */
export interface OfferVariantAttribute {
  name: string;
  value: string;
}

/**
 * Cross-marketplace variant-grouping hint. Present only when the offer is one
 * sibling of a multi-variant product the platform should render as a single
 * grouped listing. Platform-neutral: each adapter maps it to its own grouping
 * mechanism (Erli `externalVariantGroup`; auto-grouping platforms like Allegro
 * ignore it). Absent ⇒ list standalone (single-variant / simple products).
 */
export interface OfferVariantGroup {
  /**
   * Opaque, stable grouping token shared by every sibling of the same product
   * (today the parent OL product id, `variant.productId`). Adapters MUST treat
   * it as an opaque grouping key and forward it to their own grouping mechanism
   * — never parse it, attribute meaning to it, or assume a particular id shape
   * (it is NOT necessarily the same shape as a variant id). The "= parent
   * product id" is a core-private convention, not part of the contract.
   */
  groupId: string;
  /** This variant's distinguishing axes, flattened from ProductVariant.attributes. */
  attributes: OfferVariantAttribute[];
}

/**
 * Command to create a new marketplace offer.
 *
 * Marketplace-neutral contract. Allegro, eBay, WooCommerce, Shopify adapters
 * translate this into their platform-specific create-offer API call internally.
 */
export interface CreateOfferCommand {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id. */
  connectionId: string;
  /** Offer price. Currency should match marketplace/connection locale. */
  price: { amount: number; currency: string };
  /** Offered quantity. */
  stock: number;
  /** If true, publish the offer immediately after creation; otherwise leave as draft. */
  publishImmediately: boolean;
  /** Optional overrides and platform-specific fields. */
  overrides?: CreateOfferOverrides;
  /**
   * Neutral, section-tagged offer/category parameters (#1039, ADR-023 §3 /
   * ADR-024 §Flow) — produced in core by attribute projection (and, in the
   * end-state, operator picks). The destination adapter is the **only** place
   * that shapes these to platform wire: Allegro splits by `section` into
   * `body.parameters[]` (offer) vs `productSet[].product.parameters[]`
   * (product); a borrows/open destination maps them to its own param shape.
   *
   * Distinct from `overrides.platformParams`, which carries un-modeled
   * platform knobs (delivery policy id, invoice type, …) the adapter reads
   * by key. Absent/empty ⇒ no projected parameters for this offer.
   */
  parameters?: OfferParameter[];
  /** Optional idempotency key for deduplication at the adapter / job layer. */
  idempotencyKey?: string;
  /**
   * Variant barcode (EAN ?? GTIN) carried through from the master catalog.
   * Adapters that support smart-linking to existing marketplace product
   * cards (e.g. Allegro #431) use it to look up an existing card before
   * falling back to inline product creation. Pre-resolved by
   * `OfferBuilderService` so adapters don't have to re-fetch the variant.
   * `null` means "no usable barcode" (variant has neither EAN nor GTIN).
   */
  variantBarcode?: string | null;
  /**
   * Pre-resolved catalogue product-card id (e.g. Allegro product-card UUID),
   * lifted by `OfferBuilderService` from `overrides.productCardId`. When set,
   * smart-linking adapters link this card directly via the platform's product
   * set and skip re-resolving by barcode — Allegro then inherits the card's
   * required product parameters. `null`/absent means "resolve from barcode".
   */
  productCardId?: string | null;
  /**
   * Platform-neutral variant-grouping hint (#1065), populated by
   * `OfferBuilderService` for a sibling of a multi-variant product. Adapters
   * that group explicitly (Erli) map it to their wire shape; auto-grouping
   * adapters (Allegro) ignore it. Absent ⇒ standalone listing (single-variant /
   * simple products). Kept off `overrides` so adapters see it as a top-level
   * pre-resolution alongside `variantBarcode` / `productCardId`.
   */
  variantGroup?: OfferVariantGroup;
  /**
   * Marketplace-neutral item condition (#1500). Defaulted to `'new'` by
   * `OfferBuilderService` when the operator supplies none, so every core-built
   * command carries a condition and non-UI / borrows paths no longer silently
   * omit the marketplace-required condition parameter. Each destination adapter
   * maps it to its wire shape (Allegro "Stan" 11323 dictionary value; Erli
   * `source:"allegro"` 11323) and MUST NOT override an operator-supplied
   * condition parameter already present in `parameters` (operator intent wins,
   * never double-set). Platform-neutral: no platform id lives in core.
   */
  condition?: OfferCondition;
  /**
   * Source-shop category references (master-derived), platform-neutral (#1096).
   * Threaded by `OfferBuilderService` from the master product's categories. A
   * destination that accepts shop-native taxonomy (Erli `source:"shop"`) uses
   * these as a fallback when no marketplace category was resolved; adapters that
   * require a resolved marketplace category (Allegro) ignore them. Absent/empty ⇒
   * the product carried no source categories.
   */
  sourceCategories?: SourceCategoryRef[];
  /**
   * Source-shop product attributes (master-derived product features),
   * platform-neutral (#1096, F2). Threaded by `OfferBuilderService` from the
   * master product's features. A destination that accepts shop-native attributes
   * (Erli `externalAttributes` `source:"shop"`) emits these; adapters that require
   * a resolved marketplace parameter (Allegro) ignore them. Absent/empty ⇒ the
   * product carried no features.
   */
  sourceAttributes?: SourceAttribute[];
}

/**
 * Momentary status returned by the adapter right after the platform API call.
 *
 * - `draft`: Offer created on platform, not yet published.
 * - `validating`: Platform is asynchronously validating the offer (Allegro pattern).
 *   Caller must poll / listen for final outcome before treating the offer as live.
 * - `active`: Offer is live and visible to buyers.
 *
 * Not to be confused with the persisted `OfferCreationStatus` lifecycle — see
 * `offer-creation-record.types.ts`.
 */
export const CreateOfferResultStatusValues = ['draft', 'validating', 'active'] as const;
export type CreateOfferResultStatus = (typeof CreateOfferResultStatusValues)[number];

/**
 * Validation error reported by the marketplace during offer creation.
 *
 * Neutral shape mapped from platform-specific error formats by the adapter.
 * Adapters that do not surface validation errors (WooCommerce, direct-API
 * platforms) leave `validationErrors` unset on the result.
 */
export interface CreateOfferValidationError {
  /** Dotted field path reported by the platform, when available (e.g. `parameters.EAN`). */
  field?: string;
  /** Platform-specific or OL-normalized error code (e.g. `PARAMETER_REQUIRED`). */
  code: string;
  /** Human-readable message suitable for displaying to an operator. */
  message: string;
}

/**
 * Result returned by `OfferManagerPort.createOffer`.
 *
 * A non-throwing response means the offer was successfully *created* on the
 * platform (the `externalOfferId` exists) even if `validationErrors` is
 * populated — that represents "created as draft but with issues blocking
 * publication," which is a valid, recoverable state. Adapters only throw on
 * non-2xx responses where no offer was created.
 */
export interface CreateOfferResult {
  /** Marketplace-native id of the newly created offer. */
  externalOfferId: string;
  /** Adapter-reported status immediately after the create call. */
  status: CreateOfferResultStatus;
  /**
   * Structured validation errors the platform reported inline (2xx response
   * with validation issues). Omitted when empty.
   */
  validationErrors?: CreateOfferValidationError[];
  /**
   * True when the adapter resolved the create idempotently because the offer
   * already existed on the platform (#1096) — e.g. Erli's seller-keyed 409. The
   * execution service records this as `reused` (a success) rather than `draft`,
   * so the UI distinguishes a re-run from a fresh create. Omitted ⇒ fresh create.
   */
  alreadyExisted?: boolean;
}
