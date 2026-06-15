/**
 * Shop Product Publish Handler — unit spec
 *
 * Covers payload validation (schemaVersion / variant / stock / status),
 * delegation to the execution service, and outcome passthrough.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';

import { ShopProductPublishHandler } from '../shop-product-publish.handler';

const CONN = 'conn-shop-1';

function createJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'shop.product.publish',
    connectionId: CONN,
    payload: payload as Record<string, unknown>,
    status: 'running',
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SyncJob;
}

const validPayload = {
  schemaVersion: 1,
  internalVariantId: 'ol_variant_aaaa',
  status: 'published',
  stock: 5,
};

describe('ShopProductPublishHandler', () => {
  let execution: { executePublish: jest.Mock };
  let handler: ShopProductPublishHandler;

  beforeEach(() => {
    execution = {
      executePublish: jest.fn().mockResolvedValue({
        listingCreationRecord: { id: 'rec-1', status: 'published', externalProductId: 'wc-1' },
        outcome: 'ok',
      }),
    };
    handler = new ShopProductPublishHandler(execution as never);
  });

  it('should delegate a valid payload to the execution service and return its outcome', async () => {
    const result = await handler.execute(createJob(validPayload));

    expect(execution.executePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        internalVariantId: 'ol_variant_aaaa',
        connectionId: CONN,
        stock: 5,
        status: 'published',
      })
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should pass through a business_failure outcome', async () => {
    execution.executePublish.mockResolvedValue({
      listingCreationRecord: { id: 'rec-1', status: 'failed', externalProductId: null },
      outcome: 'business_failure',
    });
    const result = await handler.execute(createJob(validPayload));
    expect(result).toEqual({ outcome: 'business_failure' });
  });

  it.each([
    ['unsupported schemaVersion', { ...validPayload, schemaVersion: 2 }],
    ['missing internalVariantId', { ...validPayload, internalVariantId: '' }],
    ['invalid stock', { ...validPayload, stock: -1 }],
    ['invalid status', { ...validPayload, status: 'active' }],
  ])('should reject %s', async (_label, payload) => {
    await expect(handler.execute(createJob(payload))).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(execution.executePublish).not.toHaveBeenCalled();
  });

  it('should wrap a transient execution error as SyncJobExecutionError', async () => {
    execution.executePublish.mockRejectedValue(new Error('redis down'));
    await expect(handler.execute(createJob(validPayload))).rejects.toBeInstanceOf(
      SyncJobExecutionError
    );
  });
});
