/**
 * Bulk wizard pricing/stock policy + blocker computation (#792 PR 3)
 *
 * Pure, side-effect-free helpers for the bulk wizard: pricing/stock resolution
 * + blocker computation, plus the #808 card-link selector and #810
 * product-parameter derivation. Consumed by the Resolve step (initial blocker
 * compute), the Review step (computed value + provenance rendering), the
 * Edit-save handler + schema-reconcile effect (`recomputeRowBlockers`), and the
 * submit path (`selectBulkProductCardId`). Kept isolated from React so the
 * policy maths are unit-testable without rendering.
 *
 * Resolution precedence: master → policy → per-row override (override wins).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type {
  CategoryParameterLike,
  OfferRowValidationInput,
  SuppliedParameterLike,
} from '../../../../shared/plugins';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { EanMatchResult } from '../../api/listings.types';
import { collapseToInvalidBarcode } from './bulk-blockers';
import type {
  BulkRowBlocker,
  BulkValueSource,
  BulkVariantRow,
  BulkWizardConfig,
  BulkWizardRow,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

const PRICE_DECIMALS = 2;
const MARKUP_MIN_PERCENT = -100;
const MARKUP_MAX_PERCENT = 500;

export interface ResolvedPrice {
  value: number | null;
  source: BulkValueSource;
  blocker: 'no-master-price' | null;
}

export interface ResolvedStock {
  value: number | null;
  source: BulkValueSource;
  blocker: 'no-master-stock' | null;
}

/** Half-up rounding to `dp` decimals. Inputs here are non-negative (factor ≥ 0). */
export function roundHalfUp(value: number, dp = PRICE_DECIMALS): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clampMarkupPercent(percent: number): number {
  return Math.min(MARKUP_MAX_PERCENT, Math.max(MARKUP_MIN_PERCENT, percent));
}

export function computeResolvedPrice(
  policy: PricingPolicy,
  masterPrice: number | null,
  override: BulkPerProductOverride,
): ResolvedPrice {
  if (override.price !== undefined) {
    // An explicit per-row amount is authoritative, but it still has to be
    // publishable: `CreateOfferPriceDto.amount` is `@IsPositive()` and is
    // validated per map value, so a single `0` rejects the WHOLE batch with an
    // opaque `price: invalid value` (#1934/F3). Block it on the row instead.
    return override.price.amount > 0
      ? { value: override.price.amount, source: 'override', blocker: null }
      : { value: null, source: 'override', blocker: 'no-master-price' };
  }
  switch (policy.mode) {
    case 'flat':
      // Operator's explicit batch-wide amount. Same `@IsPositive()` floor as
      // the override path above - `markup` and `use-master` already guard it.
      return policy.amount > 0
        ? { value: policy.amount, source: 'policy', blocker: null }
        : { value: null, source: 'policy', blocker: 'no-master-price' };
    case 'markup': {
      if (masterPrice === null) {
        return { value: null, source: 'policy', blocker: 'no-master-price' };
      }
      const factor = 1 + clampMarkupPercent(policy.percent) / 100;
      const value = roundHalfUp(masterPrice * factor);
      // A markup that zeroes the price (e.g. -100%) can't publish on Allegro;
      // flag it client-side so the operator sets a per-row price instead.
      return value > 0
        ? { value, source: 'policy', blocker: null }
        : { value: null, source: 'policy', blocker: 'no-master-price' };
    }
    case 'use-master':
    default:
      // Null or non-positive master price has no usable value to publish.
      if (masterPrice === null || masterPrice <= 0) {
        return { value: null, source: 'master', blocker: 'no-master-price' };
      }
      return { value: masterPrice, source: 'master', blocker: null };
  }
}

