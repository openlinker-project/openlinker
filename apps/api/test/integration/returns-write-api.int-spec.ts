/**
 * Returns Write API Integration Test (#2376, `W2-39`)
 *
 * Covers the issue's headline acceptance criterion end to end —
 * **receive -> dispose -> blocked -> attest** — plus the three properties a
 * controller unit test provably cannot reach:
 *
 *  - **the 409 and its actionable code come from a GLOBAL filter** registered in
 *    `configureApp`, so only a booted app proves the status an operator sees;
 *  - **the counter invariant is a DB CHECK** (`CHK_return_lines_quantity_ordering`),
 *    so over-receipt refusing is a property of Postgres plus the pure rule, not
 *    of a mock;
 *  - **the boot-time DI gate** — this route set injects six services across three
 *    core modules, and Nest imports are not transitive, so a missing provider
 *    binding surfaces only here.
 *
 * A blocked restock is exercised through a return with **no inventory master**
 * on its connection: `no-inventory-master` is a real block reason, needs no
 * adapter fixture, and lands on exactly the branch the AC names — a 2xx carrying
 * `restockBlocked` while `quantityRestocked` stays put.
 *
 * @module apps/api/test/integration
 */
import request from 'supertest';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
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

process.env.OL_PII_HASH_SALT = process.env.OL_PII_HASH_SALT ?? 'returns-write-api-int-spec-salt';

const EXTERNAL_ORDER_ID = 'EXT-ORDER-WRITE-1';

describe('Returns Write API Integration', () => {
  let harness: IntegrationTestHarness;
  let connectionId: string;
  let token: string;

  // Same shape the passing suites in this folder use — no cast: `request(...)`
  // returns `TestAgent<Test>` in this supertest version, not `SuperTest<Test>`.
  const http = (): ReturnType<typeof request> => harness.getHttp();

  const returns = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const observation = (externalReturnId: string): IncomingReturn => ({
    externalReturnId,
    externalOrderId: EXTERNAL_ORDER_ID,
    rawStatus: 'DELIVERED',
    createdAt: '2026-08-01T10:00:00.000Z',
    lines: [{ quantity: 3, reasonRaw: 'withdrawal', name: 'Widget', sku: 'W-1' }],
  });

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
    // `loginAsAdmin` plain-INSERTs a fixed username, so it is called exactly
    // ONCE per test — a second call violates the users unique constraint.
    token = await loginAsAdmin(http(), harness.getDataSource());
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  /** Attribution is a lookup, never a mint — the mapping must exist FIRST. */
  const seedAttributedReturn = async (
    externalReturnId: string
  ): Promise<{ returnId: string; lineId: string }> => {
    await harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, { strict: false })
      .getOrCreateInternalId(CORE_ENTITY_TYPE.Order, EXTERNAL_ORDER_ID, connectionId);

    const { record } = await returns().upsertFromObservation(
      connectionId,
      observation(externalReturnId)
    );

    return { returnId: record.id, lineId: record.lines[0].id };
  };

  it('should refuse a line that belongs to a different return', async () => {
    const first = await seedAttributedReturn('RET-WRITE-7');
    const { record: second } = await returns().upsertFromObservation(
      connectionId,
      observation('RET-WRITE-8')
    );

    // The nested route's claim, verified against a real router + filter: the
    // custody write keys on `lineId` alone, so nothing but this check stops the
    // URL naming the wrong parent.
    await http()
      .post(`/v1/returns/${second.id}/lines/${first.lineId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 })
      .expect(404);
  });

  it('should walk receive -> dispose -> blocked -> attest', async () => {
    const { returnId, lineId } = await seedAttributedReturn('RET-WRITE-1');
    const base = `/v1/returns/${returnId}/lines/${lineId}`;

    const received = await http()
      .post(`${base}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 2 })
      .expect(201);
    expect(received.body.line.quantityReceived).toBe(2);
    expect(received.body.line.custodyState).toBe('received');

    // No inventory master on this connection, so the master write cannot land.
    const disposed = await http()
      .post(`${base}/dispose`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 2, disposition: 'restock' })
      .expect(201);

    // THE ACCEPTANCE CRITERION: a 2xx carrying the blocked detail, and the
    // counter deliberately NOT moved — nothing may report these restocked.
    expect(disposed.body.restockBlocked).not.toBeNull();
    expect(disposed.body.restockBlocked.quantity).toBe(2);
    expect(disposed.body.restockBlocked.sku).toBe('W-1');
    expect(disposed.body.restockBlocked).toHaveProperty('connectionName');
    expect(disposed.body.line.quantityRestocked).toBe(0);
    expect(disposed.body.line.quantityReceived).toBe(2);

    const attested = await http()
      .post(`${base}/mark-stock-handled`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    // The attestation moves the units and records who said so; it never writes
    // stock and never claims OpenLinker did.
    expect(attested.body.line.quantityRestocked).toBe(2);
    expect(attested.body.eventIds.length).toBeGreaterThan(0);
  });

  it('should answer 409 with an actionable code on over-receipt', async () => {
    const { returnId, lineId } = await seedAttributedReturn('RET-WRITE-2');

    const response = await http()
      .post(`/v1/returns/${returnId}/lines/${lineId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      // Advised is 3.
      .send({ quantity: 4 })
      .expect(409);

    expect(response.body.reason).toBe('over-receipt');
    expect(response.body.error).toBe('ReturnCustodyTransitionError');
  });

  it('should reject a non-positive quantity at the DTO boundary', async () => {
    const { returnId, lineId } = await seedAttributedReturn('RET-WRITE-3');

    // 400, not 409: the boundary catches it before the domain rule can, which is
    // exactly why `non-positive-quantity` is a genuine state conflict wherever
    // it IS reached.
    await http()
      .post(`/v1/returns/${returnId}/lines/${lineId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 0 })
      .expect(400);
  });

  it('should refuse every write without a token', async () => {
    const { returnId, lineId } = await seedAttributedReturn('RET-WRITE-4');

    await http().post(`/v1/returns/${returnId}/lines/${lineId}/receive`).send({ quantity: 1 }).expect(401);
    await http().post(`/v1/returns/${returnId}/authorize`).send({}).expect(401);
    await http().post(`/v1/returns/${returnId}/correction-proposal`).send({}).expect(401);
  });

  it('should preview a correction proposal without recording one', async () => {
    const { returnId } = await seedAttributedReturn('RET-WRITE-5');

    const response = await http()
      .get(`/v1/returns/${returnId}/correction-proposal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Nothing is disposed, so the disposed-lines gate is reached FIRST — asserted
    // exactly rather than as a two-way `toContain`, so a reordering of the gates
    // is a failing test rather than a silently different answer.
    expect(response.body.outcome).toBe('no-disposed-lines');
    expect(response.body.changeId).toBeNull();

    const rows: Array<{ count: string }> = await harness
      .getDataSource()
      .query(`SELECT COUNT(*)::text AS count FROM order_changes WHERE kind = $1`, [
        'return.invoice_correction',
      ]);
    expect(rows[0].count).toBe('0');
  });

  it('should refuse authorize on a source-ingested return with a named reason', async () => {
    const { returnId } = await seedAttributedReturn('RET-WRITE-6');

    const response = await http()
      .post(`/v1/returns/${returnId}/authorize`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);

    // OpenLinker must not pretend to decide what a marketplace already decided —
    // and an operator clicking Authorize must learn WHY nothing happened.
    expect(response.body.reason).toBe('source-ingested');
  });
});
