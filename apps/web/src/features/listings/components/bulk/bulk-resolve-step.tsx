/**
 * Bulk wizard Step 2 - streamed per-variant resolve (#792 / #1741 / #2211)
 *
 * Consumes the NDJSON `categories/resolve-stream` route (epic #2205) and
 * reports progress the operator can actually read: one bar for the whole batch
 * (variants resolved of total) and one for the product currently in flight
 * (variant N of M), with the last few products listed underneath and their
 * outcome named. Availability is still pulled per chunk, but it is an instant
 * read and no longer counts as a unit of progress - mixing the two is what made
 * the old counter say "1 of 2" when it meant "0 of 1".
 *
 * Each variant's blocker set is still computed here, from its own EAN x master
 * values x the batch pricing/stock policy.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useQueries } from '@tanstack/react-query';
import { Alert, Button } from '../../../../shared/ui';
import { useApiClient } from '../../../../app/api/api-client-provider';
import { ApiError } from '../../../../shared/api/api-error';
import { inventoryQueryKeys } from '../../../inventory';
import type { OfferRowValidationInput } from '../../../../shared/plugins';
import type { EanMatchCandidate, EanMatchResult } from '../../api/listings.types';
import {
  computeBlockers,
  effectiveVariantEan,
  imageCountForVariant,
  isValidGtin,
  titleForVariant,
} from './bulk-policy';
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

/**
 * What the step learned about the destination while resolving, reported to the
 * wizard alongside the outcomes.
 *
 * `catalogueLookupPerformed: false` means no destination catalogue was consulted
 * at all, so every `no-match` in that run says nothing about the operator's
 * barcodes and must not gate a row on a missing category. The wizard cannot
 * derive this from the static manifest - a destination that borrows a matcher
 * (#1045) looks identical there - which is the #1934/F10 mistake in reverse.
 */
export interface BulkResolveCompletion {
  catalogueLookupPerformed: boolean;
}

interface BulkResolveStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  currency: string;
  platformValidate?: (input: OfferRowValidationInput) => string[];
  destinationResolvesCategoryAtSubmit?: boolean;
  onComplete: (outcomes: BulkResolveOutcome[], completion: BulkResolveCompletion) => void;
}

const RESOLVE_MAX_RETRIES = 3;
/** Chunk size - well under the 200-id API cap; smaller keeps per-chunk latency low. */
const RESOLVE_CHUNK_SIZE = 50;
/** How many products the live list keeps on screen at once. */
const RESOLVE_FEED_SIZE = 4;

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

// ---------------------------------------------------------------------------
// Stream state
// ---------------------------------------------------------------------------

type ResolvePhase = 'starting' | 'streaming' | 'done' | 'error';

interface ResolveStreamState {
  phase: ResolvePhase;
  /** Streamed outcomes, keyed by variant id. Survives a retry so it resumes. */
  results: Record<string, EanMatchResult>;
  /** Product ids in the order the stream first touched them. */
  touchedProductIds: string[];
  eventCount: number;
  catalogueLookupPerformed: boolean | null;
  errorMessage: string | null;
}

type ResolveStreamAction =
  | { type: 'result'; variantId: string; productId: string | null; result: EanMatchResult }
  /**
   * `catalogueLookupPerformed: null` means "this arm reached its end without a
   * terminal event reporting it" - the empty-pending path. It must never be
   * spelled as `true`: a retry that resolves no new variant would then overwrite
   * the `false` an earlier stream did report, re-arming every category blocker
   * the flag exists to suppress (the #1934/F10 shape, one retry click away).
   */
  | { type: 'terminal'; catalogueLookupPerformed: boolean | null }
  | { type: 'error'; message: string }
  | { type: 'restart' };

const INITIAL_STREAM_STATE: ResolveStreamState = {
  phase: 'starting',
  results: {},
  touchedProductIds: [],
  eventCount: 0,
  catalogueLookupPerformed: null,
  errorMessage: null,
};

