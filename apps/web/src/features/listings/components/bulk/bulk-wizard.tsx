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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, PageLayout, SetupStepper } from '../../../../shared/ui';
import { useToast } from '../../../../shared/ui/toast-provider';
import { useBulkSubmitMutation } from '../../hooks/use-bulk-submit-mutation';
import type {
  BulkOfferCreateRequest,
  BulkPerProductOverride,
} from '../../api/bulk-listings.types';
import type { EanMatchResult } from '../../api/listings.types';
import type { Product, ProductVariant } from '../../../products';
import { BulkConfigStep } from './bulk-config-step';
import { BulkResolveStep, type BulkResolveOutcome } from './bulk-resolve-step';
import { BulkReviewStep } from './bulk-review-step';
import { BulkConfirmModal } from './bulk-confirm-modal';
import { computeBlockers, computeResolvedPrice, computeResolvedStock } from './bulk-policy';
import type {
  BulkWizardConfig,
  BulkWizardRow,
  BulkWizardStep,
} from './bulk-wizard.types';

interface BulkWizardProps {
  /** Selected products from the Products page (already hydrated with variants). */
  products: Product[];
  /** Connection name displayed in the confirm modal once config is known. */
  resolveConnectionName: (connectionId: string) => string;
}

const WIZARD_STEPS: { id: BulkWizardStep; label: string }[] = [
  { id: 'config', label: 'Config' },
  { id: 'resolve', label: 'Resolving' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
];

export function BulkWizard({
  products,
  resolveConnectionName,
}: BulkWizardProps): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mutation = useBulkSubmitMutation();

  // Mint a stable idempotency key once per wizard mount. Retries from the
  // confirm step submit reuse it; remount mints a fresh one.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

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
          const resolvedCategoryId =
            override.overrides?.categoryId ?? row.resolvedCategoryId;
          const blockers = computeBlockers({
            hasVariant: true,
            categoryResult: categoryResultFor(row, resolvedCategoryId),
            pricingPolicy: config.pricingPolicy,
            stockPolicy: config.stockPolicy,
            masterPrice: row.masterPrice,
            masterStock: row.masterStock,
            masterCurrency: row.masterCurrency,
            batchCurrency: config.currency,
            override,
          });
          return { ...row, override, editFormValues, blockers, resolvedCategoryId };
        }),
      );
    },
    [config],
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
          generateDescription: config.generateDescription,
          overrides: {
            platformParams: { deliveryPolicyId: config.deliveryPolicyId },
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
    [config, rows, mutation, navigate, showToast],
  );

  const noVariants = rows.filter((r) => r.primaryVariant === null).length;
  const readyCount = rows.filter(
    (r) => r.primaryVariant !== null && r.blockers.length === 0,
  ).length;

  return (
    <PageLayout
      eyebrow="Operations · Listings"
      title="Bulk Allegro offer creation"
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
              onComplete={handleResolveComplete}
            />
          )}
          {step === 'review' && config && (
            <BulkReviewStep
              rows={rows}
              connectionId={config.connectionId}
              pricingPolicy={config.pricingPolicy}
              stockPolicy={config.stockPolicy}
              currency={config.currency}
              publishImmediately={config.publishImmediately}
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

/**
 * Reconstruct an `EanMatchResult` from a row's current category state so
 * `computeBlockers` can re-derive the category blocker after a per-row edit
 * without re-fetching. An operator-picked / previously-matched category id
 * yields `matched`; otherwise the surviving category blocker decides.
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