export function computeResolvedStock(
  policy: StockPolicy,
  masterStock: number | null,
  override: BulkPerProductOverride,
): ResolvedStock {
  if (override.stock !== undefined) {
    return { value: override.stock, source: 'override', blocker: null };
  }
  switch (policy.mode) {
    case 'flat':
      return { value: policy.value, source: 'policy', blocker: null };
    case 'cap': {
      if (masterStock === null) {
        return { value: null, source: 'policy', blocker: 'no-master-stock' };
      }
      // min(master, N); 0-stock can't publish on Allegro, so it blocks too.
      const value = Math.min(masterStock, policy.value);
      return { value, source: 'policy', blocker: value <= 0 ? 'no-master-stock' : null };
    }
    case 'use-master':
    default:
      if (masterStock === null || masterStock <= 0) {
        return { value: masterStock, source: 'master', blocker: 'no-master-stock' };
      }
      return { value: masterStock, source: 'master', blocker: null };
  }
}

/**
 * Per-product policy resolution (#1741). A row's shared-base scope may carry a
 * pricing/stock policy that diverges from the batch default; when present it
 * wins for that product's variants, else the batch policy applies.
 */
export function effectivePricingPolicy(
  override: BulkPerProductOverride,
  batch: PricingPolicy,
): PricingPolicy {
  return override.pricingPolicy ?? batch;
}

export function effectiveStockPolicy(
  override: BulkPerProductOverride,
  batch: StockPolicy,
): StockPolicy {
  return override.stockPolicy ?? batch;
}

/** Structural equality for a pricing policy (mode + its parameter). */
export function pricingPolicyEquals(a: PricingPolicy, b: PricingPolicy): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'markup' && b.mode === 'markup') return a.percent === b.percent;
  if (a.mode === 'flat' && b.mode === 'flat') return a.amount === b.amount;
  return true;
}

/** Structural equality for a stock policy (mode + its parameter). */
export function stockPolicyEquals(a: StockPolicy, b: StockPolicy): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'cap' && b.mode === 'cap') return a.value === b.value;
  if (a.mode === 'flat' && b.mode === 'flat') return a.value === b.value;
  return true;
}

export interface ComputeBlockersInput {
  hasVariant: boolean;
  /**
   * Per-variant category outcome. The Resolve step synthesizes `{ kind: 'no-ean' }`
   * for variant rows without a barcode (no BE call); `undefined` is treated
   * defensively as `no-match`.
   */
  categoryResult: CategoryOutcome | undefined;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  masterPrice: number | null;
  masterStock: number | null;
  masterCurrency: string | null;
  batchCurrency: string;
  override: BulkPerProductOverride;
  /**
   * True when the submit will link an Allegro catalogue card (#808), which
   * inherits the category's required product parameters. Card-linked rows are
   * never blocked for missing product params. Omitted (undefined) at resolve
   * time, where no-card rows have no category yet - treated as not-blocking.
   */
  willLinkProductCard?: boolean;
  /**
   * Required `section: 'product'` parameter ids for the row's submit category
   * (unconditional only - `dependsOn`-gated params are excluded). undefined =
   * schema not loaded yet → do not block (avoids flicker). (#810)
   */
  requiredProductParamIds?: readonly string[];
  /**
   * Resolved master image count for the row (#1096). Fed to the platform
   * validator (Erli requires ≥1 image). 0 / undefined ⇒ no images.
   */
  imageCount?: number;
  /**
   * The title the submit would carry for this row (#1962) - the row's own title
   * override when the operator set one, else the master product name (mirroring
   * the core builder's `overrides?.title ?? product.name`). Fed to the platform
   * validator, which owns any length limit. Omitted ⇒ empty string, which no
   * length rule can reject.
   */
  effectiveTitle?: string;
  /**
   * Per-platform row validator (#1096) - the resolved connection's
   * `offerValidation.validateRow`. When present, its returned blocker ids are
   * concatenated onto the neutral set. Absent ⇒ only neutral blockers apply.
   */
  platformValidate?: (input: OfferRowValidationInput) => string[];
  /**
   * True for a destination that resolves the category server-side at submit
   * rather than via the client-side pre-flight EAN match (#1096). Such a
   * destination `borrows` its taxonomy (no `EanCategoryMatcher`, e.g. Erli -
   * `OfferBuilderService` resolves it from override → barcode → category mapping
   * at create time, ADR-025 §3). For these, a pre-flight `no-match`/`no-ean`/
   * `multi-match` is NOT a blocker - the operator may still pin a category via
   * the row override. Omitted ⇒ false (the Allegro pre-flight-match path).
   */
  destinationResolvesCategoryAtSubmit?: boolean;
  /**
   * The PRODUCT-tier category the submit would pin for this row (#2240) - the
   * shared-base override, else the product's own resolved category. A sibling
   * inherits it (`handleSubmit`'s `familyCategoryId`), so it clears the category
   * blocker exactly as a per-variant override does.
   *
   * Before #2240 readiness read the variant tier only, so setting the shared
   * category - the action the blocker banner recommended - could never clear the
   * chip on a multi-variant product, while the submit went on to pin that very
   * category. Omitted ⇒ no product-tier category.
   */
  productCategoryId?: string | null;
  /**
   * The submit category's full parameter schema (#2243). Every bound a value is
   * checked against comes from here; absent ⇒ nothing value-level runs.
   */
  categoryParameters?: readonly CategoryParameterLike[];
  /** Parameters the OPERATOR supplied for this row (#2243). */
  suppliedParameters?: readonly SuppliedParameterLike[];
  /** Effective barcode for the row - operator override, else the master's (#2243). */
  barcode?: string | null;
  /** Whether a catalogue lookup actually ran for this batch (#2211/#2243). */
  catalogueConsulted?: boolean;
  /** Included siblings of this row's product that would create their own card (#2243). */
  siblingsWithoutCatalogueCard?: number;
  /** Included sibling count for the row's product; 1 ⇒ nothing to group (#2243). */
  includedSiblingCount?: number;
  /**
   * True when the submit category's schema could NOT be fetched (#2243). The
   * schema-derived checks are then blind, and saying so is the point: before
   * this a failed fetch silently cleared the required-parameter blocker.
   */
  categorySchemaUnavailable?: boolean;
}

