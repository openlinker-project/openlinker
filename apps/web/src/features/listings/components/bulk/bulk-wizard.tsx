/**
 * Bulk listing wizard (#740)
 *
 * Multi-step controller: Config → Resolving → Review (with Edit modal) →
 * Confirm → submit. Owns the rows[] state + sharedConfig + perRow overrides.
 *
 * `step` is driven via URL search param so the wizard is linkable; on submit
 * the page redirects to /listings/bulk-batches/:batchId.
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
import type { Product, ProductVariant } from '../../../products';
import { BulkConfigStep } from './bulk-config-step';
import { BulkResolveStep, type BulkResolveOutcome } from './bulk-resolve-step';
import { BulkReviewStep } from './bulk-review-step';
import { BulkConfirmModal } from './bulk-confirm-modal';
import type {
  BulkRowStatus,
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

  // Sync row state when products list changes (rare — would only happen if
  // the page upstream refetches). We compare against the product-id set,
  // not the product object identities, so a passive cache refresh that
  // produces structurally-equal products doesn't clobber row state.
  // `productsSignature` (not `products` directly) is the dependency —
  // `products` flips identity on every TanStack cache rehydrate, which
  // would re-run this for structurally-equal data and clobber row state.
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

  const handleResolveComplete = useCallback(
    (outcomes: BulkResolveOutcome[]) => {
      setRows((prev) => applyResolveOutcomes(prev, outcomes));
      setStep('review');
    },
    [],
  );

  const handleUpdateRow = useCallback(
    (
      variantId: string,
      override: BulkPerProductOverride,
      editFormValues: Record<string, unknown>,
    ) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.primaryVariant?.id !== variantId) return row;
          // Filling in a category override marks a previously-error row as ready.
          const newStatus: BulkRowStatus =
            override.overrides?.categoryId &&
            (row.status === 'no-ean' ||
              row.status === 'no-match' ||
              row.status === 'pending-after-timeout')
              ? 'matched'
              : row.status;
          return {
            ...row,
            override,
            editFormValues,
            status: newStatus,
            resolvedCategoryId:
              override.overrides?.categoryId ?? row.resolvedCategoryId,
          };
        }),
      );
    },
    [],
  );

  const handleSubmit = useCallback(
    async (publishImmediately: boolean) => {
      if (!config) return;

      // Build the bulk submit payload. Variant IDs (NOT product IDs) go in
      // `productIds` — the BE field name is misleading; see
      // `bulk-listings.types.ts` file header.
      const submittableRows = rows.filter(
        (r) => r.primaryVariant !== null && r.status === 'matched',
      );

      if (submittableRows.length === 0) {
        showToast({
          tone: 'error',
          description: 'No rows are ready to submit. Approve some matched rows first.',
        });
        return;
      }

      const variantIds = submittableRows.map((r) => r.primaryVariant!.id);
      const perProductOverrides: Record<string, BulkPerProductOverride> = {};
      for (const row of submittableRows) {
        if (Object.keys(row.override).length > 0 || row.resolvedCategoryId) {
          // Always send the resolved category — even if the operator didn't
          // touch the row — so the worker doesn't fall back to auto-detect.
          perProductOverrides[row.primaryVariant!.id] = {
            ...row.override,
            overrides: {
              ...(row.override.overrides ?? {}),
              categoryId:
                row.override.overrides?.categoryId ??
                row.resolvedCategoryId ??
                undefined,
            },
          };
        }
      }

      const sharedOverridesPlatformParams: Record<string, unknown> = {
        deliveryPolicyId: config.deliveryPolicyId,
      };

      const request: BulkOfferCreateRequest = {
        connectionId: config.connectionId,
        productIds: variantIds,
        sharedConfig: {
          stock: config.defaultStock,
          publishImmediately,
          generateDescription: config.generateDescription,
          ...(config.defaultPrice ? { price: config.defaultPrice } : {}),
          overrides: {
            platformParams: sharedOverridesPlatformParams,
          },
        },
        ...(Object.keys(perProductOverrides).length > 0
          ? { perProductOverrides }
          : {}),
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

  const noVariants = rows.filter((r) => r.status === 'no-variant').length;

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
            completedSteps={
              new Set(
                Array.from({ length: stepOrder(step) }, (_, i) => i),
              )
            }
          />
        </div>

        {noVariants > 0 ? (
          <Alert tone="warning">
            {noVariants} of {rows.length} products have no variants and cannot be
            listed. They'll be skipped on submit.
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
              onComplete={handleResolveComplete}
            />
          )}
          {step === 'review' && config && (
            <BulkReviewStep
              rows={rows}
              connectionId={config.connectionId}
              defaults={{
                stock: config.defaultStock,
                publishImmediately: config.publishImmediately,
                priceAmount: config.defaultPrice
                  ? config.defaultPrice.amount.toFixed(2)
                  : '0.00',
                priceCurrency: config.defaultPrice?.currency ?? 'PLN',
              }}
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
            rowCount={rows.filter((r) => r.status === 'matched').length}
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
 * Pure reducer that applies a batch of resolve-step outcomes to the wizard's
 * row state. Exported for unit testing; the wizard calls it from
 * `handleResolveComplete` via `setRows((prev) => applyResolveOutcomes(...))`.
 *
 * Guard semantics (#796): a `pending-after-timeout` outcome must NEVER
 * overwrite a row already in a terminal state (`matched` / `no-match` /
 * `no-ean` / `no-variant`). The resolve-step fix prevents the stale-closure
 * `onComplete` from firing in the first place; this guard catches any
 * future regression that tries to downgrade settled rows.
 */
export function applyResolveOutcomes(
  rows: BulkWizardRow[],
  outcomes: BulkResolveOutcome[],
): BulkWizardRow[] {
  return rows.map((row) => {
    const o = outcomes.find((x) => x.productId === row.productId);
    if (!o) return row;
    if (
      o.status === 'pending-after-timeout' &&
      row.status !== 'resolving' &&
      row.status !== 'pending-after-timeout'
    ) {
      return row;
    }
    return {
      ...row,
      status: o.status,
      resolvedCategoryId: o.categoryId,
      resolutionMethod: o.method,
    };
  });
}

function seedRows(products: Product[]): BulkWizardRow[] {
  return products.map(seedRow);
}

function seedRow(product: Product): BulkWizardRow {
  const primaryVariant: ProductVariant | null = product.variants?.[0] ?? null;
  let status: BulkRowStatus;
  if (!primaryVariant) {
    status = 'no-variant';
  } else if (!primaryVariant.ean && !primaryVariant.gtin) {
    status = 'no-ean';
  } else {
    status = 'resolving';
  }
  return {
    productId: product.id,
    product,
    primaryVariant,
    status,
    resolvedCategoryId: null,
    resolutionMethod: null,
    override: {},
  };
}
