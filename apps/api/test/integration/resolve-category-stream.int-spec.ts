/**
 * Category Resolve-Stream NDJSON Route Integration Test (#2209, epic #2205)
 *
 * Drives `POST /v1/listings/connections/:connectionId/categories/resolve-stream`
 * through the REAL Nest HTTP stack - URI versioning, `express.json()`, the
 * global `ValidationPipe({ whitelist, forbidNonWhitelisted })`, the global
 * connection-exception filter, and a real `res.write()` / `res.end()` onto a
 * real socket.
 *
 * The controller unit spec covers the handler's own event bookkeeping against a
 * hand-built `EventEmitter` response double, which structurally cannot observe
 * any of the above. Three of those seams are load-bearing and only provable
 * here:
 *
 *  1. `express.json()` consumes the request body before the handler runs, which
 *     makes `IncomingMessage` emit 'close' immediately (Node >= 16). A change
 *     that moved the disconnect listener back onto the request would abort the
 *     resolver on every healthy call and leave a body of one lone terminal line
 *     with zero results - indistinguishable from a working route to a fake `res`.
 *  2. The `RESOLVE_CATEGORY_ITEMS_MAX` cap is enforced by the pipe, not by the
 *     handler. The SPA chunks its requests at exactly that number
 *     (`RESOLVE_CATEGORY_STREAM_CHUNK_SIZE`), so "a full chunk is accepted and
 *     one more is refused" is the compatibility guard between the two.
 *  3. The connection gate runs before the first byte, so an unknown or disabled
 *     connection is answered with a real status rather than a 200 whose body
 *     carries the error.
 *
 * The marketplace side is a boot-registered stub `OfferManagerPort +
 * EanCategoryMatcherStreaming` adapter, wired through the same
 * `AdapterRegistryService` + `AdapterFactoryResolverService` seams as
 * `helpers/allegro-test-offer-manager-stub.helper.ts`, so every assertion here
 * is about the HTTP transport and never about Allegro's catalogue.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  type AdapterFactoryResolverService,
  type AdapterRegistryPort,
} from '@openlinker/core/integrations';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import type {
  BatchCategoryByEanInput,
  EanCategoryMatcherStreaming,
  EanCategoryMatchStreamItem,
  EanCategoryMatchStreamOptions,
  EanMatchResult,
  OfferManagerPort,
  UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { RESOLVE_CATEGORY_ITEMS_MAX } from '../../src/listings/http/dto/resolve-category-batch.dto';
import { RESOLVE_CATEGORY_STREAM_CONTENT_TYPE } from '../../src/listings/http/dto/resolve-category-stream.dto';

const STREAM_STUB_ADAPTER_KEY = 'allegro.test.resolve-stream.v1';
const STREAM_STUB_PLATFORM_TYPE = 'allegro';

/** Well-formed UUID that was never persisted, so the gate must 404 on it. */
const UNKNOWN_CONNECTION_ID = '00000000-0000-4000-8000-0000000002ff';

/**
 * One decoded NDJSON line, typed as loosely as the wire justifies: the parser
 * deliberately does not trust the shape, because "the body is well-framed" is
 * one of the things under test.
 */
interface StreamLine {
  kind?: string;
  variantId?: string;
  result?: EanMatchResult;
  resolvedCount?: number;
  unresolvedCount?: number;
  completion?: string;
  catalogueLookupPerformed?: boolean;
}

/**
 * Verdict for one EAN. A pure function of the input, so no expectation below
 * depends on scripted state a reordered test could leave behind.
 */
function resultForEan(ean: string | null): EanMatchResult {
  if (ean === null || ean.trim() === '') {
    return { kind: 'no-ean' };
  }
  return { kind: 'matched', allegroCategoryId: `cat-${ean}`, productCardId: `card-${ean}` };
}

