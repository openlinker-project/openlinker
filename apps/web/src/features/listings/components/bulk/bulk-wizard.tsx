/**
 * Bulk listing wizard (#740 / #792 PR 3)
 *
 * Multi-step controller: Config → Resolve → Review (with Edit modal) →
 * Confirm → submit. Owns the rows[] state + batch config + per-row overrides.
 * The Resolve step pulls each product's master price/stock and computes the
 * per-row blocker set from the batch-wide pricing/stock policies (#792); the
 * Review step renders the computed values and gates submit on `blockers`.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, PageLayout, SetupStepper } from '../../../../shared/ui';
import { useToast } from '../../../../shared/ui/toast-provider';
import { usePlatforms, type OfferRowValidationInput } from '../../../../shared/plugins';
import { usePermission } from '../../../../shared/auth/use-permission';
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
  recomputeRowBlockers,
  selectBulkProductCardId,
} from './bulk-policy';
import type {
  BulkRowBlocker,
  BulkWizardConfig,
  BulkWizardRow,
  BulkWizardStep,
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

  // Mint a stable idempotency key once per wizard mount. Retries from the
  // confirm step submit reuse it; remount mints a fresh one.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const canGenerateDescription = usePermission('listings:write');
  const [step, setStep] = useState<BulkWizardStep>('config');
  const [config, setConfig] = useState<BulkWizardConfig | null>(null);
  const [rows, setRows] = useState<BulkWizardRow[]>(() => seedRows(products));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Sync row state when products list changes (rare — would only happen if the
  // page upstream refetches). Compare against the product-id signature, not
  // object identity, so a passive cache refresh producing structurally-equal
  // products doesn't clobber row state.
  const productsSignature = products.map((p) => p.id).join(',');
  useEffect(() => {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.productId, r]));
      return products.map((p) => byId.get(p.id) ?? seedRow(p));
    });
  }, [productsSignature, products]);

  // Distinct categories of rows that will submit WITHOUT a card link (#810).
  // Only these can hit the missing-product-parameters 422 — card-linked rows
  // inherit the params. Feeds the schema fan-out below.
  const noCardCategoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (!row.primaryVariant) continue;
      if (selectBulkProductCardId(row) !== undefined) continue;
      const categoryId = row.override.overrides?.categoryId ?? row.resolvedCategoryId;
      if (categoryId) set.add(categoryId);
    }
    return Array.from(set);
  }, [rows]);

  // Resolve the batch connection's platform (single connection per batch) so we
  // can render platform-declared blocker chips and run its row validator (#1096).
  const batchConnection = useMemo(
    () => (connectionsQuery.data ?? []).find((c) => c.id === config?.connectionId) ?? null,
    [connectionsQuery.data, config?.connectionId],
  );
  const batchPlatform = useMemo(
    () => platforms.find((p) => p.platformType === batchConnection?.platformType) ?? null,
    [platforms, batchConnection],
  );

  // Only fetch the per-category required-product-param schema (an Allegro #810
  // concern) when the resolved platform's validator actually reads it (#1096).
  // Erli's validator ignores `needsProductParameters`, so it opts out and the
  // host issues zero category-param queries for an Erli batch. The gate is a
  // declared flag, not a `platformType` check — the host stays neutral.
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

  // Category-resolution provenance from declared capabilities (never platformType):
  // a destination that can't pre-flight EAN-match `borrows` its taxonomy and
  // resolves the category server-side at submit (#1096 / ADR-025 §3), so a
  // pre-flight non-match must not block it; one without a browsable category tree
  // needs manual Allegro-id entry in the edit modal rather than the tree picker.
  //
  // `EanCategoryMatcher` and `CategoryBrowser` are `OfferManager` sub-capabilities
  // advertised on the connection payload's `supportedCapabilities` (Allegro's
  // manifest declares them, Erli does not — #1367). Keep them in the manifest; the
  // response `supportedCapabilities` mirrors the live manifest, so dropping either
  // silently regresses Allegro to the borrows-taxonomy branch (no parameter step,
  // required "Stan" unsettable → PARAMETER_REQUIRED at submit).
  const destinationResolvesCategoryAtSubmit = batchConnection
    ? !batchConnection.supportedCapabilities.includes('EanCategoryMatcher')
    : false;
  const destinationBrowsesCategories =
    (batchConnection?.supportedCapabilities.includes('CategoryBrowser') ?? false) ||
    (batchConnection
      ? (batchPlatform?.bulkCategoryBrowsingEnabled?.(batchConnection) ?? false)
      : false);

  // Reconcile the `needs-product-parameters` blocker whenever a category's
  // schema resolves (it loads after the operator picks the category, so it
  // can't be decided at resolve time). Gated to the Review step: only there do
  // rows carry resolved master data, so recomputing earlier would clobber the
  // seed blockers with values derived from un-resolved (null) master data.
  // `recomputeRowBlockers` is idempotent and the identity guard prevents a
  // re-render loop. (#810)
  useEffect(() => {
    if (!config || step !== 'review') return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (!row.primaryVariant) return row;
        const blockers = recomputeRowBlockers(
          row,
          config,
          requiredByCategory,
          platformValidate,
          destinationResolvesCategoryAtSubmit,
        );
        if (sameBlockers(blockers, row.blockers)) return row;
        changed = true;
        return { ...row, blockers };
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

  const handleUpdateRow = useCallback(
    (
      variantId: string,
      override: BulkPerProductOverride,
      editFormValues: Record<string, unknown>,
    ) => {
      if (!config) return;
      setRows((prev) =>
        prev.map((row) => {
          if (row.primaryVariant?.id !== variantId) return row;
          // `resolvedCategoryId` is the EAN-matched category and stays put — it's
          // the reference `selectBulkProductCardId` compares the submit category
          // against to decide whether the matched card still applies (#810). The
          // operator's pick lives in `override.categoryId`; overwriting the
          // resolved value here would defeat that guard and thread a stale card
          // under a switched category.
          const updated: BulkWizardRow = { ...row, override, editFormValues };
          return {
            ...updated,
            blockers: recomputeRowBlockers(
              updated,
              config,
              requiredByCategory,
              platformValidate,
              destinationResolvesCategoryAtSubmit,
            ),
          };
        }),
      );
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  const handleSubmit = useCallback(
    async (publishImmediately: boolean) => {
      if (!config) return;

      // Submittable = has a variant, no blockers, AND a concrete computed
      // price + stock. The price/stock guard is belt-and-suspenders: a
      // blocker-free row always resolves both, but filtering on them here
      // means a future logic gap excludes the row rather than silently
      // publishing the nominal `sharedConfig` fallback. Variant IDs (NOT
      // product IDs) go in `productIds` — the BE field name is misleading;
      // see `bulk-listings.types.ts` file header.
      const submittable = rows
        .filter((r) => r.primaryVariant !== null && r.blockers.length === 0)
        .map((row) => ({
          row,
          variantId: row.primaryVariant!.id,
          price: computeResolvedPrice(config.pricingPolicy, row.masterPrice, row.override),
          stock: computeResolvedStock(config.stockPolicy, row.masterStock, row.override),
        }))
        .filter(({ price, stock }) => price.value !== null && stock.value !== null);

      if (submittable.length === 0) {
        showToast({
          tone: 'error',
          description: 'No rows are ready to submit. Resolve the flagged rows first.',
        });
        return;
      }

      const variantIds = submittable.map((s) => s.variantId);
      const perProductOverrides: Record<string, BulkPerProductOverride> = {};
      for (const { row, variantId, price, stock } of submittable) {
        // Each row carries its own computed price + stock (the policy resolves
        // a distinct value per product). A per-row override price keeps its own
        // currency; policy-derived prices use the batch-wide currency (D7).
        perProductOverrides[variantId] = {
          ...row.override,
          stock: stock.value ?? undefined,
          price:
            row.override.price ??
            (price.value !== null
              ? { amount: price.value, currency: config.currency }
              : undefined),
          overrides: {
            ...(row.override.overrides ?? {}),
            categoryId:
              row.override.overrides?.categoryId ?? row.resolvedCategoryId ?? undefined,
            // #808 — link the EAN-matched product card so Allegro inherits its
            // required product parameters (Brand, Type, EAN, …). See
            // `selectBulkProductCardId` for the keep/drop rule.
            productCardId: selectBulkProductCardId(row),
          },
        };
      }

      const request: BulkOfferCreateRequest = {
        connectionId: config.connectionId,
        productIds: variantIds,
        sharedConfig: {
          // Per-row stock is always supplied via perProductOverrides above; this
          // is a required nominal fallback the worker should never reach.
          stock: 1,
          publishImmediately,
          // Belt-and-suspenders: re-derive at submit time so a stale `true`
          // in `config` (e.g. a preset draft) can't leak into the request
          // for a session that lacks `listings:write` — permission-gated,
          // not demo-mode-gated, since the bulk-create endpoint is
          // `@Roles('admin', 'operator')` in every environment (#1379 re-scope).
          generateDescription: canGenerateDescription ? config.generateDescription : false,
          overrides: {
            // Generic per-platform knobs (Allegro deliveryPolicyId, Erli
            // dispatchTime, …) — the config section populated these (#1096).
            platformParams: config.platformParams,
          },
        },
        perProductOverrides,
      };

      try {
        const result = await mutation.mutateAsync({
          idempotencyKey: idempotencyKeyRef.current,
          request,
        });
        showToast({
          tone: 'success',
          title: 'Batch submitted',
          description: `${variantIds.length.toLocaleString()} offers queued for creation.`,
        });
        void navigate(`/listings/bulk-batches/${result.batchId}`);
      } catch {
        // Surfaced via mutation.error in the modal — toast is redundant.
      }
    },
    [config, rows, mutation, navigate, showToast, canGenerateDescription],
  );

  const noVariants = rows.filter((r) => r.primaryVariant === null).length;
  const readyCount = rows.filter(
    (r) => r.primaryVariant !== null && r.blockers.length === 0,
  ).length;

  const marketplaceName = batchPlatform?.displayName ?? 'marketplace';

  return (
    <PageLayout
      eyebrow="Operations · Listings"
      title="Bulk marketplace offer creation"
      description={`Creating offers for ${rows.length} ${rows.length === 1 ? 'product' : 'products'}.`}
    >
      <div className="bulk-wizard">
        <div className="bulk-wizard__stepper">
          <SetupStepper
            steps={WIZARD_STEPS.map((s) => s.label)}
            currentStep={stepOrder(step)}
            completedSteps={new Set(Array.from({ length: stepOrder(step) }, (_, i) => i))}
          />
        </div>

        {noVariants > 0 ? (
          <Alert tone="warning">
            {noVariants} of {rows.length} products have no variants and cannot be listed.
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
              pricingPolicy={config.pricingPolicy}
              stockPolicy={config.stockPolicy}
              currency={config.currency}
              publishImmediately={config.publishImmediately}
              paramsResolving={paramsResolving}
              platformBlockerChips={platformBlockerChips}
              canBrowseCategories={destinationBrowsesCategories}
              onUpdateRow={handleUpdateRow}
              onApproveAll={() => { setConfirmOpen(true); }}
              onBack={() => { setStep('config'); }}
            />
          )}
        </div>

        {config ? (
          <BulkConfirmModal
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            rowCount={readyCount}
            connectionName={resolveConnectionName(config.connectionId)}
            marketplaceName={marketplaceName}
            initialPublishImmediately={config.publishImmediately}
            isSubmitting={mutation.isPending}
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

/** Order-sensitive blocker-list equality (`computeBlockers` emits a stable order). */
function sameBlockers(a: readonly BulkRowBlocker[], b: readonly BulkRowBlocker[]): boolean {
  return a.length === b.length && a.every((blocker, i) => blocker === b[i]);
}

/**
 * Merge resolve-step outcomes into the wizard's rows by `productId`. Exported
 * for unit testing; the wizard calls it from `handleResolveComplete`.
 */
export function mergeResolveOutcomes(
  rows: BulkWizardRow[],
  outcomes: BulkResolveOutcome[],
): BulkWizardRow[] {
  const byId = new Map(outcomes.map((o) => [o.productId, o]));
  return rows.map((row) => {
    const o = byId.get(row.productId);
    if (!o) return row;
    return {
      ...row,
      blockers: o.blockers,
      resolvedCategoryId: o.resolvedCategoryId,
      resolvedProductCardId: o.resolvedProductCardId,
      resolutionMethod: o.resolutionMethod,
      masterPrice: o.masterPrice,
      masterStock: o.masterStock,
      masterCurrency: o.masterCurrency,
      categoryCandidates: o.categoryCandidates,
    };
  });
}

function seedRows(products: Product[]): BulkWizardRow[] {
  return products.map(seedRow);
}

function seedRow(product: Product): BulkWizardRow {
  const primaryVariant: ProductVariant | null = product.variants?.[0] ?? null;
  return {
    productId: product.id,
    product,
    primaryVariant,
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
