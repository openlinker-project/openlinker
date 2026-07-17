/**
 * Bulk wizard Step 2 — master-pull resolve (#792 PR 3 / #795)
 *
 * Two batch calls, then compute each row's blocker set:
 * 1. `resolveCategoriesBatch` — one call resolves every variant EAN to a
 *    marketplace category (#795), replacing the previous one-call-per-row loop.
 * 2. `useInventoryAvailabilityBatchQuery` — one call for summed master stock.
 *
 * Master price/currency are read off the already-loaded products. Per-row
 * blockers are derived from (category result × pricing/stock policy × master
 * values). Auto-advances to Review when both batch queries settle; surfaces an
 * error + Retry if either fails.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button } from '../../../../shared/ui';
import { useApiClient } from '../../../../app/api/api-client-provider';
import { ApiError } from '../../../../shared/api/api-error';
import { useInventoryAvailabilityBatchQuery } from '../../../inventory';
import type { OfferRowValidationInput } from '../../../../shared/plugins';
import { listingsQueryKeys } from '../../api/listings.query-keys';
import type { EanMatchCandidate, EanMatchResult } from '../../api/listings.types';
import { computeBlockers, imageCountForRow } from './bulk-policy';
import type {
  BulkRowBlocker,
  BulkWizardRow,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

export interface BulkResolveOutcome {
  productId: string;
  blockers: readonly BulkRowBlocker[];
  resolvedCategoryId: string | null;
  resolvedProductCardId: string | null;
  resolutionMethod: 'auto_detect' | 'category_mapping' | 'manual' | null;
  masterPrice: number | null;
  masterStock: number | null;
  masterCurrency: string | null;
  categoryCandidates: readonly EanMatchCandidate[];
}

interface BulkResolveStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  /** Batch-wide currency (D7) — drives the currency-mismatch blocker. */
  currency: string;
  /** Resolved platform row validator (#1096) — emits platform-specific blockers. */
  platformValidate?: (input: OfferRowValidationInput) => string[];
  /**
   * True when the destination resolves the category server-side at submit
   * (`borrows` taxonomy, no `EanCategoryMatcher` — #1096). Suppresses the
   * pre-flight category blocker so such rows aren't falsely blocked.
   */
  destinationResolvesCategoryAtSubmit?: boolean;
  /** Called once with the resolved outcomes for every row, on settle. */
  onComplete: (outcomes: BulkResolveOutcome[]) => void;
}

const RESOLVE_MAX_RETRIES = 3;

/**
 * Retry only transient conditions - request timeout / network drop (status 0),
 * rate-limit (429), or a 5xx. The first Allegro `resolve-categories-batch` call
 * on a cold connection (OAuth-token exchange + `/sale/products`) can time out or
 * 5xx once; the app-wide `retry: false` default would otherwise dead-end the
 * whole resolve step, forcing a manual page reload to warm the token and retry.
 * A genuine 4xx (bad request, not-found) won't heal by retrying, so it fails fast.
 */
export function shouldRetryTransient(failureCount: number, error: Error): boolean {
  if (failureCount >= RESOLVE_MAX_RETRIES) return false;
  if (error instanceof ApiError) {
    return error.isNetworkError() || error.status === 429 || error.isServerError();
  }
  return true;
}

/** Exponential backoff capped at 8s. */
function resolveRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}

function barcodeOf(row: BulkWizardRow): string | null {
  const raw = row.primaryVariant?.ean ?? row.primaryVariant?.gtin ?? null;
  return raw && raw.trim() !== '' ? raw : null;
}

/** Non-empty source-platform category ids for the row's product (#1522). */
function sourceCategoriesOf(row: BulkWizardRow): string[] {
  return (row.product?.categories ?? []).filter((c) => typeof c === 'string' && c.trim() !== '');
}