function installResolveStreamStub(harness: IntegrationTestHarness): void {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const stub: OfferManagerPort & EanCategoryMatcherStreaming = {
    updateOfferQuantity(_cmd: UpdateOfferQuantityCommand): Promise<void> {
      return Promise.resolve();
    },
    streamCategoriesForBatchByEan(
      input: BatchCategoryByEanInput,
      _options?: EanCategoryMatchStreamOptions
    ): AsyncIterable<EanCategoryMatchStreamItem> {
      async function* iterate(): AsyncGenerator<EanCategoryMatchStreamItem> {
        for (const item of input.items) {
          // Yield across a real microtask boundary so the handler writes each
          // line in its own tick, the way a marketplace-backed adapter does -
          // a synchronous generator would let Node coalesce the whole body into
          // one write and hide a per-line framing bug.
          await Promise.resolve();
          yield { variantId: item.variantId, result: resultForEan(item.ean) };
        }
      }
      return iterate();
    },
  };

  adapterRegistry.register({
    adapterKey: STREAM_STUB_ADAPTER_KEY,
    platformType: STREAM_STUB_PLATFORM_TYPE,
    // The two matcher capabilities are advertised-without-dispatch (resolved by
    // narrowing the dispatched `OfferManager` adapter with its guard), mirroring
    // the real Allegro manifest.
    supportedCapabilities: ['OfferManager', 'EanCategoryMatcher', 'EanCategoryMatcherStreaming'],
    displayName: 'Allegro streaming EAN matcher (integration-test stub)',
    version: '0.0.0-test',
    // Explicit false so the real `allegro.publicapi.v1` stays the platform default.
    isDefault: false,
  });

  factoryResolver.registerFactory(STREAM_STUB_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(stub as unknown as T),
  });
}

async function seedStreamConnection(
  dataSource: DataSource,
  overrides: { status?: 'active' | 'disabled' } = {}
): Promise<string> {
  const repo = dataSource.getRepository(ConnectionOrmEntity);
  const saved = await repo.save(
    repo.create({
      platformType: STREAM_STUB_PLATFORM_TYPE,
      name: 'Resolve-stream stub connection',
      status: overrides.status ?? 'active',
      config: {},
      credentialsRef: 'db:resolve-stream-stub',
      adapterKey: STREAM_STUB_ADAPTER_KEY,
      enabledCapabilities: ['OfferManager'],
    })
  );
  return saved.id;
}

/**
 * The subset of a supertest response this spec reads. Declared structurally so
 * the helpers below do not depend on how `supertest`'s `export =` types surface
 * their `Response` alias.
 */
interface RawHttpResponse {
  readonly text?: string;
  readonly body: unknown;
}

/**
 * Superagent ships no parser for `application/x-ndjson`, so it buffers the body
 * into `res.body` as a Buffer and leaves `res.text` undefined - while an error
 * response on the same route arrives as parsed JSON with `res.text` set. Read
 * whichever the response actually carries instead of assuming one.
 */
function rawBody(response: RawHttpResponse): string {
  if (typeof response.text === 'string') {
    return response.text;
  }
  if (Buffer.isBuffer(response.body)) {
    return response.body.toString('utf8');
  }
  throw new Error(`Unexpected NDJSON response body shape: ${typeof response.body}`);
}

/**
 * Decode the raw body. Hand-rolled rather than reusing the SPA decoder: the
 * framing itself (one complete JSON value per line, no enclosing array,
 * newline-terminated) is part of what this spec asserts, so a lenient decoder
 * that silently drops a malformed or truncated line would hide the defect.
 */
function parseNdjson(response: RawHttpResponse): StreamLine[] {
  const segments = rawBody(response).split('\n');
  // Every line is newline-terminated, so the final split segment is empty.
  // Anything else means the last line was truncated mid-write.
  const tail = segments[segments.length - 1];
  if (tail !== '') {
    throw new Error(`NDJSON body is not newline-terminated; trailing partial line: ${tail}`);
  }
  return segments.slice(0, -1).map((line) => JSON.parse(line) as StreamLine);
}

function linesOfKind(lines: StreamLine[], kind: string): StreamLine[] {
  return lines.filter((line) => line.kind === kind);
}

function itemsFor(count: number): Array<{ variantId: string; ean: string }> {
  return Array.from({ length: count }, (_unused, index) => ({
    variantId: `ol_variant_${index}`,
    ean: `590000000${String(index).padStart(4, '0')}`,
  }));
}