/**
 * Whether the row would 422 on missing required product params (#810). The
 * host owns this computation (it has the category schema); the *blocker
 * emission + chip* is the platform's via `platformValidate` (#1096). Card-linked
 * rows are exempt (they inherit the params).
 */
export function computeNeedsProductParameters(input: ComputeBlockersInput): boolean {
  if (input.willLinkProductCard || !input.requiredProductParamIds?.length) return false;
  const supplied = suppliedProductParamIds(input.override);
  return input.requiredProductParamIds.some((id) => !supplied.has(id));
}

/**
 * Compute the co-occurring blocker set for a row. A row with an empty result
 * is ready. `no-variant` is exclusive (nothing else is meaningful without a
 * variant); all other blockers can co-occur.
 */
export function computeBlockers(input: ComputeBlockersInput): BulkRowBlocker[] {
  if (!input.hasVariant) return ['no-variant'];

  const blockers: BulkRowBlocker[] = [];

  // Category - an operator-picked category override clears the category blocker.
  // A `borrows`-taxonomy destination resolves the category server-side at submit
  // (override → barcode → mapping), so a pre-flight non-match never blocks it.
  const hasCategoryOverride = Boolean(
    input.override.overrides?.categoryId || input.productCategoryId,
  );
  if (!hasCategoryOverride && !input.destinationResolvesCategoryAtSubmit) {
    const cat = input.categoryResult;
    if (!cat || cat.kind === 'no-match') {
      blockers.push('no-match');
    } else if (cat.kind === 'no-ean') {
      blockers.push('no-ean');
    } else if (cat.kind === 'multi-match') {
      blockers.push('multi-match');
    } else if (cat.kind === 'matched') {
      // Resolved - no category blocker.
    } else {
      // An outcome this build does not know (#2240). The chain used to fall
      // through every arm and emit NO category blocker, so a discriminant added
      // backend-first - the planned `lookup-failed` is exactly that shape - would
      // turn a failed lookup into a ready row with no category. Failing closed
      // costs an operator one manual pick; failing open costs a dead batch.
      blockers.push('unknown-category-result');
    }
  }

  // Platform-specific blockers (#1096) - declared once per marketplace via its
  // `offerValidation` contribution and emitted as open-world namespaced ids
  // (e.g. `allegro:needs-product-parameters` (#810), `erli:missing-image`). The
  // host computes the neutral *inputs* (whether required product params are
  // unsupplied / card-linked / image count) and the plugin decides + names the
  // blocker - so a new marketplace adds NO host enum entry.
  if (input.platformValidate) {
    blockers.push(
      ...input.platformValidate({
        imageCount: input.imageCount ?? 0,
        needsProductParameters: computeNeedsProductParameters(input),
        willLinkProductCard: input.willLinkProductCard ?? false,
        title: input.effectiveTitle ?? '',
        categoryParameters: input.categoryParameters,
        suppliedParameters: input.suppliedParameters,
        barcode: input.barcode,
        catalogueConsulted: input.catalogueConsulted,
        siblingsWithoutCatalogueCard: input.siblingsWithoutCatalogueCard,
        includedSiblingCount: input.includedSiblingCount,
      }),
    );
  }

  // A schema we could not load is reported, never assumed away (#2243).
  if (input.categorySchemaUnavailable === true) {
    blockers.push('params-not-checked');
  }

  // Price / stock - override-aware via the resolvers above.
  const price = computeResolvedPrice(input.pricingPolicy, input.masterPrice, input.override);
  if (price.blocker) blockers.push(price.blocker);
  const stock = computeResolvedStock(input.stockPolicy, input.masterStock, input.override);
  if (stock.blocker) blockers.push(stock.blocker);

  // Currency mismatch only matters when the master price is actually consumed
  // (use-master / markup, no explicit price override). Under flat pricing or an
  // override the published price is already in the batch currency.
  const pricingUsesMaster =
    (input.pricingPolicy.mode === 'use-master' || input.pricingPolicy.mode === 'markup') &&
    input.override.price === undefined;
  if (
    pricingUsesMaster &&
    input.masterCurrency !== null &&
    input.masterCurrency !== input.batchCurrency
  ) {
    blockers.push('currency-mismatch');
  }

  return blockers;
}

