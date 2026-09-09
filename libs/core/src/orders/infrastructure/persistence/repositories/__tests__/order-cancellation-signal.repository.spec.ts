/**
 * Order Cancellation Signal Repository Unit Tests (#2069)
 *
 * `record()` asserts the exact `INSERT ... ON CONFLICT DO NOTHING` statement
 * against a mocked `Repository.query` — mirrors
 * `OrderRecordRepository.markCancelled`'s own test style.
 *
 * `consume()` asserts against a mocked QueryBuilder chain instead, matching
 * `OrderHoldRepository.releaseHeld`'s test style — deliberately NOT
 * `Repository.query`, because a raw `DELETE ... RETURNING` through that path
 * returns `[rows, rowCount]`, not `rows` directly, and a mock built the naive
 * way would have hidden exactly the bug (#2069, found only by a real Postgres
 * round-trip) that `consume()` no longer has.
 *
 * The database-level guarantee (the unique index, first-write-wins) is
 * asserted against real Postgres in
 * `apps/api/test/integration/orders/order-early-cancellation-signal.int-spec.ts`.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';
import { OrderCancellationSignalRepository } from '../order-cancellation-signal.repository';
import type { OrderCancellationSignalOrmEntity } from '../../entities/order-cancellation-signal.orm-entity';

/** A chainable QueryBuilder stub whose `execute` resolves the given raw rows. */
interface StubDeleteBuilder {
  delete: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  returning: jest.Mock;
  execute: jest.Mock;
}

const stubDeleteBuilder = (raw: Array<{ cancelledAt: Date }>): StubDeleteBuilder => {
  const builder: StubDeleteBuilder = {
    delete: jest.fn(() => builder),
    from: jest.fn(() => builder),
    where: jest.fn(() => builder),
    returning: jest.fn(() => builder),
    execute: jest.fn().mockResolvedValue({ raw, affected: raw.length }),
  };
  return builder;
};

describe('OrderCancellationSignalRepository', () => {
  let repository: OrderCancellationSignalRepository;
  let ormRepository: jest.Mocked<
    Pick<Repository<OrderCancellationSignalOrmEntity>, 'query' | 'createQueryBuilder'>
  >;

  beforeEach(() => {
    ormRepository = {
      query: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    repository = new OrderCancellationSignalRepository(
      ormRepository as unknown as Repository<OrderCancellationSignalOrmEntity>
    );
  });

  describe('record', () => {
    it('should issue an ON CONFLICT DO NOTHING insert with the given values', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);
      const cancelledAt = new Date('2026-08-11T09:00:00Z');

      await repository.record('conn-1', 'ext-order-1', cancelledAt);

      expect(ormRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT ("sourceConnectionId", "externalOrderId") DO NOTHING'),
        ['conn-1', 'ext-order-1', cancelledAt]
      );
      expect(ormRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "order_cancellation_signals"'),
        expect.anything()
      );
    });

    it('should not throw when a redelivered cancel event collides with an existing signal', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await expect(
        repository.record('conn-1', 'ext-order-1', new Date())
      ).resolves.toBeUndefined();
    });
  });

  describe('consume', () => {
    it('should return the recorded instant when a signal exists, reading it off result.raw (not query()\'s [rows, rowCount] tuple)', async () => {
      const cancelledAt = new Date('2026-08-11T09:00:00Z');
      const builder = stubDeleteBuilder([{ cancelledAt }]);
      ormRepository.createQueryBuilder.mockReturnValue(builder as never);

      const result = await repository.consume('conn-1', 'ext-order-1');

      expect(result).toEqual(cancelledAt);
      expect(builder.delete).toHaveBeenCalled();
      expect(builder.from).toHaveBeenCalledWith(expect.anything());
      expect(builder.where).toHaveBeenCalledWith(
        expect.stringContaining('"sourceConnectionId" = :sourceConnectionId'),
        { sourceConnectionId: 'conn-1', externalOrderId: 'ext-order-1' }
      );
      expect(builder.returning).toHaveBeenCalledWith('"cancelledAt"');
    });

    it('should return null when no signal exists for the pair', async () => {
      const builder = stubDeleteBuilder([]);
      ormRepository.createQueryBuilder.mockReturnValue(builder as never);

      const result = await repository.consume('conn-1', 'ext-order-1');

      expect(result).toBeNull();
    });

    // Regression guard for #2069's actual bug: a naive mock of
    // `Repository.query` resolving `[{cancelledAt}]` directly would pass even
    // though `consume()` no longer calls `query()` at all — this asserts the
    // QueryBuilder path is what's actually exercised.
    it('should never call the raw Repository.query for the delete', async () => {
      const builder = stubDeleteBuilder([{ cancelledAt: new Date() }]);
      ormRepository.createQueryBuilder.mockReturnValue(builder as never);

      await repository.consume('conn-1', 'ext-order-1');

      expect(ormRepository.query).not.toHaveBeenCalled();
    });
  });
});
