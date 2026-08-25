/**
 * Returns Ingestion Integration Test (#2328, ADR-060)
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
 *  - two connections reporting the same external id keep two rows.
 *
 * @module apps/api/test/integration
 */
import { RETURNS_SERVICE_TOKEN } from '@openlinker/core/returns';
import type { IReturnsService, IncomingReturn } from '@openlinker/core/returns';
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
      expect(new Date(rows[0].createdAt).toISOString()).toBe(new Date(before.createdAt).toISOString());
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
});