/**
 * Extract the set of product-section parameter ids the operator has supplied
 * for a row, read from the neutral `overrides.parameters` (#1071) filtered to
 * `section === 'product'`. Used to coverage-check the required product params
 * so the `needs-product-parameters` blocker clears once they're filled (#810).
 */
function suppliedProductParamIds(override: BulkPerProductOverride): Set<string> {
  const params = override.overrides?.parameters;
  const ids = new Set<string>();
  if (!Array.isArray(params)) return ids;
  for (const p of params) {
    if (p.section === 'product' && typeof p.id === 'string' && p.id !== '') {
      ids.add(p.id);
    }
  }
  return ids;
}

/**
 * Reconstruct an `EanMatchResult` from a row's current category state so
 * `computeBlockers` can re-derive the category blocker after a per-row edit
 * without re-fetching. An operator-picked / previously-matched category id
 * yields `matched`; otherwise the surviving category blocker decides.
 *
 * Module-private - only `recomputeRowBlockers` consumes it.
 */
function categoryResultFor(
  row: BulkWizardRow,
  resolvedCategoryId: string | null,
): EanMatchResult {
  if (resolvedCategoryId) {
    return {
      kind: 'matched',
      allegroCategoryId: resolvedCategoryId,
      productCardId: row.resolvedProductCardId ?? '',
    };
  }
  if (row.blockers.includes('no-ean')) return { kind: 'no-ean' };
  if (row.blockers.includes('multi-match')) {
    return { kind: 'multi-match', candidates: [...row.categoryCandidates] };
  }
  return { kind: 'no-match' };
}

/**
 * #808 - choose the catalogue card id to thread into a bulk submit override.
 *
 * The EAN-matched card was resolved against the auto-detected category, so it
 * stays valid only while the category being submitted is still that resolved
 * category - whether the category arrives via the seeded/edited override or
 * the raw resolve. (The review-step edit form seeds `override.overrides` with
 * the resolved category + title + description even for un-touched rows, so a
 * plain "override has a categoryId" check is NOT a reliable "operator changed
 * the category" signal - it must be compared to the resolved category.)
 *
 * An explicit operator-set card always wins; switching to a *different*
 * category drops the card so the adapter re-resolves by barcode.
 *
 * Exported for unit testing; the wizard calls it from `handleSubmit`.
 */
