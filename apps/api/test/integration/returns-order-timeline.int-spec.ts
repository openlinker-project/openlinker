/**
 * Order Return-Timeline Read Integration Test (#2383)
 *
 * Drives `GET /returns/events?internalOrderId=…` over HTTP against real
 * Postgres (Testcontainers).
 *
 * This read earns integration coverage specifically because a unit spec cannot
 * reach any of the four properties that make it correct:
 *
 *  - it is ONE query joining `return_line_events` to `returns` through
 *    `internalOrderId`, and the repository's unit spec drives a chainable
 *    builder mock that would accept a wrong column name silently;
 *  - the header columns (`openedAt` / `declinedAt`) are read from the SAME
 *    joined rows the acts come from, so the "one `opened` per return, not one
 *    per act" de-duplication is a property of real join fan-out — a mock
 *    returning one row per return could never exhibit the bug;
 *  - the route-ordering hazard (`events` vs `:returnId`) is a property of the
 *    booted Nest router, not of the controller class;
 *  - the refund entry is composed in the INTERFACE layer from a different
 *    bounded context's service, so only a booted app proves the two halves
 *    arrive in one ordered list.
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

interface TimelineEntryBody {
  id: string;
  source: string;
  kind: string;
  occurredAt: string;
  returnId: string;
  sourceConnectionName: string | null;
  returnOrigin: string;
  actorUserId: string | null;
}

describe('Order Return-Timeline Read Integration', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  let connectionId: string;

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
    // Called exactly ONCE per test — `loginAsAdmin` plain-INSERTs a fixed
    // username and a second call violates the users unique constraint.
    token = await loginAsAdmin(http(), harness.getDataSource());
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  const get = (internalOrderId: string): request.Test =>
    http()
      .get(`/v1/returns/events?internalOrderId=${encodeURIComponent(internalOrderId)}`)
      .set('Authorization', `Bearer ${token}`);

  /**
   * Seed an ATTRIBUTED return. Attribution is a lookup, never a mint, so the
   * order's identifier mapping must exist before the observation is ingested.
   */
  const seedAttributed = async (
    externalReturnId: string,
    externalOrderId: string
  ): Promise<{ returnId: string; internalOrderId: string }> => {
    const internalOrderId = await harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, { strict: false })
      .getOrCreateInternalId(CORE_ENTITY_TYPE.Order, externalOrderId, connectionId);

    const { record } = await service().upsertFromObservation(
      connectionId,
      observation({ externalReturnId, externalOrderId })
    );

    return { returnId: record.id, internalOrderId };
  };

  const setOpenedAt = (returnId: string, at: string): Promise<unknown> =>
    harness
      .getDataSource()
      .query('UPDATE returns SET "openedAt" = $1 WHERE id = $2', [at, returnId]);

  /** One custody act, written directly — this read is about SHAPE, not writes. */
  const seedAct = async (
    returnId: string,
    kind: string,
    occurredAt: string,
    seq: number
  ): Promise<void> => {
    const [line] = await harness
      .getDataSource()
      .query('SELECT id FROM return_lines WHERE "returnId" = $1 LIMIT 1', [returnId]);

    await harness
      .getDataSource()
      .query(
        `INSERT INTO return_line_events
           ("returnId", "returnLineId", seq, kind, quantity, "restockState", "occurredAt")
         VALUES ($1, $2, $3, $4, 1, 'not_applicable', $5)`,
        [returnId, line.id, seq, kind, occurredAt]
      );
  };

  it('returns an empty list for an order with no returns', async () => {
    const response = await get('ol_order_nothing').expect(200);

    expect(response.body.entries).toEqual([]);
  });

  it('is not swallowed by the :returnId route', async () => {
    // A literal segment declared after a parameter would be unreachable, and
    // this is a property of the booted router rather than of the class.
    const response = await get('ol_order_nothing').expect(200);

    expect(response.body).toHaveProperty('entries');
  });

  it('returns acts from TWO returns on one order together, oldest first', async () => {
    const first = await seedAttributed('RET-1', 'EXT-1');
    const { record } = await service().upsertFromObservation(
      connectionId,
      observation({ externalReturnId: 'RET-2', externalOrderId: 'EXT-1' })
    );

    await seedAct(first.returnId, 'receive', '2026-08-05T10:00:00.000Z', 1);
    await seedAct(record.id, 'dispose', '2026-08-04T10:00:00.000Z', 1);

    const response = await get(first.internalOrderId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    // Both returns contribute their own `opened` — ingestion really stamps
    // `openedAt` from the observation, which is the point of reading the header
    // columns at all. The two share a timestamp, so only the CUSTODY ordering
    // is asserted; asserting a tie's order would be asserting insertion luck.
    expect(entries.filter((entry) => entry.kind === 'opened')).toHaveLength(2);
    expect(
      entries.filter((entry) => entry.source === 'custody_act').map((entry) => entry.kind)
    ).toEqual(['dispose', 'receive']);
    expect(new Set(entries.map((entry) => entry.returnId)).size).toBe(2);
  });

  it("excludes another order's acts", async () => {
    const mine = await seedAttributed('RET-1', 'EXT-1');
    const theirs = await seedAttributed('RET-2', 'EXT-2');

    await seedAct(mine.returnId, 'receive', '2026-08-05T10:00:00.000Z', 1);
    await seedAct(theirs.returnId, 'receive', '2026-08-05T11:00:00.000Z', 1);

    const response = await get(mine.internalOrderId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    // Every entry — the header fact as well as the act — belongs to MY return.
    expect(entries.map((entry) => entry.returnId)).toEqual([mine.returnId, mine.returnId]);
    expect(entries.some((entry) => entry.returnId === theirs.returnId)).toBe(false);
  });

  it('contributes the opened header fact alongside the custody acts', async () => {
    const seeded = await seedAttributed('RET-1', 'EXT-1');
    await setOpenedAt(seeded.returnId, '2026-08-02T09:00:00.000Z');
    await seedAct(seeded.returnId, 'receive', '2026-08-05T10:00:00.000Z', 1);

    const response = await get(seeded.internalOrderId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries.map((entry) => entry.kind)).toEqual(['opened', 'receive']);
    expect(entries[0].source).toBe('record_status');
    expect(entries[1].source).toBe('custody_act');
    // A header column carries no actor: a source claim, or nothing.
    expect(entries[0].actorUserId).toBeNull();
  });

  it('emits the opened fact ONCE, not once per joined act', async () => {
    // The join repeats the header columns per act. Emitting them each time
    // would tell the operator the return was opened three times.
    const seeded = await seedAttributed('RET-1', 'EXT-1');
    await setOpenedAt(seeded.returnId, '2026-08-02T09:00:00.000Z');
    await seedAct(seeded.returnId, 'receive', '2026-08-05T10:00:00.000Z', 1);
    await seedAct(seeded.returnId, 'receive', '2026-08-05T11:00:00.000Z', 2);
    await seedAct(seeded.returnId, 'dispose', '2026-08-05T12:00:00.000Z', 3);

    const response = await get(seeded.internalOrderId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries.filter((entry) => entry.kind === 'opened')).toHaveLength(1);
    expect(entries).toHaveLength(4);
  });

  it('never exposes a connection id — the operator reads a name', async () => {
    // `sourceConnectionName` may legitimately be null here (the test connection
    // advertises no `OrderSource`), which is exactly the unknown-source case.
    // What must NEVER appear is the id, which the browser cannot resolve.
    const seeded = await seedAttributed('RET-1', 'EXT-1');
    await setOpenedAt(seeded.returnId, '2026-08-02T09:00:00.000Z');

    const response = await get(seeded.internalOrderId).expect(200);
    const [entry] = response.body.entries as TimelineEntryBody[];

    expect(entry).not.toHaveProperty('sourceConnectionId');
    expect(entry).toHaveProperty('sourceConnectionName');
  });

  it('reports a refund on a return that has produced NO entry of its own', async () => {
    // Reachable, not hypothetical: `openedAt` is persisted as null when a source
    // reports an unparseable `createdAt`, so a refunded return can have no
    // header fact and no acts — and its refund must still reach the operator.
    const seeded = await seedAttributed('RET-1', 'EXT-1');
    await harness
      .getDataSource()
      .query('UPDATE returns SET "openedAt" = NULL WHERE id = $1', [seeded.returnId]);
    await harness
      .getDataSource()
      .query(
        `INSERT INTO refund_records
           ("internalOrderId", amount, currency, reason, "recordedAt", "returnId", "executedBy")
         VALUES ($1, '10.00', 'PLN', 'return_accepted', $2, $3, 'operator_out_of_band')`,
        [seeded.internalOrderId, '2026-08-06T10:00:00.000Z', seeded.returnId]
      );

    const response = await get(seeded.internalOrderId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('refund_confirmed');
    // Taken from the return's real context, never defaulted.
    expect(entries[0].returnOrigin).toBe('source_ingested');
    expect(entries[0].actorUserId).toBeNull();
  });

  it('reports a return with a header fact but no acts at all', async () => {
    // The LEFT JOIN is what makes this reachable: an INNER join would drop the
    // return entirely and the operator would see nothing about it.
    const seeded = await seedAttributed('RET-1', 'EXT-1');
    await setOpenedAt(seeded.returnId, '2026-08-02T09:00:00.000Z');

    const response = await get(seeded.internalOrderId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('opened');
  });
});
