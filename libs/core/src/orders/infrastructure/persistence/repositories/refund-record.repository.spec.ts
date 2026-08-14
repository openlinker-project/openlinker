import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';

import { RefundRecordOrmEntity } from '../entities/refund-record.orm-entity';
import { DuplicateRefundRecordException } from '../../../domain/exceptions/duplicate-refund-record.exception';
import { RefundRecordRepository } from './refund-record.repository';
import type { CreateRefundRecordInput } from '../../../domain/types/refund-record.types';

type MockQueryBuilder = {
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  groupBy: jest.Mock;
  getRawMany: jest.Mock;
};

describe('RefundRecordRepository', () => {
  let repository: RefundRecordRepository;
  let ormRepository: jest.Mocked<Repository<RefundRecordOrmEntity>>;
  let queryBuilder: MockQueryBuilder;

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      groupBy: jest.fn(),
      getRawMany: jest.fn(),
    };
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.addSelect.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.groupBy.mockReturnValue(queryBuilder);

    const mockOrmRepository = {
      save: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundRecordRepository,
        {
          provide: getRepositoryToken(RefundRecordOrmEntity),
          useValue: mockOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<RefundRecordRepository>(RefundRecordRepository);
    ormRepository = module.get(getRepositoryToken(RefundRecordOrmEntity));
  });

  describe('create', () => {
    it('should map input to an ORM entity, save it, and return the mapped domain entity', async () => {
      const input: CreateRefundRecordInput = {
        internalOrderId: 'ol_order_abc123',
        amount: '49.99',
        currency: 'PLN',
        reason: 'withdrawal',
        note: 'buyer withdrew',
        recordedAt: new Date('2026-01-15T10:00:00Z'),
      };
      const savedOrmEntity: Partial<RefundRecordOrmEntity> = {
        id: 'a1b2c3d4-0000-0000-0000-000000000000',
        internalOrderId: input.internalOrderId,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
        note: input.note,
        recordedAt: input.recordedAt,
        createdAt: new Date('2026-01-15T10:00:01Z'),
        updatedAt: new Date('2026-01-15T10:00:01Z'),
      };
      ormRepository.save.mockResolvedValue(savedOrmEntity as RefundRecordOrmEntity);

      const result = await repository.create(input);

      expect(ormRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          internalOrderId: input.internalOrderId,
          amount: input.amount,
          currency: input.currency,
          reason: input.reason,
          note: input.note,
          recordedAt: input.recordedAt,
        }),
      );
      expect(result.id).toBe(savedOrmEntity.id);
      expect(result.internalOrderId).toBe(input.internalOrderId);
    });

    it('should convert a unique-violation on the idempotency index into DuplicateRefundRecordException', async () => {
      const input: CreateRefundRecordInput = {
        internalOrderId: 'ol_order_abc123',
        amount: '49.99',
        currency: 'PLN',
        reason: 'withdrawal',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
        idempotencyKey: 'retry-key-1',
      };
      ormRepository.save.mockRejectedValue(
        new QueryFailedError(
          '',
          undefined,
          new Error(
            'duplicate key value violates unique constraint "UQ_refund_records_order_idempotency"',
          ),
        ),
      );

      await expect(repository.create(input)).rejects.toBeInstanceOf(DuplicateRefundRecordException);
    });

    it('should rethrow a non-duplicate query failure unchanged', async () => {
      const input: CreateRefundRecordInput = {
        internalOrderId: 'ol_order_abc123',
        amount: '49.99',
        currency: 'PLN',
        reason: 'withdrawal',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
      };
      const other = new QueryFailedError('', undefined, new Error('connection reset'));
      ormRepository.save.mockRejectedValue(other);

      await expect(repository.create(input)).rejects.toBe(other);
    });
  });

  describe('findByOrderId', () => {
    it('should return refunds ordered by recordedAt descending', async () => {
      ormRepository.find.mockResolvedValue([]);

      await repository.findByOrderId('ol_order_abc123');

      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { internalOrderId: 'ol_order_abc123' },
        order: { recordedAt: 'DESC' },
      });
    });

    it('should fall back to "other" and warn when a row holds an unrecognised reason', async () => {
      const row: Partial<RefundRecordOrmEntity> = {
        id: 'a1b2c3d4-0000-0000-0000-000000000002',
        internalOrderId: 'ol_order_abc123',
        amount: '10.00',
        currency: 'PLN',
        reason: 'some_future_reason_not_in_the_union',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
        createdAt: new Date('2026-01-15T10:00:00Z'),
        updatedAt: new Date('2026-01-15T10:00:00Z'),
        idempotencyKey: null,
      };
      ormRepository.find.mockResolvedValue([row as RefundRecordOrmEntity]);

      const [result] = await repository.findByOrderId('ol_order_abc123');

      expect(result.reason).toBe('other');
    });

    it('should preserve a recognised reason unchanged', async () => {
      const row: Partial<RefundRecordOrmEntity> = {
        id: 'a1b2c3d4-0000-0000-0000-000000000003',
        internalOrderId: 'ol_order_abc123',
        amount: '10.00',
        currency: 'PLN',
        reason: 'defective',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
        createdAt: new Date('2026-01-15T10:00:00Z'),
        updatedAt: new Date('2026-01-15T10:00:00Z'),
        idempotencyKey: null,
      };
      ormRepository.find.mockResolvedValue([row as RefundRecordOrmEntity]);

      const [result] = await repository.findByOrderId('ol_order_abc123');

      expect(result.reason).toBe('defective');
    });
  });

  describe('summarizeByOrderIds', () => {
    it('should return an empty map without querying when the input is empty', async () => {
      const result = await repository.summarizeByOrderIds([]);

      expect(result.size).toBe(0);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should build a grouped aggregate query and map raw rows into the summary map', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { internalOrderId: 'ol_order_abc123', count: '2', totalAmount: '69.98', currency: 'PLN' },
      ]);

      const result = await repository.summarizeByOrderIds(['ol_order_abc123', 'ol_order_def456']);

      expect(ormRepository.createQueryBuilder).toHaveBeenCalledWith('record');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'record.internalOrderId IN (:...internalOrderIds)',
        { internalOrderIds: ['ol_order_abc123', 'ol_order_def456'] },
      );
      expect(result.get('ol_order_abc123')).toEqual({
        count: 2,
        totalAmount: '69.98',
        currency: 'PLN',
      });
      expect(result.has('ol_order_def456')).toBe(false);
    });
  });
});
