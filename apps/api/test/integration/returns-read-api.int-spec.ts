/**
 * Returns Read API Integration Test (#2334)
 *
 * Drives `GET /returns`, `GET /returns/:returnId` and
 * `GET /returns/ingestion-availability` over HTTP against real Postgres
 * (Testcontainers), with rows seeded through `IReturnsService` rather than raw
 * SQL — so what is asserted is what the production ingestion path actually
 * writes.
 *
 * These properties earn integration coverage specifically because a unit spec
 * cannot reach them:
 *
 *  - the filter predicates and the `createdAt DESC` ordering are SQL, and the
 *    repository's unit spec drives a chainable builder mock that would accept
 *    a wrong column name silently;
 *  - `countReturnsByBucket`'s single `FILTER (WHERE ...)` aggregate returns pg
 *    `bigint`s as STRINGS, so the `total - orphan` subtraction is a string
 *    concatenation unless both are coerced — a plausible, badly wrong number
 *    that throws nothing and only a real database produces;
 *  - `rawStatus` round-tripping byte-identically is a claim about a column, and
 *    the whole point of the field is that nothing between the source and the
 *    screen touches it;
 *  - the route-ordering hazard (`ingestion-availability` vs `:returnId`) is a
 *    property of the booted Nest router, not of the controller class;
 *  - the 404 comes from a GLOBAL filter registered in `configureApp`, so a
 *    controller-level test cannot prove the status code an operator sees.
 *
 * @module apps/api/test/integration
 */