export function selectBulkProductCardId(row: BulkWizardRow): string | undefined {
  const explicit = row.override.overrides?.productCardId;
  if (explicit) return explicit;
  const submittedCategoryId =
    row.override.overrides?.categoryId ?? row.resolvedCategoryId ?? null;
  if (row.resolvedProductCardId && submittedCategoryId === row.resolvedCategoryId) {
    return row.resolvedProductCardId;
  }
  return undefined;
}

/**
 * Recompute a row's full blocker set from its current state - the shared path
 * for the post-resolve sites (the Edit-save handler and the schema-reconcile
 * effect). Threads the #808 card-link signal and the #810 required-product-
 * param ids for the row's submit category into `computeBlockers`. Pure (no
 * closure) so the wizard's reconcile effect needs no `rows` dependency.
 */
export function recomputeRowBlockers(
  row: BulkWizardRow,
  config: BulkWizardConfig,
  requiredByCategory: Map<string, readonly string[]>,
  platformValidate?: (input: OfferRowValidationInput) => string[],
  destinationResolvesCategoryAtSubmit = false,
): BulkRowBlocker[] {
  if (!row.primaryVariant) return ['no-variant'];
  const submitCategoryId = row.override.overrides?.categoryId ?? row.resolvedCategoryId;
  return computeBlockers({
    hasVariant: true,
    categoryResult: categoryResultFor(row, submitCategoryId),
    pricingPolicy: effectivePricingPolicy(row.override, config.pricingPolicy),
    stockPolicy: effectiveStockPolicy(row.override, config.stockPolicy),
    masterPrice: row.masterPrice,
    masterStock: row.masterStock,
    masterCurrency: row.masterCurrency,
    batchCurrency: config.currency,
    override: row.override,
    willLinkProductCard: selectBulkProductCardId(row) !== undefined,
    requiredProductParamIds: submitCategoryId
      ? requiredByCategory.get(submitCategoryId)
      : undefined,
    imageCount: imageCountForRow(row),
    effectiveTitle: titleForRow(row),
    platformValidate,
    destinationResolvesCategoryAtSubmit,
  });
}

/**
 * Batch-wide facts a per-row check cannot derive on its own (#2243): the schemas
 * that loaded, the ones that failed, whether a catalogue lookup ran at all.
 * Passed as one object rather than five more positional arguments.
 */
export interface PreflightContext {
  schemaByCategory?: Map<string, readonly CategoryParameterLike[]>;
  failedCategoryIds?: readonly string[];
  catalogueConsulted?: boolean;
}

/**
 * How many INCLUDED siblings of a product would create their own catalogue card
 * (#2243). A multi-variant product only groups on Allegro when every sibling
 * resolves to its own card; when only some do, the marketplace binds the new
 * card to the first variant it accepts and rejects the rest.
 *
 * It is a PRODUCT-level fact derived from the whole variant list, which is why
 * it lives in one function rather than being re-reasoned per row. Note what that
 * does and does not say about cost: `recomputeVariantBlockers` calls this once
 * per variant, so a product's variant list is walked once per variant - O(n^2)
 * in siblings, which is nothing at the counts a bulk wizard actually carries
 * (tens). It stays inside the recompute deliberately: a hoisted value passed in
 * as an argument is one a caller can forget to refresh after an override edit,
 * and a stale card-coverage count would block or unblock the wrong siblings.
 * If variant counts ever make the walk matter, it belongs on a per-row memo at
 * both call sites, not on the batch-wide `PreflightContext` - coverage is scoped
 * to one product, not to the batch.
 */
export function siblingCardCoverage(row: BulkWizardRow): {
  included: number;
  withoutCard: number;
} {
  let included = 0;
  let withoutCard = 0;
  for (const variant of row.variants) {
    if (!variant.included) continue;
    included += 1;
    const hasCard =
      variant.resolvedProductCardId !== null ||
      Boolean(variant.override.overrides?.productCardId);
    if (!hasCard) withoutCard += 1;
  }
  return { included, withoutCard };
}

/** Resolved master image count for a row (#1096) - Erli image gate input. */
export function imageCountForRow(row: BulkWizardRow): number {
  return row.product?.images?.filter((u) => typeof u === 'string' && u.trim() !== '').length ?? 0;
}

