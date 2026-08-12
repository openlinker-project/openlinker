import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { RefundRecordOrmEntity } from '../entities/refund-record.orm-entity';
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
