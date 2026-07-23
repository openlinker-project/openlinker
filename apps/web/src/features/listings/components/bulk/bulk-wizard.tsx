/**
 * Bulk listing wizard (#740 / #792 / #1741 per-variant)
 *
 * Multi-step controller: Config -> Resolve -> Review (with two-pane Edit modal)
 * -> Confirm -> submit. Owns the rows[] state + batch config + per-variant
 * overrides. Each selected product fans out client-side into one
 * `BulkVariantRow` per real variant (#1741); the Resolve step resolves each
 * sibling's category/card/master values and computes a per-variant blocker set,
 * and the Review step gates submit on the included, ready siblings. On submit
 * the wizard emits `perVariantOverrides` (keyed by variant id) + the
 * `excludedVariantIds` the operator switched off; the BE stays the single
 * fan-out source.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, PageLayout, SetupStepper } from '../../../../shared/ui';
import { useToast } from '../../../../shared/ui/toast-provider';
import { usePlatforms, type OfferRowValidationInput } from '../../../../shared/plugins';
import { useWriteAccess } from '../../../../shared/auth/use-permission';
import { useDemoMode } from '../../../system';
import { useConnectionsQuery } from '../../../connections';
import { useBulkSubmitMutation } from '../../hooks/use-bulk-submit-mutation';
import { useBulkRequiredProductParams } from '../../hooks/use-bulk-required-product-params';
import type {
  BulkOfferCreateRequest,
  BulkPerProductOverride,
} from '../../api/bulk-listings.types';
import type { Product, ProductVariant } from '../../../products';
import { BulkConfigStep } from './bulk-config-step';
import { BulkResolveStep, type BulkResolveOutcome } from './bulk-resolve-step';
import { BulkReviewStep } from './bulk-review-step';
import { BulkConfirmModal } from './bulk-confirm-modal';
import {
  computeResolvedPrice,
  computeResolvedStock,
  effectivePricingPolicy,
  effectiveStockPolicy,
  effectiveVariantEan,
  recomputeVariantBlockers,
} from './bulk-policy';
import type {
  BulkRowBlocker,
  BulkVariantRow,
  BulkWizardConfig,
  BulkWizardRow,
  BulkWizardStep,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

interface BulkWizardProps {
  /** Selected products from the Products page (already hydrated with variants). */
  products: Product[];
  /** Connection name displayed in the confirm modal once config is known. */
  resolveConnectionName: (connectionId: string) => string;
  /** Connection preselected from the entry-point picker / URL (#1096). */
  preselectedConnectionId?: string;
}

