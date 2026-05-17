/**
 * Bulk Offer Creation Batch Domain Entity — Unit Tests
 *
 * @module libs/core/src/listings/domain/entities
 */
import { BulkOfferCreationBatch } from './bulk-offer-creation-batch.entity';
import type { BulkBatchStatus } from '../types/bulk-offer-creation-batch.types';

describe('BulkOfferCreationBatch', () => {
  it('should preserve all constructor fields', () => {
    const now = new Date('2026-05-17T10:00:00Z');
    const sharedConfig = { publishImmediately: true, shippingRatePackageId: 'pkg-1' };

    const batch = new BulkOfferCreationBatch(
      'batch-uuid',
      'conn-uuid',
      'user-1',
      'pending' as BulkBatchStatus,
      10,
      0,
      0,
      sharedConfig,
      now,
      now,
    );

    expect(batch.id).toBe('batch-uuid');
    expect(batch.connectionId).toBe('conn-uuid');
    expect(batch.initiatedBy).toBe('user-1');
    expect(batch.status).toBe('pending');
    expect(batch.totalCount).toBe(10);
    expect(batch.succeededCount).toBe(0);
    expect(batch.failedCount).toBe(0);
    expect(batch.sharedConfig).toBe(sharedConfig);
    expect(batch.createdAt).toBe(now);
    expect(batch.updatedAt).toBe(now);
  });
});
