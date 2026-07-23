/**
 * Bulk wizard internal types
 *
 * Co-located row + step + policy types used only inside the wizard subtree.
 * Public BE transport types live in `../api/bulk-listings.types.ts`.
 *
 * #792 PR 3 replaced the single-string row status with a multi-blocker model
 * (`blockers`) plus master-pull pricing/stock policies; #795 collapsed the
 * per-row category resolve into one batch call.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { Product, ProductVariant } from '../../../products';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { EanMatchCandidate } from '../../api/listings.types';

export const BulkWizardStepValues = [
  'config',
  'resolve',
  'review',
  'confirm',
] as const;
export type BulkWizardStep = (typeof BulkWizardStepValues)[number];

/**
 * Per-row blockers (#792). Co-occurring - a row can carry several at once
 * (e.g. `['no-ean', 'no-master-price']`). A row is **ready** iff its
 * `blockers` list is empty; the Review-step "Approve all" gate counts any
 * row with `blockers.length > 0` as not-ready.
 */
export const BulkRowBlockerValues = [
  // Product has no primary variant - cannot bulk-list.
  'no-variant',
  // Primary variant has no EAN/GTIN - operator must pick a category manually.
  'no-ean',
  // EAN present but Allegro returned zero matches.
  'no-match',
  // EAN matched several Allegro cards - operator picks one from the candidates.
  'multi-match',
  // Active pricing policy needs a master price and the variant has none.
  'no-master-price',
  // Active stock policy needs a master stock value and it's 0 or null.
  'no-master-stock',
  // Master price currency differs from the batch currency (use-master/markup only).
  'currency-mismatch',
  // Variant already has a live OfferMapping on the target connection (#1741,
  // create-only) - informational; exclude it to avoid a duplicate offer.
  'already-listed',
] as const;
/**
 * Host-neutral blocker ids - generic across every `OfferManager` marketplace
 * (variant/EAN/category/price/stock). Platform-specific blockers (e.g.
 * Allegro's `allegro:needs-product-parameters` (#810), Erli's
 * `erli:missing-image`) are NOT in this union - they're declared by each
 * plugin's `offerValidation` contribution as open-world namespaced strings and
 * concatenated onto the neutral set at compute time (#1096). A row's `blockers`
 * array therefore holds `string`, not the closed union.
 */
export type BulkRowNeutralBlocker = (typeof BulkRowBlockerValues)[number];
/** A blocker id on a row - neutral-host or plugin-declared (open-world). */
export type BulkRowBlocker = string;

/**
 * Provenance of a computed price/stock value - drives the Review-step badge.
 * `master` shows no badge; `policy` / `override` get a tonal badge (#792).
 */
export const BulkValueSourceValues = ['master', 'policy', 'override'] as const;
export type BulkValueSource = (typeof BulkValueSourceValues)[number];

/** Pricing policy applied batch-wide; per-row override still wins (#792). */
export const PricingPolicyModeValues = ['use-master', 'markup', 'flat'] as const;
export type PricingPolicyMode = (typeof PricingPolicyModeValues)[number];
export type PricingPolicy =
  | { mode: 'use-master' }
  // percent ∈ [-100, +500]; computed = roundHalfUp(master × (1 + percent/100), 2)
  | { mode: 'markup'; percent: number }
  // amount in the batch-wide currency (D7 - flat carries no own currency)
  | { mode: 'flat'; amount: number };

/** Stock policy applied batch-wide; per-row override still wins (#792). */
export const StockPolicyModeValues = ['use-master', 'cap', 'flat'] as const;
export type StockPolicyMode = (typeof StockPolicyModeValues)[number];
export type StockPolicy =
  | { mode: 'use-master' }
  | { mode: 'cap'; value: number } // computed = min(masterStock, value)
  | { mode: 'flat'; value: number };

/**
 * Per-sibling row inside a product (#1741). The wizard fans each selected
 * product out into one `BulkVariantRow` per real variant (or the single
 * synthetic/simple variant) and resolves + reviews each independently. The
 * BE receives per-variant overrides keyed by `variantId` and exclusions from
 * `included === false`. `masterCurrency`/`masterPrice` are product-level in
 * source data but carried per-variant here so the blocker maths stays uniform.
 */