/**
 * The title a row's submit would carry (#1962) - its own override when the
 * operator set one, else the master product name. Mirrors the core builder's
 * `input.overrides?.title ?? product.name`, so a platform title-length rule sees
 * the same string the wire will.
 */
export function titleForRow(row: BulkWizardRow): string {
  return row.override.overrides?.title ?? row.product?.name ?? '';
}

// ── Per-variant helpers (#1741) ──────────────────────────────────────────────

/**
 * Effective per-variant image count - the variant's `imageUrls` override when
 * present, else the master product's image set. Feeds the Erli image gate so an
 * operator who removed every image on a variant still trips `erli:missing-image`.
 */
export function imageCountForVariant(row: BulkWizardRow, variant: BulkVariantRow): number {
  const override = variant.override.overrides?.imageUrls;
  if (Array.isArray(override)) {
    return override.filter((u) => typeof u === 'string' && u.trim() !== '').length;
  }
  return imageCountForRow(row);
}

/**
 * Effective per-variant title (#1962) - the sibling's own title override when
 * present, else the shared-base override, else the master product name. Same
 * precedence the submit payload resolves, so a per-variant title an operator
 * shortened clears the blocker for that sibling alone.
 */
export function titleForVariant(row: BulkWizardRow, variant: BulkVariantRow): string {
  return variant.override.overrides?.title ?? titleForRow(row);
}

/**
 * Effective EAN for a sibling - the operator's per-variant override wins over the
 * master variant barcode (`ean ?? gtin`). Empty string / whitespace ⇒ null.
 */
