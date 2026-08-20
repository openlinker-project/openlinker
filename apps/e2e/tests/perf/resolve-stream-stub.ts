/**
 * Resolve-step NDJSON transport stub (epic #2205 / #2212)
 *
 * The bulk wizard's Resolve step reads
 * `POST /listings/connections/:id/categories/resolve-stream` as an NDJSON body
 * and updates its progress on every line. Reproducing that in a browser test
 * needs a body that arrives INCREMENTALLY: `route.fulfill` can only hand over a
 * complete payload, so every line would land in one read, every dispatch would
 * batch into one React commit, and the very property under test - progress that
 * advances per variant - would be unobservable.
 *
 * So the stub is installed one layer up, as a `window.fetch` patch scoped to
 * that single path, returning a real `Response` over a real `ReadableStream`
 * whose lines are paced by the production cost model:
 *
 *   backend wall time = ceil(items / ALLEGRO_EAN_CONCURRENCY) * perEanLatencyMs
 *
 * i.e. roughly one line every `perEanLatencyMs / concurrency`. Everything above
 * the socket stays the app's own production code: the NDJSON decoder and its
 * idle ceiling, the retry gate, the reducer, the two progress bars, the live
 * product feed, and the blocker computation the Review step then renders. Every
 * other route the wizard touches is stubbed with `page.route` by the spec.
 *
 * The stub also records what the test cannot see from outside the page: the
 * exact item set of every attempt (which is how "a resume does not re-run
 * already-resolved variants" becomes checkable) and every distinct
 * `aria-valuenow` the batch progress bar ever carried, collected by a
 * `MutationObserver` so no state is lost to polling granularity.
 *
 * @module tests/perf
 */
import type { Page } from '@playwright/test';

/**
 * Backend in-flight cap for the STREAMING path - mirrors `STREAM_CONCURRENCY`
 * in `resolve-categories-for-batch-by-ean.ts` (#2215), not the narrower
 * `DEFAULT_CONCURRENCY` the batch collector keeps. Change one and change the
 * other, or this stub paces a backend that no longer exists.
 */
export const ALLEGRO_EAN_CONCURRENCY = 9;

/** Path fragment the patched `fetch` claims; every other URL falls through. */
export const RESOLVE_STREAM_PATH_FRAGMENT = '/categories/resolve-stream';

/** Window key the in-page recorder writes to. */
export const RESOLVE_STREAM_STUB_KEY = '__olResolveStreamStub';

/** Accessible name of the batch bar in `bulk-resolve-step.tsx`. */
export const BATCH_PROGRESS_LABEL = 'Variants resolved in this batch';

/** Per-product outcome the stub reports, so the feed's three chips are reachable. */
export type ResolveStreamOutcome = 'matched' | 'mapping' | 'no-match';

/**
 * How a cut attempt ends.
 *
 * - `none` - every attempt runs to a `complete` terminal.
 * - `truncate` - the body ends after `linesBeforeCut` lines with NO terminal
 *   line, which is the only shape a 200 response cannot otherwise disown.
 * - `failed-terminal` - a terminal line reporting `completion: 'failed'`.
 * - `error-mid` - the body errors after lines have already been delivered.
 * - `reject-cold` - the request fails before a single line, the #1709 cold-start
 *   shape the retry gate exists for.
 */
export type ResolveStreamCut =
  | 'none'
  | 'truncate'
  | 'failed-terminal'
  | 'error-mid'
  | 'reject-cold';

export interface ResolveStreamPlan {
  /** Per-EAN marketplace latency the pacing is derived from. */
  perEanLatencyMs: number;
  /** In-flight cap; one line lands every `perEanLatencyMs / concurrency`. */
  concurrency: number;
  /**
   * Write every result line plus the terminal in ONE body write. This is the
   * real shape of a destination with no EAN matcher: the core generator yields
   * one `no-match` per item with no `await` between them (epic #2205 decision
   * 4), so they reach the client together.
   */
  immediate: boolean;
  cut: ResolveStreamCut;
  /** Result lines written before the cut applies. */
  linesBeforeCut: number;
  /** How many LEADING attempts the cut applies to; later attempts run clean. */
  cutAttempts: number;
  /** Outcome cycle, indexed by the product ordinal encoded in the variant id. */
  outcomeCycle: readonly ResolveStreamOutcome[];
  /** Value the terminal line reports; `false` must not arm category blockers. */
  catalogueLookupPerformed: boolean;
  /** Category id a `matched` result carries. */
  resolvedCategoryId: string;
}

