/**
 * Listings API - resolve-category stream tests (#2211)
 *
 * The NDJSON reader is the one piece of non-trivial transport logic the streamed
 * Resolve step adds: lines are not aligned to chunk boundaries, the transport
 * injects keep-alive filler that carries no outcome, and a non-2xx must still
 * raise `ApiError` so the route's 404 / 409 / 422 gate keeps working.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import {
  createListingsApi,
  parseResolveCategoryStreamLine,
  RESOLVE_CATEGORY_STREAM_IDLE_TIMEOUT_MS,
  RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS,
} from './listings.api';
import type { EanCategoryMatchStreamEvent } from './listings.types';

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const part of chunks) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

async function collect(
  iterable: AsyncIterable<EanCategoryMatchStreamEvent>,
): Promise<EanCategoryMatchStreamEvent[]> {
  const out: EanCategoryMatchStreamEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

const RESULT_LINE = '{"kind":"result","variantId":"v1","result":{"kind":"no-match"}}';
const DONE_LINE =
  '{"kind":"done","resolvedCount":0,"unresolvedCount":1,"completion":"complete","catalogueLookupPerformed":false}';

describe('parseResolveCategoryStreamLine', () => {
  it('keeps outcome-bearing lines and drops everything a consumer must ignore', () => {
    expect(parseResolveCategoryStreamLine(RESULT_LINE)).toEqual({
      kind: 'result',
      variantId: 'v1',
      result: { kind: 'no-match' },
    });
    expect(parseResolveCategoryStreamLine('')).toBeNull();
    expect(parseResolveCategoryStreamLine('   ')).toBeNull();
    expect(parseResolveCategoryStreamLine('{"kind":"keep-alive"}')).toBeNull();
    expect(parseResolveCategoryStreamLine('{"kind":"something-new"}')).toBeNull();
    // A body cut mid-object leaves an unparseable tail; dropping it is safe
    // because the missing terminal line is what proves truncation.
    expect(parseResolveCategoryStreamLine('{"kind":"resu')).toBeNull();
  });
});

describe('resolveCategoriesStream', () => {
  it('reassembles lines split across chunks and skips keep-alive filler', async () => {
    const requestStream = vi.fn().mockResolvedValue(
      streamOf([
        '{"kind":"keep-alive"}\n' + RESULT_LINE.slice(0, 20),
        RESULT_LINE.slice(20) + '\n{"kind":"keep-alive"}\n',
        DONE_LINE + '\n',
      ]),
    );
    const api = createListingsApi(vi.fn(), requestStream);

    const events = await collect(
      api.resolveCategoriesStream('conn_1', { items: [{ variantId: 'v1', ean: '123' }] }),
    );

    expect(events).toEqual([
      { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
      {
        kind: 'done',
        resolvedCount: 0,
        unresolvedCount: 1,
        completion: 'complete',
        catalogueLookupPerformed: false,
      },
    ]);
    expect(requestStream).toHaveBeenCalledWith(
      '/listings/connections/conn_1/categories/resolve-stream',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('yields a final line the body did not terminate with a newline', async () => {
    const requestStream = vi.fn().mockResolvedValue(streamOf([`${RESULT_LINE}\n${DONE_LINE}`]));
    const api = createListingsApi(vi.fn(), requestStream);

    const events = await collect(
      api.resolveCategoriesStream('conn_1', { items: [{ variantId: 'v1', ean: '123' }] }),
    );

    expect(events).toHaveLength(2);
    expect(events[1].kind).toBe('done');
  });

  it('fails a body that opens and then goes quiet, instead of hanging forever', async () => {
    // The streamed transport arms no wall clock on purpose (a 500-variant run
    // takes minutes), so the reader's idle ceiling is the only thing standing
    // between a dead worker and a step stuck on the shimmer panel with no error
    // and no retry.
    vi.useFakeTimers();
    try {
      const requestStream = vi.fn().mockResolvedValue(
        new ReadableStream<Uint8Array>({
          start(): void {
            // Opens, never writes, never closes.
          },
        }),
      );
      const api = createListingsApi(vi.fn(), requestStream);

      const settled = collect(
        api.resolveCategoriesStream('conn_1', { items: [{ variantId: 'v1', ean: '123' }] }),
      ).then(
        () => null,
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(RESOLVE_CATEGORY_STREAM_IDLE_TIMEOUT_MS + 1);
      const error = await settled;
      expect(error).toBeInstanceOf(ApiError);
      // 408, not a 5xx or a network error: `shouldRetryTransient` must not
      // re-run a silent stream and burn another idle window before the operator
      // is told anything.
      expect((error as ApiError).status).toBe(408);
      expect((error as ApiError).message).toMatch(/stopped sending data/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rearms the idle ceiling on keep-alive filler, so a long quiet run survives', async () => {
    vi.useFakeTimers();
    try {
      const sink: { controller: ReadableStreamDefaultController<Uint8Array> | null } = {
        controller: null,
      };
      const encoder = new TextEncoder();
      const requestStream = vi.fn().mockResolvedValue(
        new ReadableStream<Uint8Array>({
          start(controller): void {
            sink.controller = controller;
          },
        }),
      );
      const api = createListingsApi(vi.fn(), requestStream);

      const settled = collect(
        api.resolveCategoriesStream('conn_1', { items: [{ variantId: 'v1', ean: '123' }] }),
      ).then(
        (events) => events,
        (error: unknown) => error,
      );

      // Well past the ceiling in total, but never quiet for a whole window.
      const ticks =
        Math.ceil(
          RESOLVE_CATEGORY_STREAM_IDLE_TIMEOUT_MS / RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS,
        ) + 2;
      for (let i = 0; i < ticks; i += 1) {
        await vi.advanceTimersByTimeAsync(RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS);
        sink.controller?.enqueue(encoder.encode('{"kind":"keep-alive"}\n'));
      }
      sink.controller?.enqueue(encoder.encode(`${DONE_LINE}\n`));
      sink.controller?.close();

      await vi.advanceTimersByTimeAsync(0);
      const outcome = await settled;
      expect(Array.isArray(outcome)).toBe(true);
      expect(outcome as EanCategoryMatchStreamEvent[]).toHaveLength(1);
      expect((outcome as EanCategoryMatchStreamEvent[])[0].kind).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates the gate rejection so 404 / 409 / 422 still surface', async () => {
    const requestStream = vi.fn().mockRejectedValue(new ApiError('Connection disabled', 409, null));
    const api = createListingsApi(vi.fn(), requestStream);

    await expect(
      collect(api.resolveCategoriesStream('conn_1', { items: [] })),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
