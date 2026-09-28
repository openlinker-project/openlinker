import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { OrderTagLimitReachedError } from '../../domain/exceptions/order-tag-limit-reached.error';
import { OrderTagNotFoundError } from '../../domain/exceptions/order-tag-not-found.error';
import type { OrderTagRepositoryPort } from '../../domain/ports/order-tag-repository.port';
import { ORDER_TAG_WORKSPACE_LIMIT, type OrderTag } from '../../domain/types/order-tag.types';
import { ORDER_TAG_REPOSITORY_TOKEN } from '../../orders.tokens';
import { OrderTagService } from './order-tag.service';

describe('OrderTagService', () => {
  let service: OrderTagService;
  let repository: jest.Mocked<OrderTagRepositoryPort>;

  const now = new Date('2026-01-15T10:00:00Z');
  const vipTag: OrderTag = { id: 'tag-1', name: 'VIP', color: 'blue', createdAt: now, updatedAt: now };

  beforeEach(async () => {
    const mockRepository: jest.Mocked<OrderTagRepositoryPort> = {
      findAllWithCounts: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findTagIdsForOrder: jest.fn(),
      findTagIdsForOrders: jest.fn(),
      assign: jest.fn(),
      unassign: jest.fn(),
      bulkAssign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderTagService, { provide: ORDER_TAG_REPOSITORY_TOKEN, useValue: mockRepository }],
    }).compile();

    service = module.get(OrderTagService);
    repository = module.get(ORDER_TAG_REPOSITORY_TOKEN);
  });

  describe('create (D34)', () => {
    it('should create a tag when the workspace is under the limit', async () => {
      repository.count.mockResolvedValue(ORDER_TAG_WORKSPACE_LIMIT - 1);
      repository.create.mockResolvedValue(vipTag);

      const result = await service.create('VIP', 'blue');

      expect(repository.create).toHaveBeenCalledWith({ name: 'VIP', color: 'blue' });
      expect(result).toBe(vipTag);
    });

    it('should refuse a create at exactly the workspace limit', async () => {
      repository.count.mockResolvedValue(ORDER_TAG_WORKSPACE_LIMIT);

      await expect(service.create('One too many', 'amber')).rejects.toThrow(
        OrderTagLimitReachedError,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('should assign when the tag exists', async () => {
      repository.findById.mockResolvedValue(vipTag);

      await service.assign('tag-1', 'ol_order_1', 'user-1');

      expect(repository.assign).toHaveBeenCalledWith('tag-1', 'ol_order_1', 'user-1');
    });

    it('should throw OrderTagNotFoundError for an unknown tag', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.assign('missing', 'ol_order_1', 'user-1')).rejects.toThrow(
        OrderTagNotFoundError,
      );
      expect(repository.assign).not.toHaveBeenCalled();
    });
  });

  describe('bulkAssign', () => {
    it('should throw OrderTagNotFoundError before delegating for an unknown tag', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.bulkAssign('missing', ['ol_order_1', 'ol_order_2'], 'user-1'),
      ).rejects.toThrow(OrderTagNotFoundError);
      expect(repository.bulkAssign).not.toHaveBeenCalled();
    });

    it('should delegate to the repository and pass the result through', async () => {
      repository.findById.mockResolvedValue(vipTag);
      repository.bulkAssign.mockResolvedValue({ tagId: 'tag-1', added: 2, alreadyTagged: 1 });

      const result = await service.bulkAssign(
        'tag-1',
        ['ol_order_1', 'ol_order_2', 'ol_order_3'],
        'user-1',
      );

      expect(repository.bulkAssign).toHaveBeenCalledWith(
        'tag-1',
        ['ol_order_1', 'ol_order_2', 'ol_order_3'],
        'user-1',
      );
      expect(result).toEqual({ tagId: 'tag-1', added: 2, alreadyTagged: 1 });
    });
  });

  describe('delete', () => {
    it('should throw OrderTagNotFoundError for a missing tag', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(OrderTagNotFoundError);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});
