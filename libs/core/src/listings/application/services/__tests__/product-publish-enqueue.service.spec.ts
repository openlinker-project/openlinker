/**
 * Product Publish Enqueue Service — unit spec
 *
 * Covers capability validation, pre-create of the pending record, V1 (single)
 * vs V2 (bulk) payload emission, and idempotency-key defaults.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import { ProductPublishEnqueueService } from '../product-publish-enqueue.service';

const CONN = 'conn-shop-1';
const VARIANT = 'ol_variant_aaaa';

function makeRecord(id = 'rec-1', bulkBatchId: string | null = null): ListingCreationRecord {
  return new ListingCreationRecord(
    id,
    VARIANT,
    CONN,
    null,
    'pending',
    null,
    new Date(),
    new Date(),
    bulkBatchId,
  );
}

describe('ProductPublishEnqueueService', () => {
  let integrations: { getCapabilityAdapter: jest.Mock };
  let records: { create: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let service: ProductPublishEnqueueService;

  const input = {
    connectionId: CONN,
    internalVariantId: VARIANT,
    status: 'published' as const,
    stock: 5,
  };

  beforeEach(() => {
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ publishProduct: jest.fn() }),
    };
    records = { create: jest.fn().mockResolvedValue(makeRecord()) };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1' }) };
    service = new ProductPublishEnqueueService(
      integrations as never,
      records as never,
      jobEnqueue as never,
    );
  });

  it('should validate ProductPublisher, pre-create a pending record, and enqueue a V1 job', async () => {
    const result = await service.enqueuePublish(input);

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONN, 'ProductPublisher');
    expect(records.create).toHaveBeenCalledWith(
      expect.objectContaining({
        internalVariantId: VARIANT,
        connectionId: CONN,
        status: 'pending',
      }),
    );
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'shop.product.publish',
        connectionId: CONN,
        idempotencyKey: 'shop-publish:rec-1',
        payload: expect.objectContaining({ schemaVersion: 1, listingCreationRecordId: 'rec-1' }),
      }),
    );
    expect(result).toEqual({
      jobId: 'job-1',
      listingCreationRecord: expect.objectContaining({ id: 'rec-1' }),
    });
  });

  it('should emit a V2 payload + batch-scoped idempotency key when bulkBatchId is present', async () => {
    records.create.mockResolvedValue(makeRecord('rec-9', 'batch-1'));

    await service.enqueuePublish({ ...input, bulkBatchId: 'batch-1' });

    expect(records.create).toHaveBeenCalledWith(
      expect.objectContaining({ bulkBatchId: 'batch-1' }),
    );
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `bulk-publish:batch-1:variant:${VARIANT}`,
        payload: expect.objectContaining({
          schemaVersion: 2,
          bulkBatchId: 'batch-1',
          listingCreationRecordId: 'rec-9',
        }),
      }),
    );
  });

  it('should honour an explicit idempotency key', async () => {
    await service.enqueuePublish({ ...input, idempotencyKey: 'custom-key' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'custom-key' }),
    );
  });

  it('should propagate a capability resolution failure (no record, no enqueue)', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('capability not supported'));
    await expect(service.enqueuePublish(input)).rejects.toThrow('capability not supported');
    expect(records.create).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });
});