import request from 'supertest';
import {
  RETURNS_SERVICE_TOKEN,
  type IReturnsService,
  type IncomingReturn,
} from '@openlinker/core/returns';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { createTestConnection } from './helpers/test-connection.helper';
import { loginAsAdmin } from './helpers/test-auth.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Returns Read API Integration', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  let connectionA: string;
  let connectionB: string;

  const service = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const http = (): ReturnType<typeof request> => harness.getHttp();

  const observation = (overrides: Partial<IncomingReturn> = {}): IncomingReturn => ({
    externalReturnId: 'RET-1',
    externalOrderId: null,
    rawStatus: 'WAITING_FOR_PARCEL',
    createdAt: '2026-08-01T10:00:00.000Z',
    lines: [{ quantity: 2, reasonRaw: 'withdrawal' }],
    ...overrides,
  });

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    // `loginAsAdmin` plain-INSERTs a fixed username, so it is called exactly
    // ONCE per test — a second call in the same test violates the users unique
    // constraint.
    token = await loginAsAdmin(http(), harness.getDataSource());
    connectionA = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
    connectionB = (await createTestConnection(harness.getDataSource(), { name: 'Source B' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  const get = (path: string): request.Test =>
    http().get(path).set('Authorization', `Bearer ${token}`);

  /**
   * Seed one return through the production ingestion path, then pin its
   * `createdAt`.
   *
   * `createdAt` is a `@CreateDateColumn`, so ingestion stamps "now" and rows
   * written in one test tick share a timestamp — which makes any ordering or
   * date-range assertion over them vacuous. One targeted UPDATE afterwards is
   * the smallest way to give them distinguishable positions; everything else
   * about the row is what `upsertFromObservation` really wrote.
   */
  const seedAt = async (
    connectionId: string,
    externalReturnId: string,
    createdAt: string,
    externalOrderId: string | null = null
  ): Promise<string> => {
    const { record } = await service().upsertFromObservation(
      connectionId,
      observation({ externalReturnId, externalOrderId })
    );

    await harness
      .getDataSource()
      .query('UPDATE returns SET "createdAt" = $1 WHERE id = $2', [createdAt, record.id]);

    return record.id;
  };

  const seedOrphan = (
    connectionId: string,
    externalReturnId: string,
    createdAt: string
  ): Promise<string> => seedAt(connectionId, externalReturnId, createdAt);

  /**
   * Seed a return OpenLinker CAN attribute.
   *
   * Attribution is a LOOKUP, never a mint (`ReturnsService.resolveInternalOrderId`),
   * so the order's identifier mapping has to exist BEFORE the observation is
   * ingested — registering it afterwards leaves the row an orphan forever, since
   * ingestion never re-resolves.
   */
  const seedAttributed = async (
    connectionId: string,
    externalReturnId: string,
    externalOrderId: string,
    createdAt: string
  ): Promise<string> => {
    await harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, { strict: false })
      .getOrCreateInternalId(CORE_ENTITY_TYPE.Order, externalOrderId, connectionId);

    return seedAt(connectionId, externalReturnId, createdAt, externalOrderId);
  };

  describe('GET /returns', () => {
    it('should require authentication', async () => {
      await http().get('/v1/returns').expect(401);
    });

    it('should page, order newest first, and count the buckets', async () => {
      // Three orphans (no externalOrderId resolves to no order): two on A, one
      // on B. Seeded with DISTINCT createdAt values, spread apart, because rows
      // written in one test tick share a timestamp and an ordering assertion
      // over them would pass under `ASC` too.
      await seedOrphan(connectionA, 'R1', '2026-08-01T10:00:00.000Z');
      await seedOrphan(connectionA, 'R2', '2026-08-02T10:00:00.000Z');
      await seedOrphan(connectionB, 'R3', '2026-08-03T10:00:00.000Z');

      const response = await get('/v1/returns?limit=2&offset=0').expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.total).toBe(3);
      expect(response.body.limit).toBe(2);
      expect(response.body.offset).toBe(0);
      expect(response.body.counts).toEqual({ total: 3, orphan: 3, attributed: 0 });
      expect(typeof response.body.counts.total).toBe('number');

      const page2 = await get('/v1/returns?limit=2&offset=2').expect(200);
      expect(page2.body.items).toHaveLength(1);

      // Newest first, ACROSS the page boundary — an `ASC` order or a sort on the
      // wrong column both fail here, and neither would fail a length assertion.
      const createdAts: string[] = [...response.body.items, ...page2.body.items].map(
        (item: { createdAt: string }) => item.createdAt
      );
      expect(createdAts).toEqual([...createdAts].sort().reverse());

      // No row appears on both pages.
      const ids = [...response.body.items, ...page2.body.items].map(
        (item: { id: string }) => item.id
      );
      expect(new Set(ids).size).toBe(3);
    });

    it('should partition an attributed row from an orphan across every count and page', async () => {
      // THE case the rest of this file does not reach. With `orphan === total`
      // the `total - orphan` subtraction is 0 whether the pg `bigint`s were
      // coerced to numbers or left as strings (JS `-` coerces), so the
      // stringly-typed hazard is only observable once the two differ — and the
      // `IS NOT NULL` arm of `buildListQuery` is only exercised once a row
      // satisfies it.
      await seedOrphan(connectionA, 'R-ORPHAN', '2026-08-01T10:00:00.000Z');
      await seedAttributed(connectionA, 'R-ATTRIBUTED', 'ORD-9', '2026-08-02T10:00:00.000Z');

      const all = await get('/v1/returns').expect(200);
      expect(all.body.counts).toEqual({ total: 2, orphan: 1, attributed: 1 });
      expect(all.body.total).toBe(2);
      // Real numbers, not concatenated strings: `2 - 1` and `"2" - "1"` agree,
      // but a `total` of `"2"` would fail this.
      expect(typeof all.body.counts.attributed).toBe('number');
      expect(all.body.counts.attributed).toBe(1);

      const orphans = await get('/v1/returns?bucket=orphan').expect(200);
      expect(orphans.body.items).toHaveLength(1);
      expect(orphans.body.items[0].externalReturnId).toBe('R-ORPHAN');
      expect(orphans.body.items[0].bucket).toBe('orphan');
      expect(orphans.body.items[0].internalOrderId).toBeNull();
      expect(orphans.body.total).toBe(1);

      const attributed = await get('/v1/returns?bucket=attributed').expect(200);
      expect(attributed.body.items).toHaveLength(1);
      expect(attributed.body.items[0].externalReturnId).toBe('R-ATTRIBUTED');
      expect(attributed.body.items[0].bucket).toBe('attributed');
      expect(attributed.body.items[0].internalOrderId).not.toBeNull();
      expect(attributed.body.total).toBe(1);

      // Both bucket pages carry the SAME bucket-less counts — the chip row means
      // one scope whichever chip is selected.
      expect(orphans.body.counts).toEqual(all.body.counts);
      expect(attributed.body.counts).toEqual(all.body.counts);
    });

    it('should filter by source connection', async () => {
      await service().upsertFromObservation(connectionA, observation({ externalReturnId: 'R1' }));
      await service().upsertFromObservation(connectionB, observation({ externalReturnId: 'R2' }));

      const response = await get(`/v1/returns?sourceConnectionId=${connectionA}`).expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].sourceConnectionId).toBe(connectionA);
      expect(response.body.total).toBe(1);
      // The counts are scoped by the connection filter too — only `bucket` is
      // stripped.
      expect(response.body.counts.total).toBe(1);
    });

    it('should filter by bucket while leaving the counts bucket-less', async () => {
      await service().upsertFromObservation(connectionA, observation({ externalReturnId: 'R1' }));

      const orphans = await get('/v1/returns?bucket=orphan').expect(200);
      expect(orphans.body.items).toHaveLength(1);
      expect(orphans.body.items[0].bucket).toBe('orphan');
      expect(orphans.body.total).toBe(1);

      const attributed = await get('/v1/returns?bucket=attributed').expect(200);
      expect(attributed.body.items).toHaveLength(0);
      expect(attributed.body.total).toBe(0);

      // THE point of the bucket-less rule: whichever chip is selected, both
      // numbers describe the same scope, so the unselected chip stays truthful.
      expect(orphans.body.counts).toEqual(attributed.body.counts);
      expect(orphans.body.counts).toEqual({ total: 1, orphan: 1, attributed: 0 });
    });

    it('should apply BOTH date bounds, inclusively', async () => {
      const at = '2026-08-02T10:00:00.000Z';
      await seedOrphan(connectionA, 'R1', at);

      // Inclusive on each side: the row's own instant must MATCH both bounds.
      // A `>` / `<` implementation passes every other assertion in this file
      // and fails exactly here.
      const fromExact = await get(`/v1/returns?createdFrom=${at}`).expect(200);
      expect(fromExact.body.items).toHaveLength(1);

      const toExact = await get(`/v1/returns?createdTo=${at}`).expect(200);
      expect(toExact.body.items).toHaveLength(1);

      // One millisecond outside each bound excludes it. The `createdTo` case is
      // the one a dropped `<=` arm would otherwise pass silently: with no upper
      // bound applied at all, this would return the row.
      const fromAfter = await get('/v1/returns?createdFrom=2026-08-02T10:00:00.001Z').expect(200);
      expect(fromAfter.body.items).toHaveLength(0);
      expect(fromAfter.body.total).toBe(0);

      const toBefore = await get('/v1/returns?createdTo=2026-08-02T09:59:59.999Z').expect(200);
      expect(toBefore.body.items).toHaveLength(0);
      expect(toBefore.body.total).toBe(0);

      // And both together bracket the row.
      const bracketed = await get(
        `/v1/returns?createdFrom=2026-08-01T00:00:00.000Z&createdTo=2026-08-03T00:00:00.000Z`
      ).expect(200);
      expect(bracketed.body.items).toHaveLength(1);
    });

    it('should reject an unknown bucket rather than silently returning everything', async () => {
      // A filter that falls back shows the operator a list they did not ask for.
      await get('/v1/returns?bucket=nonsense').expect(400);
    });

    it('should never expose rawPayload, which carries buyer PII', async () => {
      await service().upsertFromObservation(
        connectionA,
        observation({ externalReturnId: 'R1', buyerEmail: 'buyer@example.com' })
      );

      const response = await get('/v1/returns').expect(200);

      expect(response.body.items[0]).not.toHaveProperty('rawPayload');
      expect(JSON.stringify(response.body)).not.toContain('buyer@example.com');
    });
  });

  describe('GET /returns/:returnId', () => {
    it('should return 404 for an unknown id, via the global filter', async () => {
      const response = await get('/v1/returns/ol_return_missing').expect(404);

      expect(response.body.error).toBe('ReturnNotFoundError');
    });

    it('should hydrate the lines and round-trip rawStatus byte-identically', async () => {
      const raw = 'WAITING_FOR_PARCEL';
      const { record } = await service().upsertFromObservation(
        connectionA,
        observation({
          externalReturnId: 'R1',
          rawStatus: raw,
          lines: [
            { quantity: 2, reasonRaw: 'withdrawal', sku: 'SKU-1' },
            { quantity: 1, reasonRaw: 'damaged', sku: 'SKU-2' },
          ],
        })
      );

      const response = await get(`/v1/returns/${record.id}`).expect(200);

      // Verbatim: the source's own word, never re-labelled.
      expect(response.body.rawStatus).toBe(raw);
      expect(response.body.bucket).toBe('orphan');
      expect(response.body.lines).toHaveLength(2);
      // Ordered by lineIndex.
      expect(response.body.lines.map((line: { lineIndex: number }) => line.lineIndex)).toEqual([
        0, 1,
      ]);
      // An unmatched line is an explicit null, not a blank.
      expect(response.body.lines[0].resolvedOrderLineId).toBeNull();
      expect(response.body).not.toHaveProperty('rawPayload');
      expect(response.body.declineAvailability).toHaveProperty('supported');
    });

    it('should render an unreported rawStatus as null, not as an empty string', async () => {
      const { record } = await service().upsertFromObservation(
        connectionA,
        observation({ externalReturnId: 'R1', rawStatus: undefined })
      );

      const response = await get(`/v1/returns/${record.id}`).expect(200);

      // "The source reported nothing" must not render as "" or as a default.
      expect(response.body.rawStatus).toBeNull();
    });
  });

  describe('GET /returns/ingestion-availability', () => {
    it('should answer its own route rather than being matched as a return id', async () => {
      // The literal path is declared before `:returnId`; a reorder makes this
      // 404 with `ReturnNotFoundError`.
      const response = await get('/v1/returns/ingestion-availability').expect(200);

      expect(response.body).toEqual({
        configured: expect.any(Boolean),
        connectionIds: expect.any(Array),
      });
    });

    it('should require authentication', async () => {
      await http().get('/v1/returns/ingestion-availability').expect(401);
    });
  });
});
