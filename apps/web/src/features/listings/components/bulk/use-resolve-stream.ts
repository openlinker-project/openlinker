/**
 * Streamed category-resolve loop (#2211, epic #2205)
 *
 * Owns everything about consuming the NDJSON `categories/resolve-stream` route:
 * the reducer, the request splitting, the resume-on-retry bookkeeping and the
 * operator-initiated stop. `BulkResolveStep` keeps the rendering and the
 * per-variant blocker computation, which is what it is actually about.
 *
 * Two properties are load-bearing and easy to break by accident, so they are
 * stated here rather than in the component:
 *
 * - **Requests are split at the route's own item cap.** The step used to chunk
 *   at 50 and fire the chunks in parallel; the streamed path sent everything in
 *   one POST, which a batch above `RESOLVE_CATEGORY_STREAM_CHUNK_SIZE` cannot
 *   pass (`@ArrayMaxSize` rejects it at the validation pipe, and the wizard's
 *   100-product cap expands to far more variants than that, #824). Chunks run
 *   SEQUENTIALLY: results already delivered are what makes a resume cheap, and
 *   one stream at a time keeps the adapter's in-flight cap meaningful.
 * - **The effect is keyed on stream CONTENT, never on array identity.** `rows`
 *   is rebuilt on any parent re-render (window-focus refetch, `staleTime`
 *   expiry), which would otherwise abort a run mid-flight and re-spend the
 *   marketplace calls already in flight.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError } from '../../../../shared/api/api-error';
import { RESOLVE_CATEGORY_STREAM_CHUNK_SIZE } from '../../api/listings.api';
import type { EanCategoryMatchStreamEvent, EanMatchResult } from '../../api/listings.types';

export const RESOLVE_MAX_RETRIES = 3;

/** One variant this run asks the destination about. */
export interface ResolveItem {
  variantId: string;
  ean: string | null;
  sourceCategoryIds?: string[];
}

/**
 * The slice of the API client this hook needs. Declared structurally so the
 * hook is testable with a two-line fake and cannot drift into depending on the
 * rest of the client.
 */
export interface ResolveStreamClient {
  listings: {
    resolveCategoriesStream: (
      connectionId: string,
      body: { items: ResolveItem[] },
      options?: { signal?: AbortSignal }
    ) => AsyncIterable<EanCategoryMatchStreamEvent>;
  };
}

export function shouldRetryTransient(failureCount: number, error: Error): boolean {
  if (failureCount >= RESOLVE_MAX_RETRIES) return false;
  if (error instanceof ApiError) {
    return error.isNetworkError() || error.status === 429 || error.isServerError();
  }
  return true;
}

export function resolveRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Stream state
// ---------------------------------------------------------------------------

export type ResolvePhase = 'starting' | 'streaming' | 'done' | 'error';

export interface ResolveStreamState {
  phase: ResolvePhase;
  /** Streamed outcomes, keyed by variant id. Survives a retry so it resumes. */
  results: Record<string, EanMatchResult>;
  /** Product ids in the order the stream first touched them. */
  touchedProductIds: string[];
  eventCount: number;
  catalogueLookupPerformed: boolean | null;
  errorMessage: string | null;
  /** When the current attempt delivered its first result, for the estimate. */
  startedAt: number | null;
}

type ResolveStreamAction =
  | {
      type: 'result';
      variantId: string;
      productId: string | null;
      result: EanMatchResult;
      at: number;
    }
  /**
   * `catalogueLookupPerformed: null` means "this arm reached its end without a
   * terminal event reporting it" - the empty-pending path, and the operator's
   * own stop. It must never be spelled as `true`: a retry that resolves no new
   * variant would then overwrite the `false` an earlier stream did report,
   * re-arming every category blocker the flag exists to suppress (the
   * #1934/F10 shape, one retry click away).
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
  startedAt: null,
};

export function resolveStreamReducer(
  state: ResolveStreamState,
  action: ResolveStreamAction
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
        startedAt: state.startedAt ?? action.at,
      };
    }
    case 'terminal':
      return {
        ...state,
        phase: 'done',
        // Only an event that actually reported the value may assign it; an
        // unobserved terminal keeps whatever a real terminal already said.
        catalogueLookupPerformed: action.catalogueLookupPerformed ?? state.catalogueLookupPerformed,
        errorMessage: null,
      };
    case 'error':
      return { ...state, phase: 'error', errorMessage: action.message };
    case 'restart':
      // Delivered results are kept deliberately: a rerun resumes the variants
      // that never resolved instead of re-spending marketplace calls on the
      // ones that did (epic #2205 decision 3).
      //
      // `eventCount` and `startedAt` reset, and that matters for more than
      // arithmetic: the counter is what tells the view a run has produced
      // something. Preserving it re-entered the progress bars showing the
      // previous attempt's numbers with nothing moving - a frozen screen for up
      // to the idle ceiling, right after the operator asked for help.
      return { ...state, phase: 'starting', errorMessage: null, eventCount: 0, startedAt: null };
    default:
      return state;
  }
}

const TRUNCATED_STREAM_MESSAGE =
  'Category matching stopped before every variant was checked, so the results are incomplete.';
/**
 * A `failed` terminal is a failure the server explicitly reported, which is a
 * different fact from a body that was cut short - so it gets its own sentence
 * rather than being described as truncation.
 */
const FAILED_STREAM_MESSAGE =
  'Category matching reported a failure part-way through this batch, so the results are incomplete.';

