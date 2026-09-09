/**
 * Order Cancellation Signal Repository Unit Tests (#2069)
 *
 * Asserts the exact SQL text and parameter order both methods issue against
 * a mocked `Repository.query` — mirrors
 * `OrderRecordRepository.markCancelled`'s own test style. The database-level
 * guarantee (the unique index, first-write-wins) is asserted against real
 * Postgres in
 * `apps/api/test/integration/orders/order-early-cancellation-signal.int-spec.ts`.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';
import { OrderCancellationSignalRepository } from '../order-cancellation-signal.repository';
import type { OrderCancellationSignalOrmEntity } from '../../entities/order-cancellation-signal.orm-entity';

describe('OrderCancellationSignalRepository', () => {
  let repository: OrderCancellationSignalRepository;
  let ormRepository: jest.Mocked<Pick<Repository<OrderCancellationSignalOrmEntity>, 'query'>>;

  beforeEach(() => {
    ormRepository = {
      query: jest.fn(),
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
    it('should issue a DELETE ... RETURNING and return the recorded instant when a signal exists', async () => {
      const cancelledAt = new Date('2026-08-11T09:00:00Z');
      (ormRepository.query as jest.Mock).mockResolvedValue([{ cancelledAt }]);

      const result = await repository.consume('conn-1', 'ext-order-1');

      expect(result).toEqual(cancelledAt);
      expect(ormRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "order_cancellation_signals"'),
        ['conn-1', 'ext-order-1']
      );
      expect(ormRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('RETURNING "cancelledAt"'),
        expect.anything()
      );
    });

    it('should return null when no signal exists for the pair', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      const result = await repository.consume('conn-1', 'ext-order-1');

      expect(result).toBeNull();
    });
  });
});
