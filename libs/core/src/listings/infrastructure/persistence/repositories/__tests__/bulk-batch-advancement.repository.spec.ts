/**
 * Bulk Batch Advancement Repository — unit spec
 *
 * Guards the #1084 fix: `markAdvancedIfNotExists` must derive `created` from the
 * RETURNING rows (`result.raw`), not `result.identifiers` (which echoes the
 * input composite PK and is always non-empty). Mocks the TypeORM insert
 * query-builder chain so the signal logic is verified without a database.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';

import { BulkBatchAdvancementRepository } from '../bulk-batch-advancement.repository';
import type { BulkBatchAdvancementOrmEntity } from '../../entities/bulk-batch-advancement.orm-entity';

/**
 * Build a repo whose `createQueryBuilder().insert().values().orIgnore().execute()`
 * resolves to a TypeORM `InsertResult`-shaped object with the given `raw` rows
 * and a (deliberately always-populated) `identifiers` array — mirroring how
 * TypeORM echoes the input PK regardless of the conflict outcome.
 */
function makeRepo(rawRows: unknown[]): {
  repo: BulkBatchAdvancementRepository;
  execute: jest.Mock;
  values: jest.Mock;
} {
  const execute = jest.fn().mockResolvedValue({
    raw: rawRows,
    // Always non-empty — the trap the #1084 fix avoids relying on.
    identifiers: [{ bulkBatchId: 'b', offerCreationRecordId: 'r' }],
  });
  const values = jest.fn().mockReturnThis();
  const builder = {
    insert: jest.fn().mockReturnThis(),
    values,
    orIgnore: jest.fn().mockReturnThis(),
    execute,
  };
  const ormRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(builder),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  } as unknown as Repository<BulkBatchAdvancementOrmEntity>;

  return {
    repo: new BulkBatchAdvancementRepository(ormRepository),
    execute,
    values,
  };
}

describe('BulkBatchAdvancementRepository', () => {
  describe('markAdvancedIfNotExists', () => {
    it('should report created=true when the insert returns a row (fresh advance)', async () => {
      const { repo } = makeRepo([{ bulkBatchId: 'b', offerCreationRecordId: 'r' }]);
      await expect(repo.markAdvancedIfNotExists('b', 'r', 'succeeded')).resolves.toEqual({
        created: true,
      });
    });

    it('should report created=false when ON CONFLICT returns no row (duplicate advance)', async () => {
      const { repo } = makeRepo([]);
      await expect(repo.markAdvancedIfNotExists('b', 'r', 'succeeded')).resolves.toEqual({
        created: false,
      });
    });

    it('should report created=false (not throw) when raw is undefined', async () => {
      // TypeORM leaves `raw` undefined on the empty-valueSet early-return path;
      // the Array.isArray guard must treat that as "not created", not crash.
      const { repo } = makeRepo(undefined as unknown as unknown[]);
      await expect(repo.markAdvancedIfNotExists('b', 'r', 'succeeded')).resolves.toEqual({
        created: false,
      });
    });
  });
  describe('markAdvancedIfNotExists outcome (E2E-21)', () => {
    it('should store the outcome on the advancement row', async () => {
      const { repo, values } = makeRepo([{ bulkBatchId: 'b', offerCreationRecordId: 'r' }]);

      await repo.markAdvancedIfNotExists('b', 'r', 'failed');

      expect(values).toHaveBeenCalledWith({
        bulkBatchId: 'b',
        offerCreationRecordId: 'r',
        outcome: 'failed',
      });
    });
  });
});
