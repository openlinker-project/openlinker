/**
 * Bulk wizard pricing/stock policy + blocker computation (#792 PR 3)
 *
 * Pure, side-effect-free helpers shared by the Resolve step (blocker compute)
 * and the Review step (computed value + provenance rendering). Kept isolated
 * from React so the policy maths are unit-testable without rendering.
 *
 * Resolution precedence: master → policy → per-row override (override wins).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { EanMatchResult } from '../../api/listings.types';
import type {
  BulkRowBlocker,
  BulkValueSource,
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
    return { value: override.price.amount, source: 'override', blocker: null };
  }
  switch (policy.mode) {
    case 'flat':
      // Operator's explicit batch-wide amount — used verbatim, never blocks.
      return { value: policy.amount, source: 'policy', blocker: null };
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

export interface ComputeBlockersInput {
  hasVariant: boolean;
  /**
   * Per-variant category outcome. The Resolve step synthesizes `{ kind: 'no-ean' }`
   * for variant rows without a barcode (no BE call); `undefined` is treated
   * defensively as `no-match`.
   */
  categoryResult: EanMatchResult | undefined;
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
   * time, where no-card rows have no category yet — treated as not-blocking.
   */
  willLinkProductCard?: boolean;
  /**
   * Required `section: 'product'` parameter ids for the row's submit category
   * (unconditional only — `dependsOn`-gated params are excluded). undefined =
   * schema not loaded yet → do not block (avoids flicker). (#810)
   */
  requiredProductParamIds?: readonly string[];
}

/**
 * Compute the co-occurring blocker set for a row. A row with an empty result
 * is ready. `no-variant` is exclusive (nothing else is meaningful without a
 * variant); all other blockers can co-occur.
 */
export function computeBlockers(input: ComputeBlockersInput): BulkRowBlocker[] {
  if (!input.hasVariant) return ['no-variant'];

  const blockers: BulkRowBlocker[] = [];

  // Category — an operator-picked category override clears the category blocker.
  const hasCategoryOverride = Boolean(input.override.overrides?.categoryId);
  if (!hasCategoryOverride) {
    const cat = input.categoryResult;
    if (!cat || cat.kind === 'no-match') {
      blockers.push('no-match');
    } else if (cat.kind === 'no-ean') {
      blockers.push('no-ean');
    } else if (cat.kind === 'multi-match') {
      blockers.push('multi-match');
    }
    // 'matched' → no category blocker
  }

  // Product parameters (#810) — a row that creates a product inline (no card to
  // inherit from) under a category with required product-section params it
  // hasn't supplied would 422 at submit. Card-linked rows (#808) inherit the
  // params, so they're exempt. Coverage-based so the blocker clears once the
  // operator fills the params in the edit modal.
  if (!input.willLinkProductCard && input.requiredProductParamIds?.length) {
    const supplied = suppliedProductParamIds(input.override);
    if (input.requiredProductParamIds.some((id) => !supplied.has(id))) {
      blockers.push('needs-product-parameters');
    }
  }

  // Price / stock — override-aware via the resolvers above.
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
 * for a row, read from the serialized `platformParams.productParameters` wire
 * array (`{ id, … }[]`, see `serializeAllegroParameters`). Used to coverage-
 * check the required product params so the `needs-product-parameters` blocker
 * clears once they're filled (#810).
 */
function suppliedProductParamIds(override: BulkPerProductOverride): Set<string> {
  const params: unknown = override.overrides?.platformParams?.productParameters;
  const ids = new Set<string>();
  if (!Array.isArray(params)) return ids;
  for (const p of params) {
    if (p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string') {
      ids.add((p as { id: string }).id);
    }
  }
  return ids;
}

/**
 * Reconstruct an `EanMatchResult` from a row's current category state so
 * `computeBlockers` can re-derive the category blocker after a per-row edit
 * without re-fetching. An operator-picked / previously-matched category id
 * yields `matched`; otherwise the surviving category blocker decides.
 */
export function categoryResultFor(
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
 * #808 — choose the catalogue card id to thread into a bulk submit override.
 *
 * The EAN-matched card was resolved against the auto-detected category, so it
 * stays valid only while the category being submitted is still that resolved
 * category — whether the category arrives via the seeded/edited override or
 * the raw resolve. (The review-step edit form seeds `override.overrides` with
 * the resolved category + title + description even for un-touched rows, so a
 * plain "override has a categoryId" check is NOT a reliable "operator changed
 * the category" signal — it must be compared to the resolved category.)
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
 * Recompute a row's full blocker set from its current state — the shared path
 * for the post-resolve sites (the Edit-save handler and the schema-reconcile
 * effect). Threads the #808 card-link signal and the #810 required-product-
 * param ids for the row's submit category into `computeBlockers`. Pure (no
 * closure) so the wizard's reconcile effect needs no `rows` dependency.
 */
export function recomputeRowBlockers(
  row: BulkWizardRow,
  config: BulkWizardConfig,
  requiredByCategory: Map<string, readonly string[]>,
): BulkRowBlocker[] {
  if (!row.primaryVariant) return ['no-variant'];
  const submitCategoryId = row.override.overrides?.categoryId ?? row.resolvedCategoryId;
  return computeBlockers({
    hasVariant: true,
    categoryResult: categoryResultFor(row, submitCategoryId),
    pricingPolicy: config.pricingPolicy,
    stockPolicy: config.stockPolicy,
    masterPrice: row.masterPrice,
    masterStock: row.masterStock,
    masterCurrency: row.masterCurrency,
    batchCurrency: config.currency,
    override: row.override,
    willLinkProductCard: selectBulkProductCardId(row) !== undefined,
    requiredProductParamIds: submitCategoryId
      ? requiredByCategory.get(submitCategoryId)
      : undefined,
  });
}