export interface UseResolveStreamInput {
  apiClient: ResolveStreamClient;
  connectionId: string;
  resolveItems: readonly ResolveItem[];
  /** variantId -> owning product id, for placing each event in the feed. */
  productIdByVariantId: Map<string, string>;
}

export interface UseResolveStreamResult extends ResolveStreamState {
  /** Re-run the variants that never resolved, keeping the ones that did. */
  retry: () => void;
  /**
   * Give up on the rest and settle with what arrived. The unresolved variants
   * carry a `no-match` into Review, which Review already handles, so this is a
   * way forward rather than a second full wait.
   */
  stop: () => void;
}

export function useResolveStream({
  apiClient,
  connectionId,
  resolveItems,
  productIdByVariantId,
}: UseResolveStreamInput): UseResolveStreamResult {
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
    [resolveItems]
  );

  const [stream, dispatch] = useReducer(resolveStreamReducer, INITIAL_STREAM_STATE);
  const [runId, setRunId] = useState(0);
  /**
   * Latest values the stream effect needs, read without listing them as deps.
   * Written in an effect declared BEFORE the stream effect, so a render that
   * does change the content key still hands the stream the fresh values.
   */
  const resolveItemsRef = useRef<readonly ResolveItem[]>(resolveItems);
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
  /** Latest reading a real terminal reported, for the operator's own stop. */
  const catalogueLookupRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const items = resolveItemsRef.current;
    const productIds = productIdByVariantIdRef.current;

    const pending = items.filter((i) => resultsRef.current[i.variantId] === undefined);
    if (pending.length === 0) {
      // Nothing to ask the destination about. The step is done, but this arm
      // observed no terminal event, so it reports no reading of its own -
      // `null`, never `true` (see `ResolveStreamAction`). A first run that never
      // reaches the marketplace therefore leaves the value unset, and the
      // conservative default in the component keeps every blocker.
      dispatch({ type: 'terminal', catalogueLookupPerformed: null });
      return () => {
        cancelled = true;
      };
    }

    /**
     * Consume one request's worth of items. Returns the completion the server
     * reported, or `'truncated'` when the body ended without a terminal line.
     */
    const consumeChunk = async (
      chunkItems: ResolveItem[]
    ): Promise<{
      completion: 'complete' | 'aborted' | 'failed' | 'truncated';
      catalogueLookupPerformed: boolean | null;
    }> => {
      const events = apiClient.listings.resolveCategoriesStream(
        connectionId,
        { items: chunkItems },
        { signal: controller.signal }
      );
      for await (const event of events) {
        if (cancelled) return { completion: 'aborted', catalogueLookupPerformed: null };
        deliveredRef.current += 1;
        if (event.kind === 'result') {
          resultsRef.current[event.variantId] = event.result;
          dispatch({
            type: 'result',
            variantId: event.variantId,
            productId: productIds.get(event.variantId) ?? null,
            result: event.result,
            at: Date.now(),
          });
          continue;
        }
        // Terminal line. Only `complete` is a finished request - `aborted` and
        // `failed` describe a partial one, and the 200 status can no longer say
        // so, which is exactly why the completion is on the wire.
        return {
          completion: event.completion,
          catalogueLookupPerformed: event.catalogueLookupPerformed,
        };
      }
      // End of body without a terminal line: truncated, never a clean finish.
      return { completion: 'truncated', catalogueLookupPerformed: null };
    };

    const consume = async (): Promise<void> => {
      try {
        let observed: boolean | null = null;
        // Sequential on purpose: see the file header. Every chunk is bounded by
        // the route's own item cap, so no request can be rejected for size.
        for (const chunkItems of chunk(pending, RESOLVE_CATEGORY_STREAM_CHUNK_SIZE)) {
          if (cancelled) return;
          const { completion, catalogueLookupPerformed } = await consumeChunk(chunkItems);
          if (cancelled) return;
          if (catalogueLookupPerformed === true) {
            // OR across chunks, and only ever upward: a single chunk that DID
            // consult a catalogue means this destination has one, so the
            // suppression a `false` triggers must not be inherited from a later
            // chunk that happened to report nothing.
            observed = true;
          } else if (catalogueLookupPerformed === false && observed === null) {
            observed = false;
          }
          // Published per chunk, not once at the end: an operator who stops
          // mid-run must inherit the reading a completed chunk already gave. Left
          // until after the loop, a `false` from chunk 1 was lost on a stop during
          // chunk 2, and the conservative default re-armed every category blocker
          // the flag exists to suppress - the #1934/F10 shape, one click away.
          catalogueLookupRef.current = observed ?? catalogueLookupRef.current;
          if (completion !== 'complete') {
            dispatch({
              type: 'error',
              message: completion === 'failed' ? FAILED_STREAM_MESSAGE : TRUNCATED_STREAM_MESSAGE,
            });
            return;
          }
        }
        dispatch({ type: 'terminal', catalogueLookupPerformed: observed });
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
    // Keyed on CONTENT, never on array identity - see the file header.
    // `resolveItems` / `productIdByVariantId` are read from refs so their churn
    // cannot re-arm the effect either.
  }, [apiClient, connectionId, resolveSignature, runId]);

  const retry = useCallback(() => {
    dispatch({ type: 'restart' });
    setRunId((n) => n + 1);
  }, []);

  const stop = useCallback(() => {
    // Reports the reading a real terminal gave, never a guess: a stop after a
    // chunk that said `false` must keep saying `false`.
    dispatch({ type: 'terminal', catalogueLookupPerformed: catalogueLookupRef.current });
  }, []);

  return { ...stream, retry, stop };
}