export function resolveStreamPlan(overrides: Partial<ResolveStreamPlan> = {}): ResolveStreamPlan {
  return {
    perEanLatencyMs: 600,
    concurrency: ALLEGRO_EAN_CONCURRENCY,
    immediate: false,
    cut: 'none',
    linesBeforeCut: 0,
    cutAttempts: 1,
    outcomeCycle: ['matched'],
    catalogueLookupPerformed: true,
    resolvedCategoryId: '165986',
    ...overrides,
  };
}

/** How one attempt ended, as recorded inside the page. */
export type ResolveStreamAttemptOutcome =
  | 'open'
  | 'complete'
  | 'failed-terminal'
  | 'truncated'
  | 'errored'
  | 'rejected'
  | 'aborted';

export interface ResolveStreamAttempt {
  index: number;
  /** Items this attempt asked the destination about - the resume evidence. */
  requestedVariantIds: string[];
  /** Items it actually reported back before ending. */
  deliveredVariantIds: string[];
  startedAtMs: number;
  endedAtMs: number | null;
  outcome: ResolveStreamAttemptOutcome;
}

export interface ResolveStreamStubState {
  attempts: ResolveStreamAttempt[];
  /**
   * Every distinct `aria-valuenow` the batch bar carried, in order. Collected by
   * a `MutationObserver` rather than sampled, so the count is the number of
   * progress states the operator's screen really passed through - not an
   * artefact of how often the test looked.
   */
  batchProgressValues: number[];
  /** Attempts the browser abandoned via its own `AbortSignal`. */
  abortedAttempts: number;
}

/**
 * Installed with `page.addInitScript`, so it runs before the SPA's first script
 * and cannot miss the initial mount of the progress bar.
 *
 * Serialized by source, so the body must stay self-contained: no imports, no
 * module-scope references, only the plan argument.
 */