export function effectiveVariantEan(variant: BulkVariantRow): string | null {
  const raw =
    variant.override.overrides?.ean ??
    variant.variant.ean ??
    variant.variant.gtin ??
    null;
  return raw && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * Human distinguishing label for a sibling from its attributes (e.g.
 * "Rozmiar: M"). Falls back to `Variant {index+1}` when a variant has no
 * usable distinguishing attribute (never the raw variant id - plan §8).
 */
export function distinguishingLabel(variant: BulkVariantRow, index: number): string {
  const attrs = variant.distinguishingAttributes;
  if (attrs) {
    const parts = Object.entries(attrs)
      .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
      .map(([k, v]) => `${k}: ${String(v)}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return `Variant ${index + 1}`;
}

/**
 * GS1 mod-10 check-digit validation for a GTIN-8/12/13/14 (#1741). Only true
 * GTIN lengths are accepted (8, 12, 13, 14) so the FE and the request DTO agree
 * on the EAN contract — a 9/10/11-digit value is not a GTIN and is rejected on
 * both sides rather than checksummed (#1741 review #4).
 */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits[digits.length - 1];
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += body[i] * (pos % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Normalise a GTIN to its 14-digit form, mirroring `enforceIdentifierRules`
 * server-side (#1934/F7).
 *
 * GS1 identity is length-independent: EAN-13 `5901234123457` and its
 * zero-padded GTIN-14 `05901234123457` are one identifier, and the backend
 * compares padded. Any duplicate detection that keys on the raw string sees two
 * different codes and stays quiet while the backend rejects the batch.
 */
export function toGtin14(code: string): string {
  return code.padStart(14, '0');
}

/**
 * The product-tier category a row would submit under (#2240): the operator's
 * shared-base override, else the product's own resolved category. Exactly the
 * chain `handleSubmit` uses for `familyCategoryId`, exported so the readiness
 * check and the required-parameter schema fetch cannot drift from the submit.
 */
export function productCategoryIdOf(row: BulkWizardRow): string | null {
  return row.override.overrides?.categoryId ?? row.resolvedCategoryId ?? null;
}

/**
 * Recompute one sibling's blocker set from its own EAN + master values + the
 * batch policies (#1741). Mirrors `recomputeRowBlockers` but keyed on the
 * per-variant row. `no-master-stock` is downgraded for multi-variant siblings -
 * master stock (incl. 0) is authoritative and read-only, so a 0 lists the
 * variant out-of-stock rather than blocking (plan §11).
 */
export function recomputeVariantBlockers(
  row: BulkWizardRow,
  variant: BulkVariantRow,
  config: BulkWizardConfig,
  requiredByCategory: Map<string, readonly string[]>,
  platformValidate?: (input: OfferRowValidationInput) => string[],
  destinationResolvesCategoryAtSubmit = false,
  isMultiVariant = false,
  context: PreflightContext = {},
): BulkRowBlocker[] {
  // The category this sibling would actually submit under (#2240). The order
  // mirrors `handleSubmit`: a per-variant override wins, then the product-tier
  // value the family pin uses (`row.override` → `row.resolvedCategoryId`), then
  // the sibling's own catalogue match. Reading only the variant tier - as this
  // did before #2240 - made the shared category unable to clear a sibling's
  // blocker even though the submit was about to pin it.
  const productCategoryId = productCategoryIdOf(row);
  const submitCategoryId =
    variant.override.overrides?.categoryId ?? productCategoryId ?? variant.resolvedCategoryId;
  const coverage = siblingCardCoverage(row);
  const blockers = computeBlockers({
    hasVariant: true,
    categoryResult: variantCategoryResult(variant, submitCategoryId),
    productCategoryId,
    // Per-product policy (on the shared-base override) wins over the batch (#1741).
    pricingPolicy: effectivePricingPolicy(row.override, config.pricingPolicy),
    stockPolicy: effectiveStockPolicy(row.override, config.stockPolicy),
    masterPrice: variant.masterPrice,
    masterStock: variant.masterStock,
    masterCurrency: variant.masterCurrency,
    batchCurrency: config.currency,
    override: variant.override,
    willLinkProductCard: variant.resolvedProductCardId !== null
      || Boolean(variant.override.overrides?.productCardId),
    requiredProductParamIds: submitCategoryId
      ? requiredByCategory.get(submitCategoryId)
      : undefined,
    imageCount: imageCountForVariant(row, variant),
    effectiveTitle: titleForVariant(row, variant),
    platformValidate,
    destinationResolvesCategoryAtSubmit,
    categoryParameters: submitCategoryId
      ? context.schemaByCategory?.get(submitCategoryId)
      : undefined,
    suppliedParameters: variant.override.overrides?.parameters,
    barcode: effectiveVariantEan(variant),
    catalogueConsulted: context.catalogueConsulted,
    siblingsWithoutCatalogueCard: coverage.withoutCard,
    includedSiblingCount: coverage.included,
    categorySchemaUnavailable:
      submitCategoryId !== null && (context.failedCategoryIds ?? []).includes(submitCategoryId),
  });

  // Master stock is authoritative + read-only for multi-variant siblings - a
  // 0/absent value lists out-of-stock, it does not block (plan §11).
  const filtered = isMultiVariant
    ? blockers.filter((b) => b !== 'no-master-stock')
    : blockers;

  // A supplied-but-invalid barcode is a hard blocker (GS1 gate, plan §10.1 / B5).
  // Its own id since #2240: "no barcode" and "the barcode you typed fails its
  // check digit" need different sentences and different fixes. Deliberately NOT
  // gated on the destination - an invalid barcode is invalid everywhere, even
  // where the category is resolved server-side.
  const ean = effectiveVariantEan(variant);
  if (ean !== null && !isValidGtin(ean) && !filtered.includes('invalid-barcode')) {
    // The collapse rule lives in `collapseToInvalidBarcode`, shared with the
    // Resolve step, so the two cannot drift.
    return collapseToInvalidBarcode(filtered);
  }
  // #1837: "already listed" is a SOFT warning surfaced as its own chip + a
  // publish-time confirm - never a readiness blocker (re-publishing is a valid
  // operator choice), so it is intentionally NOT pushed into `blockers`.
  return filtered;
}

/**
 * The wizard's own reading of a category outcome it cannot interpret (#2240).
 *
 * `EanMatchResult` is a closed union owned by the API contract, so there is no
 * member meaning "the destination answered something this build cannot read" -
 * and that state has to survive a reblock, or a row degrades from
 * `unknown result` to `no catalog match` and starts asserting something the
 * lookup never said.
 *
 * Declared as its own member of a wider union rather than cast into the closed
 * one: `unrecognised` is a fact about THIS build's understanding, not a shape the
 * destination sends, and the compiler can express that. A double cast through
 * `unknown` is the `any` escape with more syntax, and it would also make
 * `computeBlockers`' final arm reachable only around the type system rather than
 * through it.
 */
export interface UnrecognisedCategoryResult {
  kind: 'unrecognised';
}

/**
 * A category outcome as the wizard holds it: whatever the API declared, plus the
 * one state only the wizard can be in.
 */
export type CategoryOutcome = EanMatchResult | UnrecognisedCategoryResult;

const UNRECOGNISED_CATEGORY_RESULT: UnrecognisedCategoryResult = { kind: 'unrecognised' };

/** Reconstruct an `EanMatchResult` for a sibling from its resolved state. */
function variantCategoryResult(
  variant: BulkVariantRow,
  resolvedCategoryId: string | null,
): CategoryOutcome {
  if (resolvedCategoryId) {
    return {
      kind: 'matched',
      allegroCategoryId: resolvedCategoryId,
      productCardId: variant.resolvedProductCardId ?? '',
    };
  }
  // Rescue barcode (#1741): the operator supplied a valid GTIN for a variant
  // that had none at resolve time (the `no-ean` case). The barcode optimistically
  // self-links at submit (Allegro resolves the catalog product + category from
  // the GTIN, #824), so the pre-flight `no-ean` blocker clears here rather than
  // stranding an otherwise-ready offer. Master-barcoded variants are untouched.
  const suppliedEan = variant.override.overrides?.ean?.trim();
  const masterEan = (variant.variant.ean ?? variant.variant.gtin ?? '').trim();
  if (masterEan === '' && suppliedEan !== undefined && suppliedEan !== '' && isValidGtin(suppliedEan)) {
    return { kind: 'matched', allegroCategoryId: '', productCardId: variant.resolvedProductCardId ?? '' };
  }
  if (variant.blockers.includes('unknown-category-result')) {
    // Preserve "the answer was not understood" across a reblock (#2240).
    // Falling through to `no-match` would state that the catalogue HAS no match
    // for this barcode, which is precisely what the lookup did not say - and the
    // row would then read `no catalog match` from its second recompute onwards.
    return UNRECOGNISED_CATEGORY_RESULT;
  }
  if (variant.blockers.includes('no-ean') || variant.blockers.includes('invalid-barcode')) {
    // Either way there is no usable barcode to have matched on (#2240). The
    // barcode blocker itself is re-derived above from the effective value, so
    // reporting `no-ean` here only picks the category cause, and the two are
    // collapsed to one chip by the caller.
    return { kind: 'no-ean' };
  }
  if (variant.blockers.includes('multi-match')) {
    return { kind: 'multi-match', candidates: [...variant.categoryCandidates] };
  }
  return { kind: 'no-match' };
}

/**
 * Batch-wide + intra-product effective-identifier duplicate detection (#1741).
 * Returns the set of `variantId`s whose effective EAN collides with another
 * included variant anywhere in the batch (they would collapse to one Allegro
 * catalog card and lose grouping). FE-only warn; the BE enforces.
 */
export function duplicateEanVariantIds(rows: BulkWizardRow[]): Set<string> {
  const byEan = new Map<string, string[]>();
  for (const row of rows) {
    for (const variant of row.variants) {
      if (!variant.included) continue;
      const ean = effectiveVariantEan(variant);
      if (!ean || !isValidGtin(ean)) continue;
      // Key on the GTIN-14 form, matching `enforceIdentifierRules` server-side
      // (#1934/F7). `5901234123457` and `05901234123457` are the SAME GS1
      // identity; keying on the raw string treats them as distinct, so the
      // wizard stays silent and the backend 400s the whole batch instead.
      const key = toGtin14(ean);
      const list = byEan.get(key) ?? [];
      list.push(variant.variantId);
      byEan.set(key, list);
    }
  }
  const dupes = new Set<string>();
  for (const ids of byEan.values()) {
    if (ids.length > 1) ids.forEach((id) => dupes.add(id));
  }
  return dupes;
}