export interface BulkVariantRow {
  /** Actual OL variant id (the fan-out + override map key). */
  variantId: string;
  /** The hydrated sibling variant entity. */
  variant: ProductVariant;
  /** Effective EAN/GTIN - variant barcode unless the operator overrode it. Null when neither. */
  ean: string | null;
  /** Distinguishing attributes (variant.attributes) - drives the rail label + Rozmiar field. */
  distinguishingAttributes: Record<string, string> | null;
  /** Per-variant master stock (#823); null while unresolved. */
  masterStock: number | null;
  /** Master price (product-level, mirrored per variant for uniform maths). */
  masterPrice: number | null;
  /** Master price currency. */
  masterCurrency: string | null;
  /** Operator inclusion - the single source of truth; exclusions derive from `!included`. */
  included: boolean;
  /** Active per-variant blockers; empty means ready. */
  blockers: readonly BulkRowBlocker[];
  /** Resolved marketplace category for this variant's own EAN. */
  resolvedCategoryId: string | null;
  /** Catalogue card id from this variant's unique EAN match (#808). */
  resolvedProductCardId: string | null;
  resolutionMethod: 'auto_detect' | 'category_mapping' | 'manual' | null;
  /** Multi-match candidates for this variant's EAN. */
  categoryCandidates: readonly EanMatchCandidate[];
  /** Per-variant override written by the editor; sent as `perVariantOverrides[variantId]`. */
  override: BulkPerProductOverride;
  /** FE-only RHF value stash so reopening the editor restores entered values. */
  editFormValues?: Record<string, unknown>;
  /** True when this row already has a live OfferMapping on the target connection (#1741, best-effort). */
  alreadyListed?: boolean;
}

export interface BulkWizardRow {
  productId: string;
  /** Hydrated when products query resolves; null while loading or on 404. */
  product: Product | null;
  /** Primary variant (variants[0]). Null when product has no variants. */
  primaryVariant: ProductVariant | null;
  /**
   * Per-sibling rows (#1741) - the source of truth for the per-variant Review,
   * editor, exclusions, and submit fan-out. Empty when the product has no
   * variants. A product with exactly one entry renders flat (no expand).
   */
  variants: BulkVariantRow[];
  /** Active blockers; empty means ready. Populated by the Resolve step (#792). */
  blockers: readonly BulkRowBlocker[];
  /** Resolved Allegro category id (after Resolve, or operator pick). */
  resolvedCategoryId: string | null;
  /**
   * Catalogue product-card id from a unique EAN match (#808). Threaded to
   * `overrides.productCardId` on submit so the adapter links the card and
   * inherits its required product parameters. Null when no unique match.
   */
  resolvedProductCardId: string | null;
  /** How the category was resolved (telemetry / UI hint). */
  resolutionMethod: 'auto_detect' | 'category_mapping' | 'manual' | null;
  /** Master variant price captured at resolve (`variant.price`). Null if unset. */
  masterPrice: number | null;
  /** Master stock summed across locations (availability endpoint). Null if absent. */
  masterStock: number | null;
  /** Master price currency (`product.currency`). Null if the product has none. */
  masterCurrency: string | null;
  /** Multi-match category candidates; empty unless the row's blocker is `multi-match`. */
  categoryCandidates: readonly EanMatchCandidate[];
  /** Per-row overrides written by the edit modal. Sent on bulk submit. */
  override: BulkPerProductOverride;
  /**
   * FE-only stash of the edit-modal's React Hook Form values so reopening
   * the modal restores entered values. Strictly internal; never forwarded
   * on the wire (the wizard's submit only reads `override`).
   */
  editFormValues?: Record<string, unknown>;
}

export interface BulkWizardConfig {
  connectionId: string;
  /**
   * Generic per-platform offer knobs the config section populated (#1096):
   * Allegro `deliveryPolicyId`, Erli `dispatchTime`, … Threaded verbatim to
   * `sharedConfig.overrides.platformParams` on submit. Replaces the former
   * hardcoded `deliveryPolicyId` field (which was Allegro-shaped).
   */
  platformParams: Record<string, unknown>;
  /** Batch-wide listing currency (D7) - flat-price + mismatch reason key off this. */
  currency: string;
  /** How each row's price is computed from master data. */
  pricingPolicy: PricingPolicy;
  /** How each row's stock is computed from master data. */
  stockPolicy: StockPolicy;
  publishImmediately: boolean;
  generateDescription: boolean;
}
