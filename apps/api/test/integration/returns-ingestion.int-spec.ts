/**
 * Returns Ingestion Integration Test (#2328, #2332, ADR-060)
 *
 * Drives `ReturnsService.upsertFromObservation` against real Postgres
 * (Testcontainers). Everything asserted here is a claim about what repeated
 * ingestion does to REAL ROWS, which is precisely what a mocked repository
 * cannot answer:
 *
 *  - a replay leaves exactly ONE row — asserted by COUNTING, because that is
 *    the actual claim (there is deliberately no `created` flag to assert on);
 *  - source-owned fields are refreshed while `openedAt` survives a later
 *    observation that omits it;
 *  - the OL-owned `authorizedAt` / `declinedAt` / `closedAt` and the Wave-2 line
 *    columns are UNTOUCHED across re-ingestion — the headline AC, proved by
 *    hand-writing all of them between two observations and reading them back;
 *  - lines converge per `(returnId, lineIndex)`: values refresh, `id` and
 *    `createdAt` are stable, a new line appends, and a line the source stops
 *    reporting survives;
 *  - attribution is MONOTONIC — an orphan may gain an order, and a later failed
 *    re-resolve never re-orphans it;
 *  - a blank external id is refused with no row written, and a synthetic key
 *    collapses repeated observations onto one row;
 *  - two connections reporting the same external id keep two rows;
 *  - the #2332 re-attribution reads and the conditional-UPDATE claim behave
 *    against real rows. These earn integration coverage specifically because
 *    their unit spec drives a chainable BUILDER MOCK, which by construction can
 *    prove neither of the two things that can actually be wrong: the raw-alias
 *    projection (`getRawMany` -> `row.r_externalOrderId`; an alias mismatch
 *    silently yields `undefined`, the lookup is handed nothing, and the pass
 *    hands the lookup an `undefined` external order id — which makes TypeORM
 *    DROP that `where` condition and match an ARBITRARY mapping, attributing
 *    the return to the wrong order rather than failing; that is why the
 *    re-attribution test seeds TWO orphans and TWO orders), and the `IS NULL`
 *    arm on the claim, which is BOTH the concurrency
 *    seam and the monotonicity guarantee the whole issue rests on. These are
 *    driven through `IReturnReattributionService`, not the repository port —
 *    the pass touches all three new statements on its way through, and a
 *    sibling reaches an aggregate through its `I*Service`.
 *
 * @module apps/api/test/integration
 */
