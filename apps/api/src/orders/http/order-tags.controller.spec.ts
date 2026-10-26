/**
 * Order Tags Controller Tests - bulk routes (#3545)
 *
 * @module apps/api/src/orders/http
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotFoundException } from '@nestjs/common';
import { OrderTagNotFoundError, type IOrderTagService } from '@openlinker/core/orders';
import { BulkAssignOrderTagDto } from './dto/create-order-tag.dto';
import { OrderTagsController } from './order-tags.controller';

const user = { id: 'user-1', role: 'operator' } as never;

describe('OrderTagsController bulk routes (#3545)', () => {
  let service: { bulkAssign: jest.Mock; bulkUnassign: jest.Mock };
  let controller: OrderTagsController;

  beforeEach(() => {
    service = { bulkAssign: jest.fn(), bulkUnassign: jest.fn() };
    controller = new OrderTagsController(service as unknown as IOrderTagService);
  });

  it('should keep the legacy counts and add a per-row results array on bulk-assign', async () => {
    service.bulkAssign.mockResolvedValue({
      tagId: 't1',
      added: 1,
      alreadyTagged: 1,
      addedOrderIds: ['a'],
      alreadyTaggedOrderIds: ['b'],
    });

    const res = await controller.bulkAssign('t1', user, { orderIds: ['a', 'b', 'a'] });

    expect(service.bulkAssign).toHaveBeenCalledWith('t1', ['a', 'b'], 'user-1');
    expect(res).toEqual({
      tagId: 't1',
      added: 1,
      alreadyTagged: 1,
      failed: 0,
      results: [
        { orderId: 'a', outcome: 'added' },
        { orderId: 'b', outcome: 'already-tagged' },
      ],
    });
  });

  it('should report removed and not-tagged rows on bulk-remove', async () => {
    service.bulkUnassign.mockResolvedValue({
      tagId: 't1',
      removedOrderIds: ['a'],
      notTaggedOrderIds: ['b'],
    });

    const res = await controller.bulkRemove('t1', { orderIds: ['a', 'b'] });

    expect(res).toEqual({
      tagId: 't1',
      removed: 1,
      notTagged: 1,
      failed: 0,
      results: [
        { orderId: 'a', outcome: 'removed' },
        { orderId: 'b', outcome: 'not-tagged' },
      ],
    });
  });

  it('should answer 404 for an unknown tag on both routes', async () => {
    service.bulkAssign.mockRejectedValue(new OrderTagNotFoundError('x'));
    service.bulkUnassign.mockRejectedValue(new OrderTagNotFoundError('x'));

    await expect(controller.bulkAssign('x', user, { orderIds: ['a'] })).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(controller.bulkRemove('x', { orderIds: ['a'] })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('should fail every row with a PII-free reason on an unexpected error', async () => {
    service.bulkUnassign.mockRejectedValue(new Error('pg: password authentication failed'));

    const res = await controller.bulkRemove('t1', { orderIds: ['a', 'b'] });

    expect(res.failed).toBe(2);
    expect(res.results.every((r) => r.outcome === 'failed')).toBe(true);
    expect(JSON.stringify(res)).not.toContain('password');
  });

  it('should reject more than 100 order ids', async () => {
    const dto = plainToInstance(BulkAssignOrderTagDto, {
      orderIds: Array.from({ length: 101 }, (_, i) => `o${i}`),
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('should keep both bulk routes admin/operator', () => {
    const roles = (name: 'bulkAssign' | 'bulkRemove'): unknown =>
      Reflect.getMetadata('roles', OrderTagsController.prototype[name]);
    expect(roles('bulkAssign')).toEqual(['admin', 'operator']);
    expect(roles('bulkRemove')).toEqual(['admin', 'operator']);
  });
});