const WIZARD_STEPS: { id: BulkWizardStep; label: string }[] = [
  { id: 'config', label: 'Config' },
  { id: 'resolve', label: 'Resolving' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
];

/** Stable empty list so a param-schema opt-out platform keeps a constant deps identity. */
const EMPTY_CATEGORY_IDS: readonly string[] = [];

export function BulkWizard({
  products,
  resolveConnectionName,
  preselectedConnectionId,
}: BulkWizardProps): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mutation = useBulkSubmitMutation();
  const platforms = usePlatforms();
  const connectionsQuery = useConnectionsQuery();

  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const demoMode = useDemoMode();
  const write = useWriteAccess('listings:write', demoMode);
  const canGenerateDescription = write.canWrite;
  const [step, setStep] = useState<BulkWizardStep>('config');
  const [config, setConfig] = useState<BulkWizardConfig | null>(null);
  const [rows, setRows] = useState<BulkWizardRow[]>(() => seedRows(products));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Sync row state when the products list changes (dedup by product id so a
  // product surfaced twice yields one row / one fan-out, mirroring the BE seen
  // dedup, plan §8). Compare against the id signature so a passive cache refresh
  // doesn't clobber row state.
  const dedupedProducts = useMemo(() => dedupById(products), [products]);
  const productsSignature = dedupedProducts.map((p) => p.id).join(',');
  useEffect(() => {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.productId, r]));
      return dedupedProducts.map((p) => byId.get(p.id) ?? seedRow(p));
    });
  }, [productsSignature, dedupedProducts]);

  // Distinct categories of INCLUDED variants that submit WITHOUT a card link
  // (#810 / #1741). Only these can hit the missing-product-parameters 422.
  const noCardCategoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      for (const variant of row.variants) {
        if (!variant.included) continue;
        const hasCard =
          variant.resolvedProductCardId !== null ||
          Boolean(variant.override.overrides?.productCardId);
        if (hasCard) continue;
        const categoryId = variant.override.overrides?.categoryId ?? variant.resolvedCategoryId;
        if (categoryId) set.add(categoryId);
      }
    }
    return Array.from(set);
  }, [rows]);

  const batchConnection = useMemo(
    () => (connectionsQuery.data ?? []).find((c) => c.id === config?.connectionId) ?? null,
    [connectionsQuery.data, config?.connectionId],
  );
  const batchPlatform = useMemo(
    () => platforms.find((p) => p.platformType === batchConnection?.platformType) ?? null,
    [platforms, batchConnection],
  );

  const categoryIdsForParamSchema = batchPlatform?.offerValidation?.needsCategoryParameterSchema
    ? noCardCategoryIds
    : EMPTY_CATEGORY_IDS;
  const { requiredByCategory, isResolving: paramsResolving } = useBulkRequiredProductParams(
    config?.connectionId,
    categoryIdsForParamSchema,
  );

  const platformValidate = useMemo<
    ((input: OfferRowValidationInput) => string[]) | undefined
  >(() => batchPlatform?.offerValidation?.validateRow, [batchPlatform]);
  const platformBlockerChips = batchPlatform?.offerValidation?.blockers ?? [];

  const destinationResolvesCategoryAtSubmit = batchConnection
    ? !batchConnection.supportedCapabilities.includes('EanCategoryMatcher')
    : false;
  const destinationBrowsesCategories =
    (batchConnection?.supportedCapabilities.includes('CategoryBrowser') ?? false) ||
    (batchConnection
      ? (batchPlatform?.bulkCategoryBrowsingEnabled?.(batchConnection) ?? false)
      : false);

  // Reconcile per-variant `needs-product-parameters` (and any policy-derived)
  // blockers whenever a category's schema resolves. Gated to Review so only
  // rows with resolved master data recompute.
  useEffect(() => {
    if (!config || step !== 'review') return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.variants.length === 0) return row;
        const isMulti = row.variants.length > 1;
        let rowChanged = false;
        const variants = row.variants.map((variant) => {
          const blockers = recomputeVariantBlockers(
            row,
            variant,
            config,
            requiredByCategory,
            platformValidate,
            destinationResolvesCategoryAtSubmit,
            isMulti,
          );
          if (sameBlockers(blockers, variant.blockers)) return variant;
          rowChanged = true;
          return { ...variant, blockers };
        });
        if (!rowChanged) return row;
        changed = true;
        return { ...row, variants };
      });
      return changed ? next : prev;
    });
  }, [config, step, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit]);

  const handleConfigProceed = useCallback((next: BulkWizardConfig) => {
    setConfig(next);
    setStep('resolve');
  }, []);

  const handleResolveComplete = useCallback((outcomes: BulkResolveOutcome[]) => {
    setRows((prev) => mergeResolveOutcomes(prev, outcomes));
    setStep('review');
  }, []);

  // Toggle one variant's inclusion (single source of truth). Blockers recompute
  // so an excluded blocked variant doesn't keep gating and an included one does.
  const setVariantIncluded = useCallback(
    (productId: string, variantId: string, included: boolean) => {
      if (!config) return;
      setRows((prev) => reblockRows(prev, config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit, (row) =>
        row.productId !== productId
          ? row
          : {
              ...row,
              variants: row.variants.map((v) =>
                v.variantId === variantId ? { ...v, included } : v,
              ),
            },
      ));
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  // Tri-state parent: clicking includes/excludes ALL variants of the product.
  const setProductIncluded = useCallback(
    (productId: string, included: boolean) => {
      if (!config) return;
      setRows((prev) => reblockRows(prev, config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit, (row) =>
        row.productId !== productId
          ? row
          : { ...row, variants: row.variants.map((v) => ({ ...v, included })) },
      ));
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  // Commit the whole-product editor session: base override + per-variant
  // overrides + inclusion, then recompute every sibling's blockers.
  const handleSaveEditor = useCallback(
    (
      productId: string,
      baseOverride: BulkPerProductOverride,
      perVariantOverrides: Record<string, BulkPerProductOverride>,
      includedByVariantId: Record<string, boolean>,
      editFormValues: Record<string, unknown>,
    ) => {
      if (!config) return;
      setRows((prev) => reblockRows(prev, config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit, (row) => {
        if (row.productId !== productId) return row;
        // A simple product has no per-variant scope: its offer-level fields
        // (barcode, price, ...) live on the base override. Fold that base into
        // the lone variant's override so `effectiveVariantEan` sees the entered
        // EAN and the `no-ean` blocker clears on Save (#1741).
        const isSimpleProduct = row.variants.length === 1;
        return {
          ...row,
          override: baseOverride,
          editFormValues,
          variants: row.variants.map((v) => {
            const nextOverride =
              perVariantOverrides[v.variantId] ?? (isSimpleProduct ? baseOverride : v.override);
            return {
              ...v,
              override: nextOverride,
              included: includedByVariantId[v.variantId] ?? v.included,
              ean: effectiveVariantEan({ ...v, override: nextOverride }),
            };
          }),
        };
      }));
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  const handleSubmit = useCallback(
    async (publishImmediately: boolean) => {
      if (!config) return;

      // Fresh idempotency key per confirm-click (#1741 review). A retry after a
      // partial/failed submit must be a distinct request, otherwise the batch
      // dedup gate would return the earlier partial batch instead of re-running.
      // The confirm button is disabled while a submit is in flight, so this can
      // never split a single deliberate click into two batches.
      idempotencyKeyRef.current = crypto.randomUUID();

      // productIds = one primary/seed variant id per product that has >=1
      // included, ready sibling. The BE fans each out; per-variant data + the
      // exclusions drive the exact set (#1741).
      const productIds: string[] = [];
      const perProductOverrides: Record<string, BulkPerProductOverride> = {};
      const perVariantOverrides: Record<string, BulkPerProductOverride> = {};
      const excludedVariantIds: string[] = [];

      for (const row of rows) {
        if (row.variants.length === 0) continue;
        const includedReady = row.variants.filter(
          (v) => v.included && v.blockers.length === 0,
        );
        // The product's shared-base policy (if diverged) wins over the batch.
        const rowPricingPolicy = effectivePricingPolicy(row.override, config.pricingPolicy);
        const rowStockPolicy = effectiveStockPolicy(row.override, config.stockPolicy);
        for (const v of row.variants) {
          if (!v.included) {
            excludedVariantIds.push(v.variantId);
            continue;
          }
          if (v.blockers.length > 0) continue;
          perVariantOverrides[v.variantId] = buildVariantOverride(v, config, rowPricingPolicy, rowStockPolicy);
        }
        if (includedReady.length === 0) continue;
        const primaryId = (row.primaryVariant ?? row.variants[0].variant).id;
        productIds.push(primaryId);

        // #1741 review #1: for a multi-variant product, pin the shared category
        // at the family tier so every sibling groups under the SAME category.
        // Allegro only groups same-category siblings; without this pin each
        // sibling would resolve its category independently by its own barcode
        // and two divergent resolutions would split the very listing this flow
        // unifies. Operator-pinned base category wins, else the resolved primary
        // category. Single-variant products list standalone, so no pin.
        const isMulti = row.variants.length > 1;
        const familyCategoryId =
          row.override.overrides?.categoryId ?? row.resolvedCategoryId ?? undefined;
        const familyOverride: BulkPerProductOverride =
          isMulti && familyCategoryId
            ? {
                ...row.override,
                overrides: { ...(row.override.overrides ?? {}), categoryId: familyCategoryId },
              }
            : row.override;
        if (
          familyOverride.overrides ||
          familyOverride.price ||
          familyOverride.publishImmediately !== undefined
        ) {
          perProductOverrides[primaryId] = familyOverride;
        }
      }

      if (productIds.length === 0) {
        showToast({
          tone: 'error',
          description: 'No variants are ready to submit. Resolve the flagged variants first.',
        });
        return;
      }

      const request: BulkOfferCreateRequest = {
        connectionId: config.connectionId,
        productIds,
        sharedConfig: {
          // Nominal batch-wide floor only. Every emitted offer carries its own
          // resolved stock: multi-variant siblings use master inventory (BE,
          // #823/#824) and single-variant offers carry a per-variant `stock`
          // override, so this value is never the effective stock today. Kept as
          // a safe non-zero default so a future passthrough path can't publish 0
          // (#1741 review suggestion).
          stock: 1,
          publishImmediately,
          generateDescription: canGenerateDescription ? config.generateDescription : false,
          overrides: {
            platformParams: config.platformParams,
          },
        },
        perProductOverrides,
        perVariantOverrides,
        excludedVariantIds,
      };

      try {
        const result = await mutation.mutateAsync({
          idempotencyKey: idempotencyKeyRef.current,
          request,
        });
        const offerCount = Object.keys(perVariantOverrides).length;
        showToast({
          tone: 'success',
          title: 'Batch submitted',
          description: `${offerCount.toLocaleString()} offers queued for creation.`,
        });
        void navigate(`/listings/bulk-batches/${result.batchId}`);
      } catch {
        // Surfaced via mutation.error in the modal.
      }
    },
    [config, rows, mutation, navigate, showToast, canGenerateDescription],
  );

  const counts = useMemo(() => countBatch(rows), [rows]);
  const marketplaceName = batchPlatform?.displayName ?? 'marketplace';

  return (
    <PageLayout
      eyebrow="Operations · Listings"
      title="Bulk marketplace offer creation"
      description={`Creating offers for ${rows.length} ${rows.length === 1 ? 'product' : 'products'} · ${counts.totalVariants} variants.`}
    >
      <div className="bulk-wizard">
        <div className="bulk-wizard__stepper">
          <SetupStepper
            steps={WIZARD_STEPS.map((s) => s.label)}
            currentStep={stepOrder(step)}
            completedSteps={new Set(Array.from({ length: stepOrder(step) }, (_, i) => i))}
          />
        </div>

        {counts.noVariants > 0 ? (
          <Alert tone="warning">
            {counts.noVariants} of {rows.length} products have no variants and cannot be listed.
            They'll be skipped on submit.
          </Alert>
        ) : null}

        <div className={step === 'resolve' ? '' : 'bulk-wizard__body'}>
          {step === 'config' && (
            <BulkConfigStep
              initial={config ?? {}}
              preselectedConnectionId={preselectedConnectionId}
              onProceed={handleConfigProceed}
              onCancel={() => { void navigate(-1); }}
            />
          )}
          {step === 'resolve' && config && (
            <BulkResolveStep
              rows={rows}
              connectionId={config.connectionId}
              pricingPolicy={config.pricingPolicy}
              stockPolicy={config.stockPolicy}
              currency={config.currency}
              platformValidate={platformValidate}
              destinationResolvesCategoryAtSubmit={destinationResolvesCategoryAtSubmit}
              onComplete={handleResolveComplete}
            />
          )}
          {step === 'review' && config && (
            <BulkReviewStep
              rows={rows}
              connection={batchConnection}
              config={config}
              paramsResolving={paramsResolving}
              platformBlockerChips={platformBlockerChips}
              canBrowseCategories={destinationBrowsesCategories}
              batchDeliveryPriceList={
                typeof config.platformParams.deliveryPriceList === 'string'
                  ? config.platformParams.deliveryPriceList
                  : ''
              }
              demoReadOnly={write.demoReadOnly}
              onSetVariantIncluded={setVariantIncluded}
              onSetProductIncluded={setProductIncluded}
              onSaveEditor={handleSaveEditor}
              onApproveAll={() => { setConfirmOpen(true); }}
              onBack={() => { setStep('config'); }}
            />
          )}
        </div>

        {config ? (
          <BulkConfirmModal
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            offerCount={counts.includedReady}
            productCount={counts.productsWithIncluded}
            excludedCount={counts.excluded}
            mixedPublishWarning={counts.mixedPublish}
            connectionName={resolveConnectionName(config.connectionId)}
            marketplaceName={marketplaceName}
            initialPublishImmediately={config.publishImmediately}
            isSubmitting={mutation.isPending}
            demoReadOnly={write.demoReadOnly}
            errorMessage={mutation.error ? mutation.error.message : null}
            onConfirm={(publishImmediately) => {
              void handleSubmit(publishImmediately);
            }}
          />
        ) : null}
      </div>
    </PageLayout>
  );
}

function stepOrder(step: BulkWizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.id === step);
}

/** Order-sensitive blocker-list equality. */
function sameBlockers(a: readonly BulkRowBlocker[], b: readonly BulkRowBlocker[]): boolean {
  return a.length === b.length && a.every((blocker, i) => blocker === b[i]);
}

function dedupById(products: Product[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Apply a row transform then recompute every touched product's per-variant
 * blockers so inclusion/override edits keep the readiness gate honest.
 */
function reblockRows(
  rows: BulkWizardRow[],
  config: BulkWizardConfig,
  requiredByCategory: Map<string, readonly string[]>,
  platformValidate: ((input: OfferRowValidationInput) => string[]) | undefined,
  destinationResolvesCategoryAtSubmit: boolean,
  transform: (row: BulkWizardRow) => BulkWizardRow,
): BulkWizardRow[] {
  return rows.map((row) => {
    const next = transform(row);
    if (next === row) return row;
    const isMulti = next.variants.length > 1;
    return {
      ...next,
      variants: next.variants.map((variant) => ({
        ...variant,
        blockers: recomputeVariantBlockers(
          next,
          variant,
          config,
          requiredByCategory,
          platformValidate,
          destinationResolvesCategoryAtSubmit,
          isMulti,
        ),
      })),
    };
  });
}

/**
 * Assemble a variant's wire override from its edit override + policy-resolved
 * price/stock. `pricingPolicy` / `stockPolicy` are the ROW-effective policies
 * (the product's shared-base override wins over the batch default, #1741).
 */
function buildVariantOverride(
  variant: BulkVariantRow,
  config: BulkWizardConfig,
  pricingPolicy: PricingPolicy,
  stockPolicy: StockPolicy,
): BulkPerProductOverride {
  const price = computeResolvedPrice(pricingPolicy, variant.masterPrice, variant.override);
  const stock = computeResolvedStock(stockPolicy, variant.masterStock, variant.override);
  return {
    ...variant.override,
    stock: stock.value ?? undefined,
    price:
      variant.override.price ??
      (price.value !== null ? { amount: price.value, currency: config.currency } : undefined),
    overrides: {
      ...(variant.override.overrides ?? {}),
      // categoryId is grouping-determining + product-level; the BE strips it
      // from the per-variant map. Keep the resolved card so a self-linking
      // sibling still points at its own catalog product (#824).
      productCardId:
        variant.override.overrides?.productCardId ?? variant.resolvedProductCardId ?? undefined,
      ...(effectiveVariantEan(variant) ? { ean: effectiveVariantEan(variant)! } : {}),
    },
  };
}

interface BatchCounts {
  totalVariants: number;
  includedReady: number;
  includedNeedsAttention: number;
  excluded: number;
  noVariants: number;
  productsWithIncluded: number;
  mixedPublish: boolean;
}

function countBatch(rows: BulkWizardRow[]): BatchCounts {
  let totalVariants = 0;
  let includedReady = 0;
  let includedNeedsAttention = 0;
  let excluded = 0;
  let noVariants = 0;
  let productsWithIncluded = 0;
  let mixedPublish = false;

  for (const row of rows) {
    if (row.variants.length === 0) {
      noVariants += 1;
      continue;
    }
    let hasIncluded = false;
    let sawPublish = false;
    let sawDraft = false;
    for (const v of row.variants) {
      totalVariants += 1;
      if (!v.included) {
        excluded += 1;
        continue;
      }
      hasIncluded = true;
      if (v.blockers.length === 0) includedReady += 1;
      else includedNeedsAttention += 1;
      const publish = v.override.publishImmediately;
      if (publish === false) sawDraft = true;
      else sawPublish = true;
    }
    if (hasIncluded) productsWithIncluded += 1;
    if (sawPublish && sawDraft) mixedPublish = true;
  }

  return {
    totalVariants,
    includedReady,
    includedNeedsAttention,
    excluded,
    noVariants,
    productsWithIncluded,
    mixedPublish,
  };
}

/**
 * Merge resolve-step outcomes into the wizard's rows by product id, then by
 * variant id, preserving each variant's operator `override` + `editFormValues`
 * (re-resolve must not discard edits, plan §8).
 */
export function mergeResolveOutcomes(
  rows: BulkWizardRow[],
  outcomes: BulkResolveOutcome[],
): BulkWizardRow[] {
  const byId = new Map(outcomes.map((o) => [o.productId, o]));
  return rows.map((row) => {
    const o = byId.get(row.productId);
    if (!o) return row;
    const outcomeByVariant = new Map(o.variants.map((v) => [v.variantId, v]));
    const primaryOutcome = row.primaryVariant
      ? outcomeByVariant.get(row.primaryVariant.id)
      : undefined;
    return {
      ...row,
      blockers: primaryOutcome?.blockers ?? row.blockers,
      resolvedCategoryId: primaryOutcome?.resolvedCategoryId ?? row.resolvedCategoryId,
      masterPrice: primaryOutcome?.masterPrice ?? row.masterPrice,
      masterStock: primaryOutcome?.masterStock ?? row.masterStock,
      masterCurrency: primaryOutcome?.masterCurrency ?? row.masterCurrency,
      variants: row.variants.map((variant) => {
        const vo = outcomeByVariant.get(variant.variantId);
        if (!vo) return variant;
        return {
          ...variant,
          blockers: vo.blockers,
          resolvedCategoryId: vo.resolvedCategoryId,
          resolvedProductCardId: vo.resolvedProductCardId,
          resolutionMethod: vo.resolutionMethod,
          masterStock: vo.masterStock,
          masterPrice: vo.masterPrice,
          masterCurrency: vo.masterCurrency,
          categoryCandidates: vo.categoryCandidates,
          ean: vo.ean,
        };
      }),
    };
  });
}

function seedRows(products: Product[]): BulkWizardRow[] {
  return dedupById(products).map(seedRow);
}

function seedVariantRow(variant: ProductVariant, product: Product): BulkVariantRow {
  const barcode = variant.ean ?? variant.gtin ?? null;
  return {
    variantId: variant.id,
    variant,
    ean: barcode && barcode.trim() !== '' ? barcode.trim() : null,
    distinguishingAttributes: variant.attributes,
    masterStock: null,
    masterPrice: variant.price,
    masterCurrency: product.currency ?? null,
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
  };
}

function seedRow(product: Product): BulkWizardRow {
  const variants = product.variants ?? [];
  const primaryVariant: ProductVariant | null = variants[0] ?? null;
  return {
    productId: product.id,
    product,
    primaryVariant,
    variants: variants.map((v) => seedVariantRow(v, product)),
    blockers: primaryVariant ? [] : ['no-variant'],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}