function resolveStreamReducer(
  state: ResolveStreamState,
  action: ResolveStreamAction,
): ResolveStreamState {
  switch (action.type) {
    case 'result': {
      const touchedProductIds =
        action.productId !== null && !state.touchedProductIds.includes(action.productId)
          ? [...state.touchedProductIds, action.productId]
          : state.touchedProductIds;
      return {
        ...state,
        phase: 'streaming',
        results: { ...state.results, [action.variantId]: action.result },
        touchedProductIds,
        eventCount: state.eventCount + 1,
        errorMessage: null,
      };
    }
    case 'terminal':
      return {
        ...state,
        phase: 'done',
        // Only an event that actually reported the value may assign it; an
        // unobserved terminal keeps whatever a real terminal already said.
        catalogueLookupPerformed:
          action.catalogueLookupPerformed ?? state.catalogueLookupPerformed,
        errorMessage: null,
      };
    case 'error':
      return { ...state, phase: 'error', errorMessage: action.message };
    case 'restart':
      // Delivered results are kept deliberately: a rerun resumes the variants
      // that never resolved instead of re-spending marketplace calls on the
      // ones that did (epic #2205 decision 3).
      return { ...state, phase: 'starting', errorMessage: null };
    default:
      return state;
  }
}

const TRUNCATED_STREAM_MESSAGE =
  'The resolver stopped before reporting every variant, so the results are incomplete.';
/**
 * A `failed` terminal is a failure the server explicitly reported, which is a
 * different fact from a body that was cut short - so it gets its own sentence
 * rather than being described as truncation.
 */
const FAILED_STREAM_MESSAGE =
  'The resolver reported a failure part-way through this batch, so the results are incomplete.';

// ---------------------------------------------------------------------------

interface ResolveProduct {
  productId: string;
  name: string;
  /** Only the variants this run actually asks the destination about. */
  variantIds: string[];
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

  /** variantId -> owning product id, for placing each stream event. */
  const productIdByVariantId = useMemo(() => {
    const map = new Map<string, string>();
    for (const { row, variant } of allVariants) {
      map.set(variant.variantId, row.productId);
    }
    return map;
  }, [allVariants]);

  /** Products this run resolves, with only their streamed variants. */
  const resolveProductsById = useMemo(() => {
    const streamed = new Set(resolveItems.map((i) => i.variantId));
    const map = new Map<string, ResolveProduct>();
    for (const { row, variant } of allVariants) {
      if (!streamed.has(variant.variantId)) continue;
      const existing = map.get(row.productId);
      if (existing) {
        existing.variantIds.push(variant.variantId);
      } else {
        map.set(row.productId, {
          productId: row.productId,
          name: row.product?.name ?? row.productId,
          variantIds: [variant.variantId],
        });
      }
    }
    return map;
  }, [allVariants, resolveItems]);

  const availabilityChunks = useMemo(
    () => chunk(allVariantIds, RESOLVE_CHUNK_SIZE),
    [allVariantIds],
  );

  // Availability stays a TanStack query: it is an instant OL-store read, not a
  // per-variant marketplace call, and it is deliberately absent from the
  // progress denominator (#2211).
  const availabilityResults = useQueries({
    queries: availabilityChunks.map((ids) => ({
      queryKey: inventoryQueryKeys.availability([...ids]),
      queryFn: () => apiClient.inventory.availability(ids),
      enabled: ids.length > 0,
      retry: shouldRetryTransient,
      retryDelay: resolveRetryDelay,
    })),
  });

  const availabilitySettled = availabilityResults.every((q) => q.isSuccess);
  const availabilityError = availabilityResults.find((q) => q.isError)?.error ?? null;

  /**
   * The stream's content key: what this run would ask the destination about,
   * order-independent. Two renders that describe the same work produce the same
   * string even when every array around them is a fresh object, which is what
   * the old `useQueries` path got for free from its content-derived `queryKey`.
   */
  const resolveSignature = useMemo(
    () =>
      resolveItems
        .map((item) => {
          const categories = [...(item.sourceCategoryIds ?? [])].sort().join('~');
          return `${item.variantId}|${item.ean ?? ''}|${categories}`;
        })
        .sort()
        .join(','),
    [resolveItems],
  );