describe('Category resolve-stream NDJSON route (#2209)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    // Suite-scoped: `AdapterRegistryService.register` throws on a duplicate key,
    // and the stub is meant to live for the lifetime of this Nest process.
    installResolveStreamStub(harness);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('healthy request', () => {
    it('should return NDJSON with one result line per item and a single trailing done terminal when the connection resolves', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource);

      const items = itemsFor(3);

      const response = await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items })
        .expect(200);

      expect(response.headers['content-type']).toContain(RESOLVE_CATEGORY_STREAM_CONTENT_TYPE);

      const lines = parseNdjson(response);

      // One `result` per input item - the assertion the fake `res` could not
      // make. Had `express.json()`'s body consumption aborted the resolver, this
      // body would be a lone terminal line.
      const results = linesOfKind(lines, 'result');
      expect(results).toHaveLength(items.length);
      expect(results.map((line) => line.variantId)).toEqual(items.map((item) => item.variantId));

      // Exactly one terminal, and it is last.
      expect(linesOfKind(lines, 'done')).toHaveLength(1);
      expect(lines[lines.length - 1]).toEqual({
        kind: 'done',
        resolvedCount: items.length,
        unresolvedCount: 0,
        completion: 'complete',
        catalogueLookupPerformed: true,
      });
    });

    it('should accept the request body the frontend sends when items carry variantId, ean and sourceCategoryIds', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource);

      // The exact shape of `ResolveCategoriesBatchRequest` in
      // `apps/web/src/features/listings/api/listings.types.ts`: `ean` nullable,
      // `sourceCategoryIds` optional per item. Under `forbidNonWhitelisted` any
      // field the DTO does not declare is a 400, so this is the pipe-level
      // compatibility check between the SPA and the route.
      const response = await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { variantId: 'ol_variant_a', ean: '5900000000001' },
            { variantId: 'ol_variant_b', ean: null, sourceCategoryIds: ['12', '7'] },
            { variantId: 'ol_variant_c', ean: '5900000000002', sourceCategoryIds: [] },
          ],
        })
        .expect(200);

      const lines = parseNdjson(response);
      expect(linesOfKind(lines, 'result')).toHaveLength(3);
      // No category mapping is seeded, so the EAN-less item stays unresolved -
      // which is what proves `sourceCategoryIds` was carried into the mapping
      // fallback rather than rejected by the pipe.
      expect(lines[lines.length - 1]).toMatchObject({
        kind: 'done',
        resolvedCount: 2,
        unresolvedCount: 1,
        completion: 'complete',
      });
    });
  });

  describe('items cap - the boundary the SPA chunks against', () => {
    it('should accept exactly RESOLVE_CATEGORY_ITEMS_MAX items when the caller submits a full chunk', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource);

      const response = await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: itemsFor(RESOLVE_CATEGORY_ITEMS_MAX) })
        .expect(200);

      const lines = parseNdjson(response);
      expect(linesOfKind(lines, 'result')).toHaveLength(RESOLVE_CATEGORY_ITEMS_MAX);
      expect(lines[lines.length - 1]).toMatchObject({
        kind: 'done',
        resolvedCount: RESOLVE_CATEGORY_ITEMS_MAX,
        completion: 'complete',
      });
    });

    it('should reject the request with 400 before the handler runs when items exceed RESOLVE_CATEGORY_ITEMS_MAX', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource);

      const response = await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: itemsFor(RESOLVE_CATEGORY_ITEMS_MAX + 1) })
        .expect(400);

      // A JSON error body rather than NDJSON is what proves the pipe answered
      // and the streaming handler never committed the 200.
      expect(response.headers['content-type']).toContain('application/json');
      expect(JSON.stringify(response.body)).toContain(
        `at most ${RESOLVE_CATEGORY_ITEMS_MAX} entries`
      );
    });

    it('should reject the request with 400 when items is empty', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource);

      await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [] })
        .expect(400);
    });
  });

  describe('connection gate runs before the first byte', () => {
    it('should answer 404 with a JSON error body when the connection id is unknown', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .post(`/v1/listings/connections/${UNKNOWN_CONNECTION_ID}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ variantId: 'ol_variant_a', ean: '5900000000001' }] })
        .expect(404);

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toMatchObject({ statusCode: 404 });
      // No stream line of any kind reached the wire.
      expect(response.text).not.toContain('"kind"');
    });

    it('should answer 409 when the connection exists but is disabled', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource, { status: 'disabled' });

      const response = await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ variantId: 'ol_variant_a', ean: '5900000000001' }] })
        .expect(409);

      expect(response.body).toMatchObject({ statusCode: 409 });
    });
  });

  describe('routing and auth', () => {
    it('should serve the route under the /v1 prefix only', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connectionId = await seedStreamConnection(dataSource);
      const path = `/listings/connections/${connectionId}/categories/resolve-stream`;
      const body = { items: [{ variantId: 'ol_variant_a', ean: '5900000000001' }] };

      // Same request, same body - reachable with the prefix, absent without it.
      await http
        .post(`/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);

      await http.post(path).set('Authorization', `Bearer ${token}`).send(body).expect(404);
    });

    it('should answer 401 when no bearer token is supplied', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const connectionId = await seedStreamConnection(dataSource);

      await http
        .post(`/v1/listings/connections/${connectionId}/categories/resolve-stream`)
        .send({ items: [{ variantId: 'ol_variant_a', ean: '5900000000001' }] })
        .expect(401);
    });
  });
});
