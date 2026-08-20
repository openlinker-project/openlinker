/**
 * Listings API - resolve-category stream tests (#2211)
 *
 * The NDJSON reader is the one piece of non-trivial transport logic the streamed
 * Resolve step adds: lines are not aligned to chunk boundaries, the transport
 * injects keep-alive filler that carries no outcome, and a non-2xx must still
 * raise `ApiError` so the route's 404 / 409 / 422 gate keeps working.
 *
 * The request the stream method PUTS on the wire is pinned here too: the route
 * only answers NDJSON, so `Accept: application/x-ndjson` is part of the
 * contract, and the client's `buildHeaders` default must neither overwrite it
 * nor stop defaulting `application/json` for every ordinary request.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { createApiClient } from '../../../app/api/api-client';
import type { SessionAdapter } from '../../../shared/auth/session-adapter';
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

  it('drops a result line missing the fields the consumer reads', () => {
    // Each of these carries the right `kind` and would have been cast through
    // on the strength of that alone. The `variantId` case is the costly one: it
    // keys an outcome under `"undefined"` in the reducer, so one row never
    // clears and nothing in the UI can say why.
    const drop = (line: string): void => {
      expect(parseResolveCategoryStreamLine(line)).toBeNull();
    };
    drop('{"kind":"result","result":{"kind":"no-match"}}');
    drop('{"kind":"result","variantId":7,"result":{"kind":"no-match"}}');
    drop('{"kind":"result","variantId":"","result":{"kind":"no-match"}}');
    drop('{"kind":"result","variantId":"v1"}');
    // `result.kind` is what the step switches on, so a result without one is a
    // render crash rather than a row.
    drop('{"kind":"result","variantId":"v1","result":{}}');
  });

  it('drops a terminal line that cannot state its counts, and keeps an unknown completion', () => {
    const drop = (line: string): void => {
      expect(parseResolveCategoryStreamLine(line)).toBeNull();
    };
    drop('{"kind":"done","unresolvedCount":1,"completion":"complete"}');
    drop('{"kind":"done","resolvedCount":"0","unresolvedCount":1,"completion":"complete"}');

    // `completion` is deliberately NOT validated: a value a later API version
    // adds must reach the consumer's "not complete" arm, which reports an
    // incomplete run, instead of vanishing here and reading as a truncated body.
    const forwardCompatible =
      '{"kind":"done","resolvedCount":1,"unresolvedCount":0,' +
      '"completion":"partially-degraded","catalogueLookupPerformed":true}';
    expect(parseResolveCategoryStreamLine(forwardCompatible)).toEqual({
      kind: 'done',
      resolvedCount: 1,
      unresolvedCount: 0,
      completion: 'partially-degraded',
      catalogueLookupPerformed: true,
    });
  });
});

type StreamRequestFn = (path: string, init?: RequestInit) => Promise<ReadableStream<Uint8Array>>;

/** Typed stub of the streaming transport, so `mock.calls` needs no cast. */
function streamRequestMock(stream: ReadableStream<Uint8Array>): Mock<StreamRequestFn> {
  return vi.fn<StreamRequestFn>().mockResolvedValue(stream);
}

describe('resolveCategoriesStream request', () => {
  const body = {
    items: [
      { variantId: 'v1', ean: '5901234123457' },
      { variantId: 'v2', ean: null },
    ],
  };

  it('posts the batch to the resolve-stream route asking for NDJSON', async () => {
    const requestStream = streamRequestMock(streamOf([`${DONE_LINE}\n`]));
    const api = createListingsApi(vi.fn(), requestStream);

    await collect(api.resolveCategoriesStream('conn_1', body));

    const [path, init = {}] = requestStream.mock.calls[0];
    expect(path).toBe('/listings/connections/conn_1/categories/resolve-stream');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    // The route ONLY answers NDJSON; the client's `Accept: application/json`
    // default must not be what goes out here.
    expect(headers.get('Accept')).toBe('application/x-ndjson');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('forwards the caller AbortSignal so an unmount can cancel the open body', async () => {
    // The streamed transport arms no wall clock, so this signal is the ONLY way
    // a caller can end a run it no longer wants; dropping it would leave the
    // marketplace resolving rows nobody will read.
    const controller = new AbortController();
    const requestStream = streamRequestMock(streamOf([`${DONE_LINE}\n`]));
    const api = createListingsApi(vi.fn(), requestStream);

    await collect(api.resolveCategoriesStream('conn_1', body, { signal: controller.signal }));

    const [, init = {}] = requestStream.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });

  it('omits signal entirely when the caller passes none', async () => {
    // Absent rather than `undefined`: the transport composes `init.signal` with
    // its own head-timeout signal, so an explicitly present key is a shape the
    // conditional spread exists to avoid.
    const requestStream = streamRequestMock(streamOf([`${DONE_LINE}\n`]));
    const api = createListingsApi(vi.fn(), requestStream);

    await collect(api.resolveCategoriesStream('conn_1', body));

    const [, init = {}] = requestStream.mock.calls[0];
    expect('signal' in init).toBe(false);
  });
});

describe('Accept header on the wire', () => {
  const BASE_URL = 'http://localhost:3000';

  function sessionAdapter(): SessionAdapter {
    return {
      getAccessToken: vi.fn().mockResolvedValue(null),
      getSession: vi.fn(),
      persistSession: vi.fn(),
      clearSession: vi.fn(),
    };
  }

  /**
   * The client's own transport option type. Spelled through
   * `createApiClient` rather than as `typeof fetch`, because `features/` is
   * barred from naming the raw global at all (`no-restricted-globals`) - a rule
   * about calling it that a type reference trips just the same.
   */
  type ClientFetch = NonNullable<Parameters<typeof createApiClient>[0]['fetchFn']>;

  function jsonResponse(payload: unknown): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as Response;
  }

  function ndjsonResponse(chunks: readonly string[]): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: streamOf(chunks),
    } as unknown as Response;
  }

  it('keeps the application/json default on an ordinary non-stream listings request', async () => {
    // The regression `buildHeaders` could silently cause: teaching the client to
    // respect a caller-set Accept must not stop it defaulting for everyone else.
    const fetchFn = vi.fn<ClientFetch>().mockResolvedValue(jsonResponse({ id: 'map_1' }));
    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn,
      sessionAdapter: sessionAdapter(),
    });

    await client.listings.getById('map_1');

    const [, init = {}] = fetchFn.mock.calls[0];
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
  });

  it('leaves the stream request asking for NDJSON through the real client', async () => {
    const fetchFn = vi
      .fn<ClientFetch>()
      .mockResolvedValue(ndjsonResponse([`${RESULT_LINE}\n${DONE_LINE}\n`]));
    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn,
      sessionAdapter: sessionAdapter(),
    });

    const events = await collect(
      client.listings.resolveCategoriesStream('conn_1', {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      }),
    );

    expect(events).toHaveLength(2);
    const [, init = {}] = fetchFn.mock.calls[0];
    expect(new Headers(init.headers).get('Accept')).toBe('application/x-ndjson');
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
      expect((error as ApiError).message).toMatch(/No response from the category lookup/i);
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