  const [stream, dispatch] = useReducer(resolveStreamReducer, INITIAL_STREAM_STATE);
  const [runId, setRunId] = useState(0);
  /**
   * Latest values the stream effect needs, read without listing them as deps.
   * Written in an effect declared BEFORE the stream effect, so a render that
   * does change the content key still hands the stream the fresh values.
   */
  const resolveItemsRef = useRef<ResolveItem[]>(resolveItems);
  const productIdByVariantIdRef = useRef<Map<string, string>>(productIdByVariantId);
  useEffect(() => {
    resolveItemsRef.current = resolveItems;
    productIdByVariantIdRef.current = productIdByVariantId;
  });
  /** Results across every attempt, read inside the effect without re-arming it. */
  const resultsRef = useRef<Record<string, EanMatchResult>>({});
  /** Total events ever delivered - the retry gate (epic #2205 decision 3). */
  const deliveredRef = useRef(0);
  const autoRetriesRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const resolveItems = resolveItemsRef.current;
    const productIdByVariantId = productIdByVariantIdRef.current;

    const pending = resolveItems.filter((i) => resultsRef.current[i.variantId] === undefined);
    if (pending.length === 0) {
      // Nothing to ask the destination about. The step is done, but this arm
      // observed no terminal event, so it reports no reading of its own -
      // `null`, never `true` (see `ResolveStreamAction`). A first run that never
      // reaches the marketplace therefore leaves the value unset, and the
      // conservative default below keeps every blocker.
      dispatch({ type: 'terminal', catalogueLookupPerformed: null });
      return () => {
        cancelled = true;
      };
    }

    const consume = async (): Promise<void> => {
      try {
        const events = apiClient.listings.resolveCategoriesStream(
          connectionId,
          { items: pending },
          { signal: controller.signal },
        );
        for await (const event of events) {
          if (cancelled) return;
          deliveredRef.current += 1;
          if (event.kind === 'result') {
            resultsRef.current[event.variantId] = event.result;
            dispatch({
              type: 'result',
              variantId: event.variantId,
              productId: productIdByVariantId.get(event.variantId) ?? null,
              result: event.result,
            });
            continue;
          }
          // Terminal line. Only `complete` is a finished run - `aborted` and
          // `failed` describe a partial one, and the 200 status can no longer
          // say so, which is exactly why the completion is on the wire.
          if (event.completion === 'complete') {
            dispatch({
              type: 'terminal',
              catalogueLookupPerformed: event.catalogueLookupPerformed,
            });
          } else {
            dispatch({
              type: 'error',
              message:
                event.completion === 'failed' ? FAILED_STREAM_MESSAGE : TRUNCATED_STREAM_MESSAGE,
            });
          }
          return;
        }
        if (cancelled) return;
        // End of body without a terminal line: truncated, never a clean finish.
        dispatch({ type: 'error', message: TRUNCATED_STREAM_MESSAGE });
      } catch (error) {
        if (cancelled) return;
        const failure = error instanceof Error ? error : new Error('Resolution failed.');
        // Retry only while NOTHING has been delivered - that is the #1709
        // cold-start case the retry exists for. Once an event has arrived the
        // run is progressing, so restarting it would re-spend marketplace calls
        // that already succeeded; the operator resumes instead.
        if (deliveredRef.current === 0 && shouldRetryTransient(autoRetriesRef.current, failure)) {
          const delay = resolveRetryDelay(autoRetriesRef.current);
          autoRetriesRef.current += 1;
          retryTimer = setTimeout(() => {
            if (!cancelled) setRunId((n) => n + 1);
          }, delay);
          return;
        }
        dispatch({ type: 'error', message: failure.message });
      }
    };

