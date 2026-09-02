/**
 * Order Change Repository Unit Tests
 *
 * Covers the read-path vocabulary coercion: a stored `kind` or `status` this
 * build does not recognise must surface as the DOMAIN
 * `OrderChangeVocabularyError`, not a bare `Error`, so a Wave-2 caller can
 * discriminate it from any other read failure rather than taking a 500
 * (`docs/engineering-standards.md § Repository Error Handling`).
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';
import { OrderChangeRepository } from '../order-change.repository';
import { OrderChangeOrmEntity } from '../../entities/order-change.orm-entity';
import { OrderChangeVocabularyError } from '../../../../domain/exceptions/order-change-vocabulary.error';

describe('OrderChangeRepository', () => {
  let ormRepository: jest.Mocked<Repository<OrderChangeOrmEntity>>;
  let repository: OrderChangeRepository;

  const buildRow = (
    overrides: Partial<OrderChangeOrmEntity> = {}
  ): OrderChangeOrmEntity => {
    const entity = new OrderChangeOrmEntity();
    entity.id = 'change-1';
    entity.internalOrderId = 'ol_order_1';
    entity.kind = 'return.decline';
    entity.targetRef = 'ol_return_1';
    entity.status = 'requested';
    entity.payload = null;
    entity.requestedBy = null;
    entity.requestedAt = new Date('2026-01-01T00:00:00Z');
    entity.confirmedBy = null;
    entity.terminalisedAt = null;
    entity.declinedReason = null;
    entity.appliedAt = null;
    entity.createdAt = new Date('2026-01-01T00:00:00Z');
    entity.updatedAt = new Date('2026-01-01T00:00:00Z');
    return Object.assign(entity, overrides);
  };

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<OrderChangeOrmEntity>>;
    repository = new OrderChangeRepository(ormRepository);
  });

  describe('vocabulary coercion on read', () => {
    it('should map a well-formed row onto the domain entity', async () => {
      ormRepository.findOne.mockResolvedValue(buildRow());

      const change = await repository.findOpenByTarget('ol_order_1', 'ol_return_1');

      expect(change?.id).toBe('change-1');
      expect(change?.kind).toBe('return.decline');
      expect(change?.status).toBe('requested');
      // The column records when the proposal was ANSWERED, whatever the answer.
      expect(change?.terminalisedAt).toBeNull();
    });

    it('should throw OrderChangeVocabularyError for an unrecognised kind', async () => {
      ormRepository.findOne.mockResolvedValue(buildRow({ kind: 'order.teleport' }));

      await expect(
        repository.findOpenByTarget('ol_order_1', 'ol_return_1')
      ).rejects.toBeInstanceOf(OrderChangeVocabularyError);
    });

    it('should throw OrderChangeVocabularyError for an unrecognised status', async () => {
      ormRepository.findOne.mockResolvedValue(buildRow({ status: 'pondering' }));

      await expect(
        repository.findOpenByTarget('ol_order_1', 'ol_return_1')
      ).rejects.toMatchObject({
        name: 'OrderChangeVocabularyError',
        field: 'status',
        value: 'pondering',
        orderChangeId: 'change-1',
      });
    });

    it('should return null rather than coercing when no row matches', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.findOpenByTarget('ol_order_1', 'ol_return_1')
      ).resolves.toBeNull();
    });
  });
});