import {
  RETURN_REATTRIBUTION_SERVICE_TOKEN,
  RETURN_REPOSITORY_TOKEN,
  RETURNS_SERVICE_TOKEN,
} from '@openlinker/core/returns';
// `ReturnRepositoryPort` is allow-listed in `scripts/check-cross-context-imports.mjs`.
// The rule exists so a SIBLING CONTEXT reaches an aggregate through `I*Service`; this is
// an integration test, and exactly one property here cannot be reached through the
// service at all — see the docblock on the concurrent-claim case below.
import type {
  IReturnReattributionService,
  IReturnsService,
  IncomingReturn,
  ReturnRepositoryPort,
} from '@openlinker/core/returns';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { ReturnObservationMissingExternalIdError } from '@openlinker/core/returns';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Returns Ingestion Integration', () => {
  let harness: IntegrationTestHarness;
  let connectionA: string;
  let connectionB: string;

  const service = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  // #2332 drives the pass through its SERVICE seam, not the repository port —
  // a sibling reaches an aggregate through `I*Service` (architecture-overview
  // § Cross-context dependencies), and the reconcile exercises all three new
  // repository statements on its way through anyway.
  const reattribution = (): IReturnReattributionService =>
    harness
      .getApp()
      .get<IReturnReattributionService>(RETURN_REATTRIBUTION_SERVICE_TOKEN, { strict: false });

  const repository = (): ReturnRepositoryPort =>
    harness.getApp().get<ReturnRepositoryPort>(RETURN_REPOSITORY_TOKEN, { strict: false });

  const identifierMapping = (): IIdentifierMappingService =>
    harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, { strict: false });

  const query = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> => (await harness.getDataSource().query(sql, params)) as T[];

  const countReturns = async (): Promise<number> => {
    const rows = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM "returns"`);
    return rows[0].c;
  };

  const observation = (overrides: Partial<IncomingReturn> = {}): IncomingReturn => ({
    externalReturnId: 'RET-1',
    externalOrderId: 'ORD-9',
    rawStatus: 'WAITING_FOR_PARCEL',
    createdAt: '2026-08-01T10:00:00.000Z',
    lines: [{ quantity: 2, reasonRaw: 'withdrawal', sku: 'SKU-1', name: 'A thing' }],
    ...overrides,
  });

  beforeAll(async () => {
    harness = await getTestHarness();
  });
  beforeEach(async () => {
    connectionA = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
    connectionB = (await createTestConnection(harness.getDataSource(), { name: 'Source B' })).id;
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('replay idempotency', () => {
    it('should leave exactly one row when the same observation is ingested twice', async () => {
      const first = await service().upsertFromObservation(connectionA, observation());
      const second = await service().upsertFromObservation(connectionA, observation());

      expect(await countReturns()).toBe(1);
      expect(second.record.id).toBe(first.record.id);
    });

    it('should refresh the source-owned fields while openedAt survives an omission', async () => {
      await service().upsertFromObservation(connectionA, observation());
      await service().upsertFromObservation(
        connectionA,
        // A later observation the source no longer timestamps.
        observation({ rawStatus: 'PARCEL_RECEIVED', createdAt: 'unparseable' })
      );

      const [row] = await query<{ rawStatus: string; openedAt: Date }>(
        `SELECT "rawStatus", "openedAt" FROM "returns"`
      );
      expect(row.rawStatus).toBe('PARCEL_RECEIVED');
      // Opening happened once — COALESCE keeps it.
      expect(new Date(row.openedAt).toISOString()).toBe('2026-08-01T10:00:00.000Z');
    });

    it('should keep two rows when two connections report the same external id', async () => {
      await service().upsertFromObservation(connectionA, observation());
      await service().upsertFromObservation(connectionB, observation());

      expect(await countReturns()).toBe(2);
    });
  });

  describe('OL-owned state is untouched by re-ingestion', () => {
    it('should preserve every OL-owned header timestamp and Wave-2 line column', async () => {
      const { record } = await service().upsertFromObservation(connectionA, observation());

      // Hand-write everything ingestion must never own — the AC's proof.
      await query(
        `UPDATE "returns"
           SET "authorizedAt" = $2, "declinedAt" = $3, "closedAt" = $4
         WHERE "id" = $1`,
        [
          record.id,
          new Date('2026-08-03T00:00:00Z'),
          new Date('2026-08-04T00:00:00Z'),
          new Date('2026-08-05T00:00:00Z'),
        ]
      );
      await query(
        `UPDATE "return_lines"
           SET "quantityReceived" = 2, "quantityRestocked" = 1, "quantityScrapped" = 1,
               "custodyState" = 'disposed', "moneyState" = 'refunded',
               "disposition" = 'restock', "receivedAt" = now(), "disposedAt" = now(),
               "resolvedOrderLineId" = 'ol_orderline_x'
         WHERE "returnId" = $1`,
        [record.id]
      );

      await service().upsertFromObservation(
        connectionA,
        observation({ rawStatus: 'REOPENED_AT_SOURCE' })
      );

      const [header] = await query<{
        authorizedAt: Date | null;
        declinedAt: Date | null;
        closedAt: Date | null;
        rawStatus: string;
      }>(`SELECT "authorizedAt", "declinedAt", "closedAt", "rawStatus" FROM "returns"`);
      expect(header.authorizedAt).not.toBeNull();
      expect(header.declinedAt).not.toBeNull();
      expect(header.closedAt).not.toBeNull();
      // …while the source's own field DID refresh, so this is not a no-op test.
      expect(header.rawStatus).toBe('REOPENED_AT_SOURCE');

      const [line] = await query<Record<string, unknown>>(
        `SELECT * FROM "return_lines" WHERE "returnId" = $1`,
        [record.id]
      );
      expect(line.quantityReceived).toBe(2);
      expect(line.quantityRestocked).toBe(1);
      expect(line.quantityScrapped).toBe(1);
      expect(line.custodyState).toBe('disposed');
      expect(line.moneyState).toBe('refunded');
      expect(line.disposition).toBe('restock');
      expect(line.receivedAt).not.toBeNull();
      expect(line.disposedAt).not.toBeNull();
      expect(line.resolvedOrderLineId).toBe('ol_orderline_x');
    });

    it('should report the OL-owned timestamps as null on the returned record, per the contract', async () => {
      const { record } = await service().upsertFromObservation(connectionA, observation());
      await query(`UPDATE "returns" SET "authorizedAt" = now() WHERE "id" = $1`, [record.id]);

      const second = await service().upsertFromObservation(connectionA, observation());

      expect(second.record.authorizedAt).toBeNull();
      // The row itself is untouched; the caller re-reads for the true value.
      const reread = await service().getReturn(record.id);
      expect(reread?.authorizedAt).not.toBeNull();
    });
  });

  describe('lines converge per (returnId, lineIndex)', () => {
    it('should refresh a line in place, keeping its id and createdAt', async () => {
      const { record } = await service().upsertFromObservation(connectionA, observation());
      const [before] = await query<{ id: string; createdAt: Date }>(
        `SELECT "id", "createdAt" FROM "return_lines" WHERE "returnId" = $1`,
        [record.id]
      );

      await service().upsertFromObservation(
        connectionA,
        observation({ lines: [{ quantity: 5, reasonRaw: 'defective', sku: 'SKU-1-REV' }] })
      );

      const rows = await query<{
        id: string;
        createdAt: Date;
        quantityAdvised: number;
        reason: string;
        sku: string;
      }>(`SELECT * FROM "return_lines" WHERE "returnId" = $1`, [record.id]);
      expect(rows).toHaveLength(1);
      // A churned line id would re-key a parcel physically in transit.
      expect(rows[0].id).toBe(before.id);
      expect(new Date(rows[0].createdAt).toISOString()).toBe(
        new Date(before.createdAt).toISOString()
      );
      expect(rows[0].quantityAdvised).toBe(5);
      expect(rows[0].reason).toBe('defective');
      expect(rows[0].sku).toBe('SKU-1-REV');
    });

    it('should append a newly-reported line without producing a third row', async () => {
      const { record } = await service().upsertFromObservation(connectionA, observation());

      await service().upsertFromObservation(
        connectionA,
        observation({
          lines: [
            { quantity: 2, reasonRaw: 'withdrawal', sku: 'SKU-1' },
            { quantity: 1, reasonRaw: 'wrong_item', sku: 'SKU-2' },
          ],
        })
      );

      const rows = await query<{ lineIndex: number }>(
        `SELECT "lineIndex" FROM "return_lines" WHERE "returnId" = $1 ORDER BY "lineIndex"`,
        [record.id]
      );
      expect(rows.map((row) => row.lineIndex)).toEqual([0, 1]);
    });

    it('should keep a line the source stops reporting', async () => {
      const { record } = await service().upsertFromObservation(
        connectionA,
        observation({
          lines: [
            { quantity: 2, reasonRaw: 'withdrawal' },
            { quantity: 1, reasonRaw: 'defective' },
          ],
        })
      );

      await service().upsertFromObservation(
        connectionA,
        observation({ lines: [{ quantity: 2, reasonRaw: 'withdrawal' }] })
      );

      // Deleting would erase the record of a parcel that may already be in the
      // building — Wave 2 decides what such a line becomes.
      const rows = await query(`SELECT "lineIndex" FROM "return_lines" WHERE "returnId" = $1`, [
        record.id,
      ]);
      expect(rows).toHaveLength(2);
    });
  });

  describe('attribution', () => {
    it('should persist an unattributable return as an orphan and list it', async () => {
      const result = await service().upsertFromObservation(
        connectionA,
        observation({ externalOrderId: 'ORD-NEVER-INGESTED' })
      );

      expect(result.attributed).toBe(false);
      expect(result.record.internalOrderId).toBeNull();

      const orphans = await service().listOrphanReturns(10, 0);
      expect(orphans.map((row) => row.id)).toContain(result.record.id);
    });

    it('should let an orphan gain an order, and never re-orphan it afterwards', async () => {
      const first = await service().upsertFromObservation(connectionA, observation());
      expect(first.record.internalOrderId).toBeNull();

      // The order is ingested in between, so the next observation resolves.
      await identifierMapping().createMapping('Order', 'ORD-9', connectionA, 'ol_order_real');
      const second = await service().upsertFromObservation(connectionA, observation());
      expect(second.attributed).toBe(true);
      expect(second.record.internalOrderId).toBe('ol_order_real');

      // A later observation that names no order at all must NOT blank it —
      // attribution is monotonic (COALESCE), or a hiccup would re-orphan a
      // return whose downstream triggers already depend on the attribution.
      const third = await service().upsertFromObservation(
        connectionA,
        observation({ externalOrderId: null })
      );
      expect(third.attributed).toBe(false);
      expect(third.record.internalOrderId).toBe('ol_order_real');

      const [row] = await query<{ internalOrderId: string | null }>(
        `SELECT "internalOrderId" FROM "returns"`
      );
      expect(row.internalOrderId).toBe('ol_order_real');
    });
  });

  describe('orphan re-attribution (#2332)', () => {
    it('should re-attribute each orphan to ITS OWN order once the orders are ingested', async () => {
      const first = await service().upsertFromObservation(
        connectionA,
        observation({ externalReturnId: 'RET-1', externalOrderId: 'ORD-9' })
      );
      const second = await service().upsertFromObservation(
        connectionA,
        observation({ externalReturnId: 'RET-2', externalOrderId: 'ORD-10' })
      );
      expect([first.record.internalOrderId, second.record.internalOrderId]).toEqual([null, null]);

      // The fact arrives from the OTHER direction — the orders show up later,
      // and no re-observation of either return is involved.
      await identifierMapping().createMapping('Order', 'ORD-9', connectionA, 'ol_order_nine');
      await identifierMapping().createMapping('Order', 'ORD-10', connectionA, 'ol_order_ten');

      const result = await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });

      expect([result.scanned, result.reattributed, result.unresolved, result.failed]).toEqual([
        2, 2, 0, 0,
      ]);

      // TWO orphans and TWO distinct orders, deliberately. With one of each, a
      // broken candidate projection still passes: an `undefined` external order
      // id makes `getInternalId`'s `where` clause DROP that condition, so it
      // matches the single existing mapping and the return is attributed to the
      // right order by accident. Verified by mutating the projection's raw
      // alias — the single-mapping version of this test did not catch it, and
      // the production consequence is a return attributed to an ARBITRARY
      // order, which is worse than the orphan state it replaced.
      const rows = await query<{ externalReturnId: string; internalOrderId: string | null }>(
        `SELECT "externalReturnId", "internalOrderId" FROM "returns" ORDER BY "externalReturnId"`
      );
      expect(rows).toEqual([
        { externalReturnId: 'RET-1', internalOrderId: 'ol_order_nine' },
        { externalReturnId: 'RET-2', internalOrderId: 'ol_order_ten' },
      ]);
    });

    it('should leave an orphan alone while its order is still unknown', async () => {
      await service().upsertFromObservation(connectionA, observation());

      const result = await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });

      expect([result.scanned, result.unresolved, result.reattributed]).toEqual([1, 1, 0]);
      const [row] = await query<{ internalOrderId: string | null }>(
        `SELECT "internalOrderId" FROM "returns"`
      );
      expect(row.internalOrderId).toBeNull();
    });

    it('should refuse a claim on an already-attributed return, leaving its order unchanged', async () => {
      const orphan = await service().upsertFromObservation(connectionA, observation());
      await identifierMapping().createMapping('Order', 'ORD-9', connectionA, 'ol_order_real');
      await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });

      // Reached through the REPOSITORY, deliberately, and this is the one case
      // in the file that is: the claim's `WHERE "internalOrderId" IS NULL` arm
      // exists for a CONCURRENT writer, and the pass itself only ever claims
      // rows its own candidate query already filtered to orphans — so through
      // the service seam the arm is unreachable and unfalsifiable (verified by
      // deleting it: every service-level test still passed). What it guarantees
      // is monotonicity: this statement can fill an attribution in and can
      // never re-point one at a different order.
      await expect(
        repository().claimAttribution(orphan.record.id, 'ol_order_someone_else')
      ).resolves.toBe(false);

      const [row] = await query<{ internalOrderId: string | null }>(
        `SELECT "internalOrderId" FROM "returns" WHERE "id" = $1`,
        [orphan.record.id]
      );
      expect(row.internalOrderId).toBe('ol_order_real');
    });

    it('should be a no-op on a second run, the attributed row having left the candidate set', async () => {
      await service().upsertFromObservation(connectionA, observation());
      await identifierMapping().createMapping('Order', 'ORD-9', connectionA, 'ol_order_real');
      await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });

      const second = await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });

      // Claimed rows drop out of the filtered set — which is what lets the scan
      // offset wrap over a shrinking set instead of paging forever, and what
      // makes the `IS NULL` arm on the claim observable from outside.
      expect([second.scanned, second.total, second.reattributed]).toEqual([0, 0, 0]);
      const [row] = await query<{ internalOrderId: string | null }>(
        `SELECT "internalOrderId" FROM "returns"`
      );
      expect(row.internalOrderId).toBe('ol_order_real');
    });

    it('should never consider a return the source attached to no order', async () => {
      await service().upsertFromObservation(connectionA, observation({ externalOrderId: null }));

      // Nothing to resolve BY, so it must be excluded rather than re-checked on
      // every tick forever. It stays in the orphan BUCKET for an operator.
      const result = await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });

      expect([result.scanned, result.total]).toEqual([0, 0]);
      expect(await service().countOrphanReturns()).toBe(1);
    });

    it('should scope the pass to one connection', async () => {
      await service().upsertFromObservation(connectionB, observation());
      await identifierMapping().createMapping('Order', 'ORD-9', connectionB, 'ol_order_b');

      const onA = await reattribution().reconcile(connectionA, { limit: 10, offset: 0 });
      const onB = await reattribution().reconcile(connectionB, { limit: 10, offset: 0 });

      expect([onA.total, onB.total, onB.reattributed]).toEqual([0, 1, 1]);
    });

    it('should persist the source order reference so a later reconcile has a key at all', async () => {
      // The premise the issue got wrong: before #2332 this value was read once
      // during ingestion and discarded, leaving an orphan unresolvable forever.
      await service().upsertFromObservation(connectionA, observation());

      const [row] = await query<{ externalOrderId: string | null }>(
        `SELECT "externalOrderId" FROM "returns"`
      );
      expect(row.externalOrderId).toBe('ORD-9');
    });

    it('should never blank a stored source order reference on a later observation', async () => {
      await service().upsertFromObservation(connectionA, observation());
      await service().upsertFromObservation(connectionA, observation({ externalOrderId: null }));

      // COALESCE, not latest-wins: a source that stops naming the order has not
      // made the return belong to a different one, and blanking it would
      // destroy the only key the reconcile can resolve from.
      const [row] = await query<{ externalOrderId: string | null }>(
        `SELECT "externalOrderId" FROM "returns"`
      );
      expect(row.externalOrderId).toBe('ORD-9');
    });

    it('should count orphans for the operator bucket', async () => {
      await service().upsertFromObservation(connectionA, observation());
      await service().upsertFromObservation(
        connectionB,
        observation({ externalReturnId: 'RET-2' })
      );

      expect(await service().countOrphanReturns()).toBe(2);
    });
  });

  describe('the external key', () => {
    it('should refuse a blank external id without writing a row', async () => {
      const bad = observation();
      (bad as { externalReturnId: unknown }).externalReturnId = '   ';

      await expect(service().upsertFromObservation(connectionA, bad)).rejects.toBeInstanceOf(
        ReturnObservationMissingExternalIdError
      );
      expect(await countReturns()).toBe(0);
    });

    it('should collapse repeated observations carrying an adapter-synthesised key onto one row', async () => {
      // The recorded form for a source that mints no return id: deterministic,
      // built only from source-stable coordinates, namespaced.
      const synthetic = observation({ externalReturnId: 'erli:ORD-9:0' });

      await service().upsertFromObservation(connectionA, synthetic);
      await service().upsertFromObservation(connectionA, synthetic);

      expect(await countReturns()).toBe(1);
    });
  });

  /**
   * #2372 — the three claims that are DATABASE behaviour and therefore
   * unreachable from the mocked unit specs.
   *
   * The integration harness builds its schema by `synchronize`, so these prove
   * the ORM entity's shape end to end; migration `1860000000000` is what makes
   * the same columns exist on a real deployment, and `migration:show` guards
   * that half.
   */
  describe('operator writes (#2372)', () => {
    it('should stamp authorizedAt at most once, whatever the caller does', async () => {
      const created = await service().upsertFromObservation(connectionA, observation());
      const first = new Date('2026-08-26T09:00:00.000Z');
      const second = new Date('2026-08-26T10:00:00.000Z');

      // This single conditional UPDATE — not the ADR-044 proposal slot and not a
      // lock — is the whole at-most-once guarantee `ReturnAuthorizeService` relies
      // on when it declines to abort on a reused proposal.
      await expect(repository().claimAuthorizedAt(created.record.id, first)).resolves.toBe(true);
      await expect(repository().claimAuthorizedAt(created.record.id, second)).resolves.toBe(false);

      const [row] = await query<{ authorizedAt: Date | null }>(
        `SELECT "authorizedAt" FROM "returns" WHERE "id" = $1`,
        [created.record.id]
      );
      expect(row.authorizedAt).toEqual(first);
    });

    it('should persist operator match provenance, and leave it NULL for a reconcile claim', async () => {
      const byOperator = await service().upsertFromObservation(connectionA, observation());
      const byReconcile = await service().upsertFromObservation(
        connectionA,
        observation({ externalReturnId: 'RET-2' })
      );
      const matchedAt = new Date('2026-08-26T11:00:00.000Z');

      await expect(
        repository().claimAttribution(byOperator.record.id, 'ol_order_matched', {
          at: matchedAt,
          actorUserId: 'user-42',
        })
      ).resolves.toBe(true);
      // The #2332 reconcile's two-argument call — byte-identical statement, and
      // the provenance columns must stay NULL so "an operator did this" remains a
      // distinguishable fact rather than an inference.
      await expect(
        repository().claimAttribution(byReconcile.record.id, 'ol_order_reconciled')
      ).resolves.toBe(true);

      const rows = await query<{
        id: string;
        internalOrderId: string | null;
        matchedAt: Date | null;
        matchedByUserId: string | null;
      }>(
        `SELECT "id", "internalOrderId", "matchedAt", "matchedByUserId" FROM "returns" WHERE "id" = ANY($1)`,
        [[byOperator.record.id, byReconcile.record.id]]
      );

      const operatorRow = rows.find((r) => r.id === byOperator.record.id);
      expect(operatorRow?.internalOrderId).toBe('ol_order_matched');
      expect(operatorRow?.matchedAt).toEqual(matchedAt);
      expect(operatorRow?.matchedByUserId).toBe('user-42');

      const reconcileRow = rows.find((r) => r.id === byReconcile.record.id);
      expect(reconcileRow?.internalOrderId).toBe('ol_order_reconciled');
      expect(reconcileRow?.matchedAt).toBeNull();
      expect(reconcileRow?.matchedByUserId).toBeNull();
    });

    it('should hydrate the match provenance back onto the aggregate', async () => {
      const created = await service().upsertFromObservation(connectionA, observation());
      const matchedAt = new Date('2026-08-26T12:00:00.000Z');
      await repository().claimAttribution(created.record.id, 'ol_order_matched', {
        at: matchedAt,
        actorUserId: 'user-7',
      });

      // The columns are useless if they never reach the domain entity — #2376
      // renders them, and `ReturnRecord`'s constructor is positional.
      const hydrated = await repository().findById(created.record.id);
      expect(hydrated?.matchedAt).toEqual(matchedAt);
      expect(hydrated?.matchedByUserId).toBe('user-7');
    });

    it('should admit MANY operator-authored returns, since a NULL key is distinct under the partial index', async () => {
      const line = {
        lineIndex: 0,
        externalLineId: null,
        resolvedOrderLineId: null,
        offerId: null,
        sku: 'SKU-1',
        name: 'A thing',
        reason: 'other' as const,
        quantityAdvised: 1,
        note: null,
      };
      const input = {
        sourceConnectionId: connectionA,
        // Never synthesised — the row must not claim a source it has not got.
        externalReturnId: null,
        internalOrderId: 'ol_order_known',
        externalOrderId: 'ORD-9',
        origin: 'operator_authored' as const,
        rawStatus: null,
        rawPayload: null,
        openedAt: new Date('2026-08-26T13:00:00.000Z'),
        authorizedAt: null,
        declinedAt: null,
        closedAt: null,
        lines: [line],
      };

      const first = await repository().create(input);
      // `UQ_returns_source_external` is PARTIAL, so two NULL keys do not collide.
      // Recording twice therefore yields two returns — accepted (see
      // `IReturnsService.recordReturn`), and asserted here so it is a known
      // property rather than a surprise.
      const second = await repository().create(input);

      expect(second.id).not.toBe(first.id);
      expect(first.externalReturnId).toBeNull();
      expect(first.origin).toBe('operator_authored');
      // Recording and authorizing are two acts.
      expect(first.authorizedAt).toBeNull();
      expect(first.lines[0].custodyState).toBe('advised');
      expect(first.lines[0].quantityReceived).toBe(0);
    });
  });
});