    void consume();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      controller.abort();
    };
    // Keyed on CONTENT, never on array identity. `rows` is rebuilt as a new
    // array holding the same rows on any parent re-render (a window-focus
    // refetch, `staleTime` expiry), which would otherwise abort the in-flight
    // stream mid-run and re-spend the marketplace calls already in flight - the
    // regression an identity dep reintroduced over the old content-keyed
    // `useQueries` path. `resolveItems` / `productIdByVariantId` are read from
    // refs so their churn cannot re-arm the effect either.
  }, [apiClient, connectionId, resolveSignature, runId]);

  const catalogueLookupPerformed = stream.catalogueLookupPerformed ?? true;
  // A destination that looked nothing up cannot have produced a meaningful
  // `no-match`, so its rows are not gated on a category the wizard was never
  // in a position to resolve.
  const categoryResolvesAtSubmit =
    destinationResolvesCategoryAtSubmit === true || !catalogueLookupPerformed;

  const buildOutcomes = useCallback((): BulkResolveOutcome[] => {
    const categoryByVariant = stream.results;
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
          effectiveTitle: titleForVariant(row, variant),
          platformValidate,
          destinationResolvesCategoryAtSubmit: categoryResolvesAtSubmit,
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
            categoryResult.kind === 'matched' ? (categoryResult.method ?? 'auto_detect') : null,
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
    stream.results,
    availabilityResults,
    pricingPolicy,
    stockPolicy,
    currency,
    platformValidate,
    categoryResolvesAtSubmit,
  ]);

  const settled = stream.phase === 'done' && availabilitySettled;
  const hasError = stream.phase === 'error' || availabilityError !== null;

  const completedRef = useRef(false);
  useEffect(() => {
    if (completedRef.current || hasError || !settled) return;
    completedRef.current = true;
    onComplete(buildOutcomes(), { catalogueLookupPerformed });
  }, [settled, hasError, buildOutcomes, onComplete, catalogueLookupPerformed]);

  const retry = useCallback(() => {
    for (const q of availabilityResults) {
      if (q.isError) void q.refetch();
    }
    dispatch({ type: 'restart' });
    setRunId((n) => n + 1);
  }, [availabilityResults]);

  if (hasError) {
    const message =
      stream.errorMessage ??
      (availabilityError instanceof Error ? availabilityError.message : 'Resolution failed.');
    const resolvedSoFar = Object.keys(stream.results).length;
    return (
      <div className="bulk-wizard__body--center" role="alert">
        <Alert tone="error">
          Could not resolve categories and stock for this batch. {message}
        </Alert>
        {resolvedSoFar > 0 ? (
          <p className="bulk-wizard__resolve-sub">
            {resolvedSoFar} of {resolveItems.length} variants already resolved. Retrying picks up
            the remaining ones instead of starting over.
          </p>
        ) : null}
        <Button tone="secondary" onClick={retry}>
          Retry resolve
        </Button>
      </div>
    );
  }

  const totalVariants = resolveItems.length;
  const resolvedVariants = Object.keys(stream.results).length;

  // Nothing has come back yet. Rendering the bars here would put two tracks at
  // 0% on screen for a destination that terminates immediately (epic #2205
  // decision 4), so the waiting state is its own panel.
  if (stream.eventCount === 0) {
    return (
      <div className="bulk-wizard__body--center" role="status" aria-live="polite">
        <div className="bulk-wizard__resolve-pending" aria-hidden="true" />
        <h2 className="bulk-wizard__resolve-title">
          {totalVariants > 0
            ? `Resolving ${totalVariants} ${totalVariants === 1 ? 'variant' : 'variants'}`
            : 'Pulling master price and stock'}
        </h2>
        <p className="bulk-wizard__resolve-sub">
          {totalVariants > 0
            ? 'Asking the marketplace catalog about the first barcode. Results appear one product at a time as they come back.'
            : 'No variant in this batch carries a barcode or a source category, so there is nothing to match against the catalog.'}
        </p>
      </div>
    );
  }

  const overallPct = totalVariants > 0 ? (resolvedVariants / totalVariants) * 100 : 100;

  const feedProducts = [...stream.touchedProductIds]
    .reverse()
    .slice(0, RESOLVE_FEED_SIZE)
    .map((productId) => {
      const product = resolveProductsById.get(productId);
      const variantIds = product?.variantIds ?? [];
      const done = variantIds.filter((id) => stream.results[id] !== undefined).length;
      const outcome = productOutcome(variantIds, stream.results, done === variantIds.length);
      return {
        productId,
        name: product?.name ?? productId,
        done,
        total: variantIds.length,
        outcome,
      };
    });

  const current = feedProducts.find((p) => p.done < p.total) ?? feedProducts[0];

  return (
    <div className="bulk-wizard__body--center">
      <h2 className="bulk-wizard__resolve-title">
        Resolving {totalVariants} {totalVariants === 1 ? 'variant' : 'variants'}
      </h2>

      <div className="bulk-wizard__resolve-track bulk-wizard__resolve-track--batch">
        <p className="bulk-wizard__resolve-track-meta" role="status" aria-live="polite">
          <span>
            {resolvedVariants} of {totalVariants} variants resolved
          </span>
          <span>
            {stream.touchedProductIds.length} of {resolveProductsById.size} products
          </span>
        </p>
        <div
          className="bulk-wizard__progress-bar"
          role="progressbar"
          aria-label="Variants resolved in this batch"
          aria-valuemin={0}
          aria-valuemax={totalVariants}
          aria-valuenow={resolvedVariants}
        >
          <div className="bulk-wizard__progress-fill" style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      {current ? (
        <div className="bulk-wizard__resolve-track">
          <p className="bulk-wizard__resolve-track-meta">
            <span className="bulk-wizard__resolve-track-name">{current.name}</span>
            <span>
              variant {Math.min(current.done + 1, current.total)} of {current.total}
            </span>
          </p>
          <div
            className="bulk-wizard__progress-bar"
            role="progressbar"
            aria-label={`Variants resolved for ${current.name}`}
            aria-valuemin={0}
            aria-valuemax={current.total}
            aria-valuenow={current.done}
          >
            <div
              className="bulk-wizard__progress-fill bulk-wizard__progress-fill--product"
              style={{ width: `${current.total > 0 ? (current.done / current.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      <ul className="bulk-progress__list bulk-wizard__resolve-feed">
        {feedProducts.map((product) => {
          const complete = product.done >= product.total;
          const incomplete = complete && product.outcome === 'manual';
          const pct = product.total > 0 ? (product.done / product.total) * 100 : 0;
          const rowClass = [
            'bulk-progress__row',
            !complete ? 'bulk-progress__row--current' : '',
            incomplete ? 'bulk-progress__row--incomplete' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const barClass = ['bulk-progress__bar', incomplete ? 'bulk-progress__bar--warn' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <li key={product.productId} className={rowClass}>
              <div className="bulk-progress__name">
                {product.name}
                <small>
                  variant {product.done} of {product.total}
                </small>
              </div>
              <div className={barClass}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <span
                className={['chip', OUTCOME_CHIP[product.outcome].tone].filter(Boolean).join(' ')}
              >
                {OUTCOME_CHIP[product.outcome].label}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="bulk-wizard__resolve-sub">
        Each variant&apos;s barcode is matched against the marketplace catalog, then per-variant
        master price and stock are pulled. Products that need a category are flagged here so you
        can fix them in Review before submit.
      </p>
    </div>
  );
}

type ProductResolveOutcome = 'catalogue' | 'mapping' | 'manual' | 'pending';

const OUTCOME_CHIP: Record<ProductResolveOutcome, { tone: string; label: string }> = {
  catalogue: { tone: 'chip--success', label: 'Matched in catalog' },
  mapping: { tone: 'chip--review', label: 'From category mapping' },
  manual: { tone: 'chip--warning', label: 'Needs a category' },
  pending: { tone: '', label: 'Checking barcode' },
};

/**
 * One product's headline outcome. Worst case wins: a single sibling needing a
 * category is what the operator has to act on, so it must not be hidden behind
 * the ones that matched.
 */
function productOutcome(
  variantIds: readonly string[],
  results: Record<string, EanMatchResult>,
  complete: boolean,
): ProductResolveOutcome {
  if (!complete) return 'pending';
  let sawMapping = false;
  for (const variantId of variantIds) {
    const result = results[variantId];
    if (result === undefined || result.kind !== 'matched') return 'manual';
    if (result.method === 'category_mapping') sawMapping = true;
  }
  return sawMapping ? 'mapping' : 'catalogue';
}
