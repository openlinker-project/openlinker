/**
 * Shop Publish Controllers — unit spec
 *
 * Thin-wrapper behaviour: delegation, response mapping, and 404/400 mapping for
 * the single (`ShopPublishController`) and bulk (`BulkShopPublishController`)
 * shop-publish endpoints.
 *
 * @module apps/api/src/listings/http
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EmptyBulkSubmissionException } from '@openlinker/core/listings';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { ShopPublishController } from './shop-publish.controller';
import { BulkShopPublishController } from './bulk-shop-publish.controller';

const CONN = 'conn-1';
const USER = { id: 'user-1' } as AuthenticatedUser;

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rec-1',
    internalVariantId: 'ol_variant_aaaa',
    connectionId: CONN,
    status: 'published',
    externalProductId: 'wc-1',
    bulkBatchId: null,
    errors: null,
    createdAt: new Date('2026-06-16T00:00:00Z'),
    updatedAt: new Date('2026-06-16T00:00:00Z'),
    ...over,
  };
}

describe('ShopPublishController', () => {
  let enqueue: { enqueuePublish: jest.Mock };
  let query: { getById: jest.Mock };
  let controller: ShopPublishController;

  beforeEach(() => {
    enqueue = {
      enqueuePublish: jest
        .fn()
        .mockResolvedValue({ jobId: 'job-1', listingCreationRecord: { id: 'rec-1' } }),
    };
    query = { getById: jest.fn() };
    controller = new ShopPublishController(enqueue as never, query as never);
  });

  it('should enqueue a publish and return job + record ids', async () => {
    const result = await controller.publish(
      CONN,
      { internalVariantId: 'ol_variant_aaaa', status: 'published', stock: 7 } as never,
      'idem-1',
    );
    expect(enqueue.enqueuePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: CONN,
        internalVariantId: 'ol_variant_aaaa',
        idempotencyKey: 'idem-1',
      }),
    );
    expect(result).toEqual({ jobId: 'job-1', listingCreationRecordId: 'rec-1' });
  });

  it('should return a serialised record on status read', async () => {
    query.getById.mockResolvedValue(record());
    const dto = await controller.getRecord('rec-1');
    expect(dto).toMatchObject({
      id: 'rec-1',
      status: 'published',
      externalProductId: 'wc-1',
      createdAt: '2026-06-16T00:00:00.000Z',
    });
  });

  it('should 404 when the record is unknown', async () => {
    query.getById.mockResolvedValue(null);
    await expect(controller.getRecord('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BulkShopPublishController', () => {
  let bulkSubmit: { submit: jest.Mock; getBatch: jest.Mock };
  let controller: BulkShopPublishController;

  beforeEach(() => {
    bulkSubmit = {
      submit: jest.fn().mockResolvedValue({ batchId: 'batch-1', items: [] }),
      getBatch: jest.fn(),
    };
    controller = new BulkShopPublishController(bulkSubmit as never);
  });

  it('should submit a bulk batch stamping initiatedBy from the session', async () => {
    const result = await controller.submit(
      {
        connectionId: CONN,
        internalVariantIds: ['ol_variant_a'],
        status: 'draft',
        stock: 1,
      } as never,
      USER,
    );
    expect(bulkSubmit.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: CONN,
        initiatedBy: 'user-1',
        internalVariantIds: ['ol_variant_a'],
      }),
    );
    expect(result).toEqual({ batchId: 'batch-1', items: [] });
  });

  it('should map EmptyBulkSubmissionException to 400', async () => {
    bulkSubmit.submit.mockRejectedValue(new EmptyBulkSubmissionException());
    await expect(
      controller.submit(
        { connectionId: CONN, internalVariantIds: [], status: 'draft', stock: 1 } as never,
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should return a batch summary DTO', async () => {
    bulkSubmit.getBatch.mockResolvedValue({
      batch: {
        id: 'batch-1',
        connectionId: CONN,
        status: 'partially-failed',
        totalCount: 2,
        succeededCount: 1,
        failedCount: 1,
        createdAt: new Date('2026-06-16T00:00:00Z'),
        updatedAt: new Date('2026-06-16T00:00:00Z'),
      },
      records: [record()],
    });
    const dto = await controller.getBatch('batch-1');
    expect(dto).toMatchObject({
      id: 'batch-1',
      status: 'partially-failed',
      totalCount: 2,
      succeededCount: 1,
      failedCount: 1,
    });
    expect(dto.records).toHaveLength(1);
  });

  it('should 404 on an unknown batch', async () => {
    bulkSubmit.getBatch.mockResolvedValue(null);
    await expect(controller.getBatch('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
