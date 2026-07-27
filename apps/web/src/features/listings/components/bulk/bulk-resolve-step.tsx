/**
 * Bulk wizard Step 2 - per-variant master-pull resolve (#792 / #1741)
 *
 * Fans category-match + availability out over EVERY sibling variant of every
 * selected product (not just the primary, #1741), chunked to the <=200-id API
 * cap (50 for latency) via `useQueries` so a 600-offer batch runs parallel
 * request chunks and renders incremental "resolving N/M" progress instead of
 * one 60-100s synchronous call. Computes each variant's blocker set from its own
 * EAN x master values x the batch pricing/stock policy.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Alert, Button } from '../../../../shared/ui';
import { useApiClient } from '../../../../app/api/api-client-provider';
import { ApiError } from '../../../../shared/api/api-error';
import { inventoryQueryKeys } from '../../../inventory';
import type { OfferRowValidationInput } from '../../../../shared/plugins';
import { listingsQueryKeys } from '../../api/listings.query-keys';
import type { EanMatchCandidate, EanMatchResult } from '../../api/listings.types';
import { computeBlockers, effectiveVariantEan, imageCountForVariant, isValidGtin } from './bulk-policy';
import type {
  BulkRowBlocker,
  BulkVariantRow,
  BulkWizardRow,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

/** Per-sibling resolved outcome merged back into `row.variants` (#1741). */
export interface BulkResolveVariantOutcome {
  variantId: string;
  blockers: readonly BulkRowBlocker[];
  resolvedCategoryId: string | null;
  resolvedProductCardId: string | null;
  resolutionMethod: 'auto_detect' | 'category_mapping' | 'manual' | null;
  masterPrice: number | null;
  masterStock: number | null;
  masterCurrency: string | null;
  categoryCandidates: readonly EanMatchCandidate[];
  ean: string | null;
}

export interface BulkResolveOutcome {
  productId: string;
  variants: BulkResolveVariantOutcome[];
}

interface BulkResolveStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  currency: string;
  platformValidate?: (input: OfferRowValidationInput) => string[];
  destinationResolvesCategoryAtSubmit?: boolean;
  onComplete: (outcomes: BulkResolveOutcome[]) => void;
}

const RESOLVE_MAX_RETRIES = 3;
/** Chunk size - well under the 200-id API cap; smaller keeps per-chunk latency low. */
const RESOLVE_CHUNK_SIZE = 50;

export function shouldRetryTransient(failureCount: number, error: Error): boolean {
  if (failureCount >= RESOLVE_MAX_RETRIES) return false;
  if (error instanceof ApiError) {
    return error.isNetworkError() || error.status === 429 || error.isServerError();
  }
  return true;
}

function resolveRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface ResolveItem {
  variantId: string;
  ean: string | null;
  sourceCategoryIds?: string[];
}

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

  // Flatten every sibling of every product into a resolve unit.
  const allVariants = useMemo(() => {
    const list: { row: BulkWizardRow; variant: BulkVariantRow }[] = [];
    for (const row of rows) {
      for (const variant of row.variants) {
        list.push({ row, variant });
      }
    }
    return list;
  }, [rows]);

  const allVariantIds = useMemo(() => allVariants.map((x) => x.variant.variantId), [allVariants]);

  const resolveItems = useMemo<ResolveItem[]>(() => {
    return allVariants
      .map(({ row, variant }) => {
        const cats = sourceCategoriesOf(row);
        return {
          variantId: variant.variantId,
          ean: effectiveVariantEan(variant),
          ...(cats.length > 0 ? { sourceCategoryIds: cats } : {}),
        };
      })
      .filter((i) => i.ean !== null || (i.sourceCategoryIds?.length ?? 0) > 0);
  }, [allVariants]);

  const categoryChunks = useMemo(() => chunk(resolveItems, RESOLVE_CHUNK_SIZE), [resolveItems]);
  const availabilityChunks = useMemo(() => chunk(allVariantIds, RESOLVE_CHUNK_SIZE), [allVariantIds]);

  const categoryResults = useQueries({
    queries: categoryChunks.map((items) => ({
      queryKey: listingsQueryKeys.resolveCategoryBatch(
        connectionId,
        items.map((i) => i.variantId),
      ),
      queryFn: () => apiClient.listings.resolveCategoriesBatch(connectionId, { items }),
      enabled: items.length > 0,
      retry: shouldRetryTransient,
      retryDelay: resolveRetryDelay,
    })),
  });

  const availabilityResults = useQueries({
    queries: availabilityChunks.map((ids) => ({
      queryKey: inventoryQueryKeys.availability([...ids]),
      queryFn: () => apiClient.inventory.availability(ids),
      enabled: ids.length > 0,
      retry: shouldRetryTransient,
      retryDelay: resolveRetryDelay,
    })),
  });

  const allChunks = [...categoryResults, ...availabilityResults];
  const totalChunks = allChunks.length;
  const settledChunks = allChunks.filter((q) => q.isSuccess).length;
  const hasError = allChunks.some((q) => q.isError);
  const settled = totalChunks === 0 || settledChunks === totalChunks;

  const buildOutcomes = useCallback((): BulkResolveOutcome[] => {
    const categoryByVariant: Record<string, EanMatchResult> = {};
    for (const q of categoryResults) {
      for (const [variantId, result] of Object.entries(q.data?.results ?? {})) {
        categoryByVariant[variantId] = result;
      }
    }
    const availabilityByVariant = new Map<string, number>();
    for (const q of availabilityResults) {
      for (const item of q.data?.items ?? []) {
        availabilityByVariant.set(item.productVariantId, item.totalAvailable);
      }
    }

    return rows.map((row) => ({
      productId: row.productId,
      variants: row.variants.map((variant) => {
        const isMulti = row.variants.length > 1;
        const ean = effectiveVariantEan(variant);
        const categoryResult: EanMatchResult =
          categoryByVariant[variant.variantId] ??
          (ean !== null ? { kind: 'no-match' } : { kind: 'no-ean' });
        const masterPrice = variant.variant.price;
        const masterCurrency = row.product?.currency ?? null;
        const masterStock = availabilityByVariant.has(variant.variantId)
          ? availabilityByVariant.get(variant.variantId)!
          : null;

        let blockers = computeBlockers({
          hasVariant: true,
          categoryResult,
          pricingPolicy,
          stockPolicy,
          masterPrice,
          masterStock,
          masterCurrency,
          batchCurrency: currency,
          override: variant.override,
          imageCount: imageCountForVariant(row, variant),
          platformValidate,
          destinationResolvesCategoryAtSubmit,
        });
        // Master stock is authoritative + read-only for multi-variant siblings
        // (incl. 0 -> out-of-stock, not a create error). Plan §11.
        if (isMulti) blockers = blockers.filter((b) => b !== 'no-master-stock');
        // A supplied-but-invalid EAN is a hard GS1 gate (plan §10.1 / B5).
        if (ean !== null && !isValidGtin(ean) && !blockers.includes('no-ean')) {
          blockers = [...blockers, 'no-ean'];
        }

        return {
          variantId: variant.variantId,
          blockers,
          resolvedCategoryId:
            categoryResult.kind === 'matched' ? categoryResult.allegroCategoryId : null,
          resolvedProductCardId:
            categoryResult.kind === 'matched' && categoryResult.productCardId !== ''
              ? categoryResult.productCardId
              : null,
          resolutionMethod:
            categoryResult.kind === 'matched'
              ? categoryResult.method ?? 'auto_detect'
              : null,
          masterPrice,
          masterStock,
          masterCurrency,
          categoryCandidates:
            categoryResult.kind === 'multi-match' ? categoryResult.candidates : [],
          ean,
        };
      }),
    }));
  }, [
    rows,
    categoryResults,
    availabilityResults,
    pricingPolicy,
    stockPolicy,
    currency,
    platformValidate,
    destinationResolvesCategoryAtSubmit,
  ]);

  const completedRef = useRef(false);
  useEffect(() => {
    if (completedRef.current || hasError || !settled) return;
    completedRef.current = true;
    onComplete(buildOutcomes());
  }, [settled, hasError, buildOutcomes, onComplete]);

  if (hasError) {
    const firstError = allChunks.find((q) => q.isError)?.error;
    const message = firstError instanceof Error ? firstError.message : 'Resolution failed.';
    return (
      <div className="bulk-wizard__body--center" role="alert">
        <Alert tone="error">
          Could not resolve categories and stock for this batch. {message}
        </Alert>
        <Button
          tone="secondary"
          onClick={() => {
            for (const q of allChunks) if (q.isError) void q.refetch();
          }}
        >
          Retry resolve
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
        Resolving variants - {settledChunks} of {totalChunks || 1}
      </h2>
      <p className="bulk-wizard__resolve-sub">
        Matching each variant's EAN against the marketplace catalog and pulling per-variant
        master price and stock in parallel chunks. Review fills in as siblings settle; rows
        without a clean match or master value are flagged so you can fix them before submit.
      </p>
    </div>
  );
}
