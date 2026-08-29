/**
 * BulkResolveStep tests (#792 / #1741 / #2211)
 *
 * The Resolve step consumes the NDJSON `categories/resolve-stream` route and
 * reports progress per variant: an overall bar, a per-product bar and a live
 * outcome list. These specs pin the properties the streamed loader exists for -
 * the bar advances per variant, an immediate terminal renders no 0% bars, a
 * stream that ends without its terminal line is an error, retry is gated on
 * nothing having been delivered, and `catalogueLookupPerformed: false` never
 * turns a `no-match` into a category blocker.
 */
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { RESOLVE_CATEGORY_STREAM_CHUNK_SIZE } from '../../api/listings.api';
import { ApiError } from '../../../../shared/api/api-error';
import {
  BulkResolveStep,
  shouldRetryTransient,
  type BulkResolveCompletion,
  type BulkResolveOutcome,
} from './bulk-resolve-step';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';
import type {
  EanCategoryMatchStreamEvent,
  ResolveCategoriesBatchRequest,
} from '../../api/listings.types';

type OnComplete = (outcomes: BulkResolveOutcome[], completion: BulkResolveCompletion) => void;

type ResolveStreamFn = (
  connectionId: string,
  body: ResolveCategoriesBatchRequest,
  options?: { signal?: AbortSignal },
) => AsyncIterable<EanCategoryMatchStreamEvent>;

function makeVariant(id: string, overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: 'M' },
    ean: '5901234123457',
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isStale: false,
    staleAt: null,
    ...overrides,
  };
}

function variantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = makeVariant(id, { productId: 'prod_1' });
  return {
    variantId: id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: variant.attributes,
    masterStock: null,
    masterPrice: variant.price,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

function makeRow(productId: string, variants: BulkVariantRow[]): BulkWizardRow {
  return {
    productId,
    product: {
      id: productId,
      name: 'Merino Hiking Socks',
      currency: 'PLN',
      images: null,
      categories: [],
    } as unknown as Product,
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
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

/** A gate a test opens to let the stream emit its next event. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = (): void => resolve();
  });
  return { wait, open };
}

/**
 * Build a stream from a script. `null` entries are gates the test opens; a
 * thrown value ends the attempt; running out of entries ends the body WITHOUT
 * a terminal line, which is the truncated case.
 */
function scriptedStream(
  script: readonly (EanCategoryMatchStreamEvent | Promise<void> | Error)[],
): AsyncIterable<EanCategoryMatchStreamEvent> {
  async function* iterate(): AsyncGenerator<EanCategoryMatchStreamEvent, void, undefined> {
    for (const entry of script) {
      if (entry instanceof Error) throw entry;
      if (entry instanceof Promise) {
        await entry;
        continue;
      }
      yield entry;
    }
  }
  return iterate();
}

function result(variantId: string, kind: 'matched' | 'no-match'): EanCategoryMatchStreamEvent {
  return kind === 'matched'
    ? {
        kind: 'result',
        variantId,
        result: { kind: 'matched', allegroCategoryId: 'cat-A', productCardId: 'card-A' },
      }
    : { kind: 'result', variantId, result: { kind: 'no-match' } };
}

function done(
  overrides: Partial<Omit<EanCategoryMatchStreamEvent & { kind: 'done' }, 'kind'>> = {},
): EanCategoryMatchStreamEvent {
  return {
    kind: 'done',
    resolvedCount: 0,
    unresolvedCount: 0,
    completion: 'complete',
    catalogueLookupPerformed: true,
    ...overrides,
  };
}

function mockClient(
  resolveCategoriesStream: ResolveStreamFn,
  availability: Array<{ productVariantId: string; totalAvailable: number; locationCount: number }> = [],
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    listings: { resolveCategoriesStream: vi.fn(resolveCategoriesStream) },
    inventory: { availability: vi.fn().mockResolvedValue({ items: availability }) },
  });
}

function stepElement(
  rows: BulkWizardRow[],
  onComplete: OnComplete,
  onBack?: () => void,
): ReactElement {
  return (
    <BulkResolveStep
      rows={rows}
      connectionId="conn_1"
      pricingPolicy={{ mode: 'use-master' }}
      stockPolicy={{ mode: 'use-master' }}
      currency="PLN"
      onBack={onBack}
      onComplete={onComplete}
    />
  );
}

function renderStep(
  apiClient: ReturnType<typeof createMockApiClient>,
  onComplete: OnComplete,
  rows: BulkWizardRow[] = [makeRow('prod_1', [variantRow('v1'), variantRow('v2')])],
  onBack?: () => void,
): RenderResult {
  return renderWithProviders(stepElement(rows, onComplete, onBack), { apiClient });
}

/** One product carrying `count` siblings, so a batch can exceed the request cap. */
function wideRow(count: number): BulkWizardRow {
  return makeRow(
    'prod_1',
    Array.from({ length: count }, (_, i) => variantRow(`v${i + 1}`)),
  );
}

describe('BulkResolveStep', () => {
  it('advances the overall bar once per variant, not once per chunk', async () => {
    const secondVariant = gate();
    const terminal = gate();
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(() =>
      scriptedStream([
        result('v1', 'matched'),
        secondVariant.wait,
        result('v2', 'matched'),
        terminal.wait,
        done(),
      ]),
    );

    renderStep(apiClient, onComplete);

    const overall = await screen.findByRole('progressbar', { name: /variants resolved in this batch/i });
    await waitFor(() => {
      expect(overall).toHaveAttribute('aria-valuenow', '1');
    });
    expect(overall).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText(/1 of 2 variants resolved/i)).toBeInTheDocument();

    secondVariant.open();
    await waitFor(() => {
      expect(overall).toHaveAttribute('aria-valuenow', '2');
    });
    expect(onComplete).not.toHaveBeenCalled();

    terminal.open();
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the product currently in flight with its own variant count', async () => {
    const onComplete = vi.fn<OnComplete>();
    const held = gate();
    const apiClient = mockClient(() =>
      scriptedStream([result('v1', 'matched'), held.wait, done()]),
    );

    renderStep(apiClient, onComplete);

    expect(
      await screen.findByRole('progressbar', { name: /variants resolved for Merino Hiking Socks/i }),
    ).toHaveAttribute('aria-valuenow', '1');
    // One number, three faces: the label, `aria-valuenow` and the fill all report
    // variants FINISHED. The label used to count the one in flight instead, so a
    // sighted user read "2 of 2" while a screen reader announced "1 of 2".
    // Exact text, not a regex: the batch line above reads "1 of 2 variants
    // resolved", so a loose match hits both and the assertion stops being about
    // the product track at all.
    expect(screen.getByText('1 of 2 variants')).toBeInTheDocument();
    held.open();
  });

  it('renders no progress bars when the stream terminates immediately', async () => {
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(() =>
      scriptedStream([done({ catalogueLookupPerformed: false })]),
    );

    renderStep(apiClient, onComplete);

    // No bar may appear at 0% while the terminal-only stream settles: a
    // destination with no matcher must not flash two empty tracks (#2205 d.4).
    expect(screen.queryByRole('progressbar')).toBeNull();
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(onComplete.mock.calls[0][1]).toEqual({ catalogueLookupPerformed: false });
  });

  it('treats a stream that ends without its terminal line as an error', async () => {
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(() => scriptedStream([result('v1', 'matched')]));

    renderStep(apiClient, onComplete);

    expect(await screen.findByText(/Retry resolve/i)).toBeInTheDocument();
    expect(screen.getByText(/stopped before every variant was checked/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("treats completion 'failed' as an error rather than a clean finish", async () => {
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(() =>
      scriptedStream([result('v1', 'matched'), done({ completion: 'failed' })]),
    );

    renderStep(apiClient, onComplete);

    expect(await screen.findByText(/Retry resolve/i)).toBeInTheDocument();
    // A reported failure is not truncation, and does not read as one.
    expect(screen.getByText(/reported a failure part-way through/i)).toBeInTheDocument();
    expect(screen.queryByText(/stopped before every variant was checked/i)).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('auto-retries a transient failure while nothing has been delivered', async () => {
    const onComplete = vi.fn<OnComplete>();
    let attempt = 0;
    const apiClient = mockClient(() => {
      attempt += 1;
      return attempt === 1
        ? scriptedStream([new ApiError('gateway', 503, undefined)])
        : scriptedStream([result('v1', 'matched'), result('v2', 'matched'), done()]);
    });

    renderStep(apiClient, onComplete);

    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalledTimes(1);
      },
      { timeout: 4000 },
    );
    expect(attempt).toBe(2);
    expect(screen.queryByText(/Retry resolve/i)).toBeNull();
  });

  it('never restarts after an event has been delivered, and resumes only the unresolved variants', async () => {
    const onComplete = vi.fn<OnComplete>();
    const calls: ResolveCategoriesBatchRequest[] = [];
    let attempt = 0;
    const apiClient = mockClient((_connectionId, body) => {
      calls.push(body);
      attempt += 1;
      return attempt === 1
        ? scriptedStream([result('v1', 'matched'), new ApiError('gateway', 503, undefined)])
        : scriptedStream([result('v2', 'matched'), done()]);
    });

    renderStep(apiClient, onComplete);

    // The failure is surfaced instead of silently re-running the chunk.
    expect(await screen.findByText(/Retry resolve/i)).toBeInTheDocument();
    expect(attempt).toBe(1);
    expect(screen.getByText(/1 of 2 variants already resolved/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Retry resolve/i));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(calls[0].items.map((i) => i.variantId)).toEqual(['v1', 'v2']);
    expect(calls[1].items.map((i) => i.variantId)).toEqual(['v2']);
  });

  it('does not restart the stream when the parent hands back a new-but-equal rows array', async () => {
    // The wizard rebuilds `rows` as a fresh array on any parent re-render (a
    // window-focus refetch, `staleTime` expiry). Keyed on array identity that
    // aborted the in-flight stream and re-spent the marketplace calls already
    // in flight; keyed on content it must be a no-op.
    const secondVariant = gate();
    const onComplete = vi.fn<OnComplete>();
    const streamFn = vi.fn<ResolveStreamFn>(() =>
      scriptedStream([
        result('v1', 'matched'),
        secondVariant.wait,
        result('v2', 'matched'),
        done(),
      ]),
    );
    const apiClient = createMockApiClient({
      listings: { resolveCategoriesStream: streamFn },
      inventory: { availability: vi.fn().mockResolvedValue({ items: [] }) },
    });

    const step = (rows: BulkWizardRow[]): ReactElement => (
      <BulkResolveStep
        rows={rows}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />
    );

    const { rerender } = renderWithProviders(
      step([makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]),
      { apiClient },
    );

    const overall = await screen.findByRole('progressbar', {
      name: /variants resolved in this batch/i,
    });
    await waitFor(() => {
      expect(overall).toHaveAttribute('aria-valuenow', '1');
    });
    expect(streamFn).toHaveBeenCalledTimes(1);

    // Same work, all-new objects - exactly what the wizard's sync effect emits.
    rerender(step([makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]));
    await waitFor(() => {
      expect(screen.getByText(/1 of 2 variants resolved/i)).toBeInTheDocument();
    });
    expect(streamFn).toHaveBeenCalledTimes(1);

    // The ORIGINAL stream is still the one being read: releasing its gate
    // finishes the run, which a restart would have abandoned.
    secondVariant.open();
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it('keeps a reported catalogueLookupPerformed:false across a retry that resolves nothing new', async () => {
    // An availability-only failure used to be retried through the empty-pending
    // path, which asserted `catalogueLookupPerformed: true` it never observed -
    // re-arming every category blocker the flag exists to suppress.
    const onComplete = vi.fn<OnComplete>();
    const availability = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('availability unavailable', 400, undefined))
      .mockResolvedValue({ items: [] });
    const streamFn = vi.fn<ResolveStreamFn>(() =>
      scriptedStream([
        result('v1', 'no-match'),
        result('v2', 'no-match'),
        done({ catalogueLookupPerformed: false }),
      ]),
    );
    const apiClient = createMockApiClient({
      listings: { resolveCategoriesStream: streamFn },
      inventory: { availability },
    });

    renderStep(apiClient, onComplete);

    await userEvent.click(await screen.findByText(/Retry resolve/i));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onComplete.mock.calls[0][1]).toEqual({ catalogueLookupPerformed: false });
    for (const variant of onComplete.mock.calls[0][0][0].variants) {
      expect(variant.blockers).not.toContain('no-match');
    }
    // Every variant already resolved, so the retry asked the destination nothing.
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it('reports per-variant blockers when the catalogue was consulted', async () => {
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(
      () => scriptedStream([result('v1', 'matched'), result('v2', 'no-match'), done()]),
      [
        { productVariantId: 'v1', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'v2', totalAvailable: 9, locationCount: 1 },
      ],
    );

    renderStep(apiClient, onComplete);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    const variants = onComplete.mock.calls[0][0][0].variants;
    expect(variants.find((v) => v.variantId === 'v1')?.blockers).toEqual([]);
    expect(variants.find((v) => v.variantId === 'v2')?.blockers).toContain('no-match');
  });

  it('does not turn a no-match into a category blocker when no catalogue was consulted', async () => {
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(
      () =>
        scriptedStream([
          result('v1', 'no-match'),
          result('v2', 'no-match'),
          done({ catalogueLookupPerformed: false }),
        ]),
      [
        { productVariantId: 'v1', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'v2', totalAvailable: 9, locationCount: 1 },
      ],
    );

    renderStep(apiClient, onComplete);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    const variants = onComplete.mock.calls[0][0][0].variants;
    for (const variant of variants) {
      expect(variant.blockers).not.toContain('no-match');
    }
    expect(onComplete.mock.calls[0][1]).toEqual({ catalogueLookupPerformed: false });
  });

  it('splits a batch over the request cap into sequential requests', async () => {
    // The route caps `items` at `RESOLVE_CATEGORY_STREAM_CHUNK_SIZE` and the
    // wizard's 100-PRODUCT cap expands to far more variants than that (#824), so
    // a single un-split POST is rejected by the validation pipe - a dead end with
    // no Back and a retry that fails identically forever. Splitting is what keeps
    // the streamed path reachable for a real batch.
    const total = RESOLVE_CATEGORY_STREAM_CHUNK_SIZE + 5;
    const onComplete = vi.fn<OnComplete>();
    const seenSizes: number[] = [];
    const apiClient = mockClient((_connectionId, body) => {
      seenSizes.push(body.items.length);
      return scriptedStream([
        ...body.items.map((item) => result(item.variantId, 'matched')),
        done(),
      ]);
    });

    renderStep(apiClient, onComplete, [wideRow(total)]);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(seenSizes).toEqual([RESOLVE_CATEGORY_STREAM_CHUNK_SIZE, 5]);
    // Sequential, not parallel: the second request is only made once the first
    // has delivered its terminal, which is what keeps the adapter's in-flight
    // cap meaningful and gives the abort path a checkpoint.
    expect(onComplete.mock.calls[0][0][0].variants).toHaveLength(total);
  });

  it('settles with the results already delivered when the operator stops the run', async () => {
    const held = gate();
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(() =>
      scriptedStream([result('v1', 'matched'), held.wait, result('v2', 'matched'), done()]),
    );

    renderStep(apiClient, onComplete);

    await userEvent.click(await screen.findByText(/Stop and review 1/i));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    // The one that resolved keeps its category; the one that never did carries a
    // `no-match` into Review, which Review already surfaces per row.
    const variants = onComplete.mock.calls[0][0][0].variants;
    expect(variants[0].resolvedCategoryId).toBe('cat-A');
    expect(variants[1].resolvedCategoryId).toBeNull();
    // A stop observed no terminal of its own, so it must not claim a catalogue
    // reading a real terminal never reported.
    expect(onComplete.mock.calls[0][1]).toEqual({ catalogueLookupPerformed: true });
    held.open();
  });

  it('keeps a chunk-reported catalogueLookupPerformed: false across an operator stop', async () => {
    // The #1934/F10 shape: defaulting to `true` on a stop re-arms every category
    // blocker for a destination that consulted no catalogue at all, which is
    // exactly what the flag exists to suppress.
    const total = RESOLVE_CATEGORY_STREAM_CHUNK_SIZE + 1;
    const held = gate();
    const onComplete = vi.fn<OnComplete>();
    let call = 0;
    const apiClient = mockClient((_connectionId, body) => {
      call += 1;
      return call === 1
        ? scriptedStream([
            ...body.items.map((item) => result(item.variantId, 'no-match')),
            done({ catalogueLookupPerformed: false }),
          ])
        : scriptedStream([held.wait, done({ catalogueLookupPerformed: false })]);
    });

    renderStep(apiClient, onComplete, [wideRow(total)]);

    await userEvent.click(
      await screen.findByText(new RegExp(`Stop and review ${RESOLVE_CATEGORY_STREAM_CHUNK_SIZE}`)),
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onComplete.mock.calls[0][1]).toEqual({ catalogueLookupPerformed: false });
    held.open();
  });

  it('offers a way out of the step while the stream is still running', async () => {
    const held = gate();
    const onBack = vi.fn();
    const onComplete = vi.fn<OnComplete>();
    const apiClient = mockClient(() =>
      scriptedStream([result('v1', 'matched'), held.wait, done()]),
    );

    renderStep(
      apiClient,
      onComplete,
      [makeRow('prod_1', [variantRow('v1'), variantRow('v2')])],
      onBack,
    );

    // Wait for the progress panel before querying the button: the step swaps the
    // waiting panel for the bars on the first event, and a node resolved before
    // that swap is detached by the time the click is dispatched.
    await screen.findByRole('progressbar', { name: /variants resolved in this batch/i });
    await userEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    held.open();
  });

  it('re-asks about a variant whose EAN changed under it, keeping no stale outcome', async () => {
    // The carried results/retry counters make a rerun cheap, but they are keyed
    // to the QUESTION. When `rows` is refetched in place and a barcode moved,
    // the variant would otherwise be filtered out of `pending` as
    // already-resolved and keep an outcome matched against a barcode that no
    // longer exists.
    const onComplete = vi.fn<OnComplete>();
    const streamFn = vi.fn<ResolveStreamFn>(() =>
      scriptedStream([result('v1', 'no-match'), done({ unresolvedCount: 1 })]),
    );
    const apiClient = mockClient(streamFn);
    const rowWith = (ean: string): BulkWizardRow =>
      makeRow('prod_1', [
        variantRow('v1', { variant: makeVariant('v1', { productId: 'prod_1', ean }), ean }),
      ]);

    const { rerender } = renderStep(apiClient, onComplete, [rowWith('5901234123457')]);

    await waitFor(() => {
      expect(streamFn).toHaveBeenCalledTimes(1);
    });
    expect(streamFn.mock.calls[0][1].items).toEqual([{ variantId: 'v1', ean: '5901234123457' }]);

    rerender(stepElement([rowWith('5909999999999')], onComplete));

    await waitFor(() => {
      expect(streamFn).toHaveBeenCalledTimes(2);
    });
    expect(streamFn.mock.calls[1][1].items).toEqual([{ variantId: 'v1', ean: '5909999999999' }]);
  });
});

describe('shouldRetryTransient', () => {
  it('retries transient network/5xx/429, not a 4xx', () => {
    expect(shouldRetryTransient(0, new ApiError('x', 0, undefined))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('x', 503, undefined))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('x', 429, undefined))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('x', 400, undefined))).toBe(false);
    expect(shouldRetryTransient(3, new ApiError('x', 503, undefined))).toBe(false);
  });
});