function installResolveStreamStub(input: { plan: ResolveStreamPlan; stateKey: string; pathFragment: string; batchLabel: string }): void {
  const { plan, stateKey, pathFragment, batchLabel } = input;

  const state: ResolveStreamStubState = {
    attempts: [],
    batchProgressValues: [],
    abortedAttempts: 0,
  };
  (window as unknown as Record<string, unknown>)[stateKey] = state;

  const recordBar = (element: Element): void => {
    if (element.getAttribute('aria-label') !== batchLabel) return;
    const raw = element.getAttribute('aria-valuenow');
    if (raw === null) return;
    const value = Number(raw);
    if (Number.isNaN(value)) return;
    const seen = state.batchProgressValues;
    if (seen.length > 0 && seen[seen.length - 1] === value) return;
    seen.push(value);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        recordBar(record.target);
        continue;
      }
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        recordBar(node);
        node.querySelectorAll('[role="progressbar"]').forEach(recordBar);
      }
    }
  });

  const startObserving = (): void => {
    if (document.body === null) {
      window.requestAnimationFrame(startObserving);
      return;
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-valuenow'],
    });
  };
  startObserving();

  const productOrdinal = (variantId: string): number => {
    const match = /perf(\d+)_/.exec(variantId);
    return match === null ? 0 : Number(match[1]);
  };

  const outcomeFor = (variantId: string): ResolveStreamOutcome => {
    const cycle = plan.outcomeCycle;
    return cycle[productOrdinal(variantId) % cycle.length];
  };

  const resultPayload = (variantId: string): Record<string, unknown> => {
    const outcome = outcomeFor(variantId);
    if (outcome === 'no-match') return { kind: 'no-match' };
    return {
      kind: 'matched',
      allegroCategoryId: plan.resolvedCategoryId,
      // Empty on the configured-mapping path: there is no catalogue card, the
      // offer self-links by barcode at build time.
      productCardId: outcome === 'mapping' ? '' : `card-${variantId}`,
      method: outcome === 'mapping' ? 'category_mapping' : 'auto_detect',
    };
  };

  const requestedIdsOf = (init: RequestInit | undefined): string[] => {
    const body = init?.body;
    if (typeof body !== 'string') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
    if (typeof parsed !== 'object' || parsed === null) return [];
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const ids: string[] = [];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const variantId = (item as { variantId?: unknown }).variantId;
      if (typeof variantId === 'string') ids.push(variantId);
    }
    return ids;
  };

  const originalFetch = window.fetch.bind(window);

  const patched = async (input_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input_ === 'string'
        ? input_
        : input_ instanceof URL
          ? input_.href
          : input_.url;
    if (!url.includes(pathFragment)) return originalFetch(input_, init);

    const attempt: ResolveStreamAttempt = {
      index: state.attempts.length,
      requestedVariantIds: requestedIdsOf(init),
      deliveredVariantIds: [],
      startedAtMs: Date.now(),
      endedAtMs: null,
      outcome: 'open',
    };
    state.attempts.push(attempt);
    const cutApplies = attempt.index < plan.cutAttempts;

    if (cutApplies && plan.cut === 'reject-cold') {
      attempt.endedAtMs = Date.now();
      attempt.outcome = 'rejected';
      // A `TypeError` is what `fetch` itself raises on a transport failure, and
      // it is what `ApiError.fromNetworkFailure` turns into status 0 - the value
      // `shouldRetryTransient` reads as transient.
      throw new TypeError('Failed to fetch');
    }

    const variantIds = attempt.requestedVariantIds;
    const encoder = new TextEncoder();
    const signal = init?.signal ?? null;

    let resolvedCount = 0;
    let unresolvedCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        const write = (line: Record<string, unknown>): void => {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        };
        const writeResult = (variantId: string): void => {
          const result = resultPayload(variantId);
          if (result.kind === 'matched') resolvedCount += 1;
          else unresolvedCount += 1;
          write({ kind: 'result', variantId, result });
          attempt.deliveredVariantIds.push(variantId);
        };
        const writeTerminal = (completion: 'complete' | 'failed'): void => {
          write({
            kind: 'done',
            resolvedCount,
            unresolvedCount,
            completion,
            catalogueLookupPerformed: plan.catalogueLookupPerformed,
          });
        };
        const finish = (outcome: ResolveStreamAttemptOutcome): void => {
          attempt.endedAtMs = Date.now();
          attempt.outcome = outcome;
        };

        const onAbort = (): void => {
          // The step aborts its controller in the effect cleanup, which also runs
          // when the wizard leaves the step on SUCCESS. An abort that arrives
          // after the stream already ended is that teardown, not an abandoned
          // attempt, so it must not be counted as one.
          if (attempt.endedAtMs !== null) return;
          if (timer !== null) clearTimeout(timer);
          state.abortedAttempts += 1;
          finish('aborted');
          controller.error(new DOMException('Aborted', 'AbortError'));
        };
        if (signal !== null) signal.addEventListener('abort', onAbort, { once: true });

        if (plan.immediate) {
          for (const variantId of variantIds) writeResult(variantId);
          writeTerminal('complete');
          controller.close();
          finish('complete');
          return;
        }

        const cutAt = cutApplies && plan.cut !== 'none' ? Math.min(plan.linesBeforeCut, variantIds.length) : variantIds.length;
        const intervalMs = Math.max(1, Math.round(plan.perEanLatencyMs / plan.concurrency));
        let index = 0;

        const tick = (): void => {
          if (index < cutAt) {
            writeResult(variantIds[index]);
            index += 1;
            timer = setTimeout(tick, intervalMs);
            return;
          }
          if (!cutApplies || plan.cut === 'none') {
            writeTerminal('complete');
            controller.close();
            finish('complete');
            return;
          }
          if (plan.cut === 'failed-terminal') {
            writeTerminal('failed');
            controller.close();
            finish('failed-terminal');
            return;
          }
          if (plan.cut === 'truncate') {
            controller.close();
            finish('truncated');
            return;
          }
          controller.error(new TypeError('Network connection lost'));
          finish('errored');
        };
        timer = setTimeout(tick, intervalMs);
      },
      cancel(): void {
        // The decoder cancels the body when it stops early (terminal reached,
        // unmount, idle ceiling), which is how the real route learns the reader
        // left. Stopping the pacing timer mirrors that.
        if (timer !== null) clearTimeout(timer);
        if (attempt.endedAtMs === null) {
          attempt.endedAtMs = Date.now();
          attempt.outcome = 'complete';
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  };

  window.fetch = patched as typeof fetch;
}

/** Installs the stub for every navigation in this page. */
export async function installResolveStream(page: Page, plan: ResolveStreamPlan): Promise<void> {
  await page.addInitScript(installResolveStreamStub, {
    plan,
    stateKey: RESOLVE_STREAM_STUB_KEY,
    pathFragment: RESOLVE_STREAM_PATH_FRAGMENT,
    batchLabel: BATCH_PROGRESS_LABEL,
  });
}

/** Reads what the in-page recorder collected. */
export async function readResolveStreamState(page: Page): Promise<ResolveStreamStubState> {
  return page.evaluate((key: string): ResolveStreamStubState => {
    const state = (window as unknown as Record<string, unknown>)[key];
    if (state === undefined) {
      return { attempts: [], batchProgressValues: [], abortedAttempts: 0 };
    }
    return state as ResolveStreamStubState;
  }, RESOLVE_STREAM_STUB_KEY);
}

/** Forces the dark palette regardless of what the saved session stored. */
export async function forceDarkTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('openlinker.theme', 'dark');
    } catch {
      // localStorage can be unavailable; `colorScheme: 'dark'` still applies.
    }
  });
}
