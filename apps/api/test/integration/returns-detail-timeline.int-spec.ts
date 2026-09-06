/**
 * Return-Detail Timeline Read Integration Test (#2646)
 *
 * Drives `GET /returns/:returnId/events` over HTTP against real Postgres.
 *
 * It earns integration coverage for the reasons its order-scoped sibling states,
 * plus two that are specific to this read:
 *
 *  - it must work for an ORPHAN return, which has no `internalOrderId` at all —
 *    the property that makes it a second read rather than a reuse of the first,
 *    and one only a real row can exhibit;
 *  - the route sits at `:returnId/events`, so only a booted Nest router proves
 *    it is reachable rather than being swallowed by `@Get(':returnId')`.
 *
 * @module apps/api/test/integration
 */
import request from 'supertest';
import {
  RETURNS_SERVICE_TOKEN,
  type IReturnsService,
  type IncomingReturn,
} from '@openlinker/core/returns';
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
  actorUserId: string | null;
}

describe('Return-Detail Timeline Read Integration', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  let connectionId: string;

  const service = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const http = (): ReturnType<typeof request> => harness.getHttp();

  const observation = (overrides: Partial<IncomingReturn> = {}): IncomingReturn => ({
    externalReturnId: 'RET-1',
    // No order reference: every return seeded here is an ORPHAN unless a test
    // says otherwise, which is exactly the case this read exists for.
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
    // Exactly ONCE per test — `loginAsAdmin` plain-INSERTs a fixed username.
    token = await loginAsAdmin(http(), harness.getDataSource());
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  const get = (returnId: string): request.Test =>
    http()
      .get(`/v1/returns/${encodeURIComponent(returnId)}/events`)
      .set('Authorization', `Bearer ${token}`);

  const seedOrphan = async (externalReturnId = 'RET-1'): Promise<string> => {
    const { record } = await service().upsertFromObservation(
      connectionId,
      observation({ externalReturnId })
    );
    return record.id;
  };

  const setOpenedAt = (returnId: string, at: string): Promise<unknown> =>
    harness
      .getDataSource()
      .query('UPDATE returns SET "openedAt" = $1 WHERE id = $2', [at, returnId]);

  /**
   * The orphan-match act (#2372). Written by direct UPDATE because ingestion
   * never writes these OL-owned columns — that asymmetry is the model's, not
   * the test's convenience.
   */
  const setMatched = (returnId: string, at: string, userId: string): Promise<unknown> =>
    harness
      .getDataSource()
      .query('UPDATE returns SET "matchedAt" = $1, "matchedByUserId" = $2 WHERE id = $3', [
        at,
        userId,
        returnId,
      ]);

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

  it('answers 404 for a return that does not exist, never an empty timeline', async () => {
    // An empty history would render a timeline for something that is not there.
    await get('ol_return_nothing').expect(404);
  });

  it('returns the acts and header facts of ONE return, oldest first', async () => {
    const returnId = await seedOrphan();
    await setOpenedAt(returnId, '2026-08-01T09:00:00.000Z');
    await seedAct(returnId, 'receive', '2026-08-02T10:00:00.000Z', 1);
    await seedAct(returnId, 'dispose', '2026-08-03T10:00:00.000Z', 2);

    const response = await get(returnId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries.map((e) => e.kind)).toEqual(['opened', 'receive', 'dispose']);
    expect(entries.every((e) => e.returnId === returnId)).toBe(true);
  });

  it('works for an ORPHAN return, which has no order to key on', async () => {
    // The whole reason this is a second read: the order-scoped sibling matches
    // on `internalOrderId`, which an orphan does not have.
    const returnId = await seedOrphan();
    const [row] = await harness
      .getDataSource()
      .query('SELECT "internalOrderId" FROM returns WHERE id = $1', [returnId]);
    expect(row.internalOrderId).toBeNull();

    await seedAct(returnId, 'receive', '2026-08-02T10:00:00.000Z', 1);

    const response = await get(returnId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries.map((e) => e.kind)).toContain('receive');
  });

  it('renders the orphan-match act with the operator who performed it (#2372 AC2)', async () => {
    const returnId = await seedOrphan();
    await setMatched(returnId, '2026-08-04T10:00:00.000Z', 'user-42');

    const response = await get(returnId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];
    const matched = entries.find((e) => e.kind === 'matched');

    expect(matched).toBeDefined();
    expect(matched?.source).toBe('record_status');
    // The actor is carried — a header column that HAS one must not be reported
    // as a source claim.
    expect(matched?.actorUserId).toBe('user-42');
  });

  it('carries no actor on `opened`, which is a source claim or nothing', async () => {
    const returnId = await seedOrphan();
    await setOpenedAt(returnId, '2026-08-01T09:00:00.000Z');

    const response = await get(returnId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];
    const opened = entries.find((e) => e.kind === 'opened');

    expect(opened?.actorUserId).toBeNull();
  });

  it('emits ONE header entry per return however many acts it has', async () => {
    // The join repeats the header columns once per act; emitting them each time
    // would tell the operator a return was opened three times.
    const returnId = await seedOrphan();
    await setOpenedAt(returnId, '2026-08-01T09:00:00.000Z');
    await seedAct(returnId, 'receive', '2026-08-02T10:00:00.000Z', 1);
    await seedAct(returnId, 'receive', '2026-08-02T11:00:00.000Z', 2);
    await seedAct(returnId, 'dispose', '2026-08-03T10:00:00.000Z', 3);

    const response = await get(returnId).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries.filter((e) => e.kind === 'opened')).toHaveLength(1);
  });

  it('does not leak a sibling return’s acts', async () => {
    const mine = await seedOrphan('RET-1');
    const other = await seedOrphan('RET-2');
    await seedAct(mine, 'receive', '2026-08-02T10:00:00.000Z', 1);
    await seedAct(other, 'dispose', '2026-08-02T11:00:00.000Z', 1);

    const response = await get(mine).expect(200);
    const entries = response.body.entries as TimelineEntryBody[];

    expect(entries.every((e) => e.returnId === mine)).toBe(true);
    expect(entries.map((e) => e.kind)).not.toContain('dispose');
  });
});