export function BulkResolveStep({
  rows,
  connectionId,
  pricingPolicy,
  stockPolicy,
  currency,
  platformValidate,
  destinationResolvesCategoryAtSubmit,
  onComplete,
}: BulkResolveStepProps): ReactElement {
  const apiClient = useApiClient();

  const variantRows = rows.filter((r) => r.primaryVariant !== null);
  const variantIds = variantRows.map((r) => r.primaryVariant!.id);
  // Resolve any row that carries an EAN (primary catalogue-match path) OR a
  // source category (mapping-fallback path, #1522). A row with neither can't
  // resolve server-side and is synthesized as no-ean below without a call.
  const resolveItems = variantRows
    .map((r) => {
      const cats = sourceCategoriesOf(r);
      return {
        variantId: r.primaryVariant!.id,
        ean: barcodeOf(r),
        ...(cats.length > 0 ? { sourceCategoryIds: cats } : {}),
      };
    })
    .filter((i) => i.ean !== null || (i.sourceCategoryIds?.length ?? 0) > 0);
  const resolveVariantIds = resolveItems.map((i) => i.variantId);

  const categoryQuery = useQuery({
    queryKey: listingsQueryKeys.resolveCategoryBatch(connectionId, resolveVariantIds),
    queryFn: () => apiClient.listings.resolveCategoriesBatch(connectionId, { items: resolveItems }),
    enabled: resolveItems.length > 0,
    retry: shouldRetryTransient,
    retryDelay: resolveRetryDelay,
  });

  const availabilityQuery = useInventoryAvailabilityBatchQuery(variantIds, {
    retry: shouldRetryTransient,
    retryDelay: resolveRetryDelay,
  });

  const categoryReady = resolveItems.length === 0 || categoryQuery.isSuccess;
  const availabilityReady = variantIds.length === 0 || availabilityQuery.isSuccess;
  const hasError = categoryQuery.isError || availabilityQuery.isError;
  const settled = categoryReady && availabilityReady && !hasError;

  const buildOutcomes = useCallback((): BulkResolveOutcome[] => {
    const categoryResults: Record<string, EanMatchResult> = categoryQuery.data?.results ?? {};
    const availabilityMap = new Map(
      (availabilityQuery.data?.items ?? []).map((i) => [i.productVariantId, i.totalAvailable]),
    );

    return rows.map((row) => {
      const variant = row.primaryVariant;
      if (!variant) {
        return {
          productId: row.productId,
          blockers: ['no-variant'] as const,
          resolvedCategoryId: null,
          resolvedProductCardId: null,
          resolutionMethod: null,
          masterPrice: null,
          masterStock: null,
          masterCurrency: null,
          categoryCandidates: [],
        };
      }

      // Prefer the batch verdict (which now covers both the EAN-match and the
      // mapping-fallback paths, #1522). Only synthesize when the row was never
      // sent — a row with neither an EAN nor a source category (no-ean), or a
      // sent EAN row the batch somehow omitted (defensive no-match).
      const categoryResult: EanMatchResult =
        categoryResults[variant.id] ??
        (barcodeOf(row) !== null ? { kind: 'no-match' } : { kind: 'no-ean' });
      const masterPrice = variant.price;
      const masterCurrency = row.product?.currency ?? null;
      const masterStock = availabilityMap.has(variant.id)
        ? availabilityMap.get(variant.id)!
        : null;

      const blockers = computeBlockers({
        hasVariant: true,
        categoryResult,
        pricingPolicy,
        stockPolicy,
        masterPrice,
        masterStock,
        masterCurrency,
        batchCurrency: currency,
        override: row.override,
        imageCount: imageCountForRow(row),
        platformValidate,
        destinationResolvesCategoryAtSubmit,
      });

      return {
        productId: row.productId,
        blockers,
        resolvedCategoryId:
          categoryResult.kind === 'matched' ? categoryResult.allegroCategoryId : null,
        // Empty on the mapping-fallback path (no catalogue card) — normalize to
        // null so `selectBulkProductCardId` never threads an empty card (#1522).
        resolvedProductCardId:
          categoryResult.kind === 'matched' && categoryResult.productCardId !== ''
            ? categoryResult.productCardId
            : null,
        // Carry the BE-reported method so a mapping-resolved row reads as
        // `category_mapping` rather than `auto_detect` (#1522).
        resolutionMethod:
          categoryResult.kind === 'matched'
            ? categoryResult.method ?? 'auto_detect'
            : null,
        masterPrice,
        masterStock,
        masterCurrency,
        categoryCandidates:
          categoryResult.kind === 'multi-match' ? categoryResult.candidates : [],
      };
    });
  }, [
    rows,
    categoryQuery.data,
    availabilityQuery.data,
    pricingPolicy,
    stockPolicy,
    currency,
    platformValidate,
    destinationResolvesCategoryAtSubmit,
  ]);

  // Fire onComplete exactly once, when both batch queries have settled.
  const completedRef = useRef(false);
  useEffect(() => {
    if (completedRef.current || !settled) return;
    completedRef.current = true;
    onComplete(buildOutcomes());
  }, [settled, buildOutcomes, onComplete]);

  if (hasError) {
    const message =
      categoryQuery.error?.message ??
      availabilityQuery.error?.message ??
      'Resolution failed.';
    return (
      <div className="bulk-wizard__body--center" role="alert">
        <Alert tone="error">
          Could not resolve categories and stock for this batch. {message}
        </Alert>
        <Button
          tone="secondary"
          onClick={() => {
            if (categoryQuery.isError) void categoryQuery.refetch();
            if (availabilityQuery.isError) void availabilityQuery.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="bulk-wizard__body--center" role="status" aria-live="polite">
      <div className="loading-state__spinner" aria-hidden="true" />
      <h2
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          letterSpacing: 'var(--tracking-caps)',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          margin: 0,
        }}
      >
        Resolving categories &amp; stock
      </h2>
      <p className="bulk-wizard__resolve-sub">
        Matching every product's EAN against Allegro's catalog and pulling master price and
        stock in one pass. Rows without a clean match or master value are flagged so you can
        fix them before submit.
      </p>
    </div>
  );
}
