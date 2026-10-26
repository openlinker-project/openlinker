/**
 * Inventory Movement Repository Unit Tests (#3565)
 *
 * The history read is one parameterised UNION ALL. These pin which branches a
 * filter set produces, that user input only ever reaches the database as a bound
 * parameter, and the guards on the retention prune. The SQL itself is exercised
 * against real Postgres by `inventory-movements.int-spec.ts`.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { InventoryMovementRepository } from './inventory-movement.repository';
import type { InventoryMovementOrmEntity } from '../entities/inventory-movement.orm-entity';

describe('InventoryMovementRepository', () => {
  let query: jest.Mock;
  let repository: InventoryMovementRepository;

  const callsOf = (): Array<[string, unknown[]]> => query.mock.calls as Array<[string, unknown[]]>;
  const sqlOf = (call: number): string => callsOf()[call][0];
  const paramsOf = (call: number): unknown[] => callsOf()[call][1];

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    repository = new InventoryMovementRepository({
      query,
    } as unknown as Repository<InventoryMovementOrmEntity>);
  });

  describe('listHistory', () => {
    it('should union ledger rows with reservations when no kind is given', async () => {
      await repository.listHistory({}, { limit: 20, offset: 0 });

      expect(sqlOf(0)).toContain('"inventory_movements"');
      expect(sqlOf(0)).toContain('UNION ALL');
      expect(sqlOf(0)).toContain('"reservations"');
      expect(sqlOf(0)).toContain('ORDER BY history."occurredAt" DESC');
      expect(paramsOf(0)).toEqual([20, 0]);
    });

    it('should read only the ledger when the kind is movements', async () => {
      await repository.listHistory({ kind: 'movements' }, { limit: 20, offset: 0 });

      expect(sqlOf(0)).not.toContain('"reservations"');
    });

    it('should read only reservations when the kind is promised', async () => {
      await repository.listHistory({ kind: 'promised' }, { limit: 20, offset: 0 });

      expect(sqlOf(0)).not.toContain('FROM "inventory_movements"');
      expect(sqlOf(0)).toContain('"reservations"');
    });

    it('should drop the reservation branch when filtering by reason or attention', async () => {
      await repository.listHistory({ reasons: ['sale'] }, { limit: 20, offset: 0 });
      await repository.listHistory({ needsAttention: true }, { limit: 20, offset: 0 });

      expect(sqlOf(0)).not.toContain('"reservations"');
      expect(sqlOf(1)).not.toContain('"reservations"');
      expect(sqlOf(1)).toContain(`IN ('refused', 'in_doubt')`);
    });

    it('should short-circuit to an empty result when the filters exclude every branch', async () => {
      await expect(
        repository.listHistory({ kind: 'promised', needsAttention: true }, { limit: 5, offset: 0 })
      ).resolves.toEqual([]);

      expect(query).not.toHaveBeenCalled();
    });

    it('should bind every filter as a parameter and never interpolate it', async () => {
      const hostile = `x'; DROP TABLE inventory_movements; --`;
      await repository.listHistory(
        {
          productId: hostile,
          productVariantId: 'v1',
          sourceConnectionId: 'c1',
          from: new Date('2026-01-01T00:00:00Z'),
          to: new Date('2026-02-01T00:00:00Z'),
          search: hostile,
          reasons: ['sale', 'return_restock'],
        },
        { limit: 20, offset: 40 }
      );

      expect(sqlOf(0)).not.toContain('DROP TABLE');
      const params = paramsOf(0);
      expect(params).toContain(hostile);
      expect(params).toContainEqual(['sale', 'return_restock']);
      expect(params.slice(-2)).toEqual([20, 40]);
    });

    it('should escape LIKE wildcards in the search term', async () => {
      await repository.listHistory({ search: '50%_off' }, { limit: 20, offset: 0 });

      expect(paramsOf(0)).toContain('%50\\%\\_off%');
    });

    it('should map a reservation row without a reason and with its own status', async () => {
      query.mockResolvedValue([
        {
          kind: 'reservation',
          id: 'r1',
          productId: 'p1',
          productVariantId: 'v1',
          sku: 'SKU-1',
          productName: 'Widget',
          locationId: null,
          sourceConnectionId: 'c1',
          reason: null,
          status: 'held',
          quantityDelta: 2,
          quantityBefore: null,
          quantityAfter: null,
          sourceKind: 'order',
          sourceRef: 'ol_order_1',
          operatorReason: null,
          note: null,
          actorUserId: null,
          refusalReason: null,
          refusalDetail: null,
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const [row] = await repository.listHistory({}, { limit: 20, offset: 0 });

      expect(row).toMatchObject({ kind: 'reservation', reason: null, status: 'held', quantityDelta: 2 });
      expect(row.occurredAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    });

    it('should read an unrecognised reason as null rather than passing it through', async () => {
      query.mockResolvedValue([
        { kind: 'movement', id: 'm1', reason: 'from_the_future', status: 'applied', occurredAt: new Date() },
      ]);

      const [row] = await repository.listHistory({}, { limit: 20, offset: 0 });

      expect(row.reason).toBeNull();
    });
  });

  describe('countHistory', () => {
    it('should count over the same union with the same parameters and no pagination', async () => {
      query.mockResolvedValue([{ total: 12 }]);

      await expect(repository.countHistory({ productVariantId: 'v1' })).resolves.toBe(12);

      expect(sqlOf(0)).toContain('COUNT(*)');
      expect(sqlOf(0)).toContain('UNION ALL');
      expect(paramsOf(0)).toEqual(['v1']);
    });

    it('should be zero without a query when the filters are provably empty', async () => {
      await expect(
        repository.countHistory({ kind: 'promised', reasons: ['sale'] })
      ).resolves.toBe(0);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('pruneOlderThan', () => {
    it('should delete only from the movement ledger, oldest first, bounded by the batch size', async () => {
      query.mockResolvedValue([[], 4]);
      const cutoff = new Date('2026-01-01T00:00:00Z');

      await expect(repository.pruneOlderThan(cutoff, 1000)).resolves.toBe(4);

      expect(sqlOf(0)).toContain('DELETE FROM "inventory_movements"');
      expect(sqlOf(0)).not.toContain('reservations');
      expect(sqlOf(0)).toContain('ORDER BY "occurredAt" ASC');
      expect(paramsOf(0)).toEqual([cutoff, 1000]);
    });

    it('should refuse a non-positive batch size', async () => {
      await expect(repository.pruneOlderThan(new Date(), 0)).rejects.toThrow(/positive integer/);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('attachQuantities', () => {
    it('should keep the requested delta and derive quantityBefore from the master result', async () => {
      query.mockResolvedValue([[], 1]);

      await expect(repository.attachQuantities('m1', 15)).resolves.toBe(true);

      expect(sqlOf(0)).toContain('"quantityBefore" = $2::integer - "quantityDelta"');
      expect(sqlOf(0)).not.toMatch(/"quantityDelta"\s*=/);
      expect(paramsOf(0)).toEqual(['m1', 15]);
    });
  });

  describe('history sourceLabel and needs-attention', () => {
    beforeEach(() => query.mockResolvedValue([]));

    it('should read the order number and the return external id through read-only joins', async () => {
      await repository.listHistory({}, { limit: 10, offset: 0 });

      const sql = sqlOf(0);
      expect(sql).toContain(`o."orderSnapshot"->>'orderNumber'`);
      expect(sql).toContain('rt."externalReturnId"');
      expect(sql).toContain('AS "sourceLabel"');
    });

    it('should treat a pending row older than five minutes as needing attention', async () => {
      await repository.listHistory({ needsAttention: true }, { limit: 10, offset: 0 });

      expect(sqlOf(0)).toContain(`m."status" = 'pending' AND m."createdAt" < now() - interval '5 minutes'`);
    });
  });

  describe('insertPending', () => {
    it('should return null when the idempotency key already exists', async () => {
      query.mockResolvedValue([]);

      await expect(
        repository.insertPending({
          productId: 'p1',
          productVariantId: 'v1',
          locationId: null,
          sourceConnectionId: 'c1',
          reason: 'manual_correction',
          quantityDelta: 3,
          sourceKind: 'operator',
          sourceRef: null,
          actorUserId: 'u1',
          operatorReason: 'found',
          note: null,
          idempotencyKey: 'key-1',
          occurredAt: new Date(),
        })
      ).resolves.toBeNull();

      expect(sqlOf(0)).toContain('ON CONFLICT ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL DO NOTHING');
    });
  });
});
