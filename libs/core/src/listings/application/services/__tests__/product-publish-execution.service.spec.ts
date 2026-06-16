/**
 * Product Publish Execution Service — unit spec
 *
 * Covers the orchestration policy against a **fake** `ShopProductManagerPort`:
 * happy create, upsert (existing mapping → externalProductId set, no new
 * mapping), shop rejection → `business_failure`, builder validation →
 * `business_failure`, and idempotent mapping (DuplicateIdentifierMappingError
 * swallowed).
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import { ProductPublishRejectedException } from '@openlinker/core/listings';

import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import { ProductPublishBuilderValidationException } from '../../../domain/exceptions/product-publish-builder-validation.exception';
import type { ListingCreationStatus } from '../../../domain/types/listing-creation-record.types';
import { ProductPublishExecutionService } from '../product-publish-execution.service';

const CONN = 'conn-shop-1';
const VARIANT = 'ol_variant_aaaa';
const EXT = 'wc-product-42';

function makeRecord(
  status: ListingCreationStatus,
  externalProductId: string | null = null
): ListingCreationRecord {
  return new ListingCreationRecord(
    'rec-1',
    VARIANT,
    CONN,
    externalProductId,
    status,
    null,
    new Date(),
    new Date()
  );
}

describe('ProductPublishExecutionService', () => {
  let builder: { buildPublishProductCommand: jest.Mock };
  let records: {
    create: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
    updateExternalIdAndStatus: jest.Mock;
  };
  let identifierMapping: { getExternalIds: jest.Mock; createMapping: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let adapter: { publishProduct: jest.Mock };
  let service: ProductPublishExecutionService;

  const input = { internalVariantId: VARIANT, connectionId: CONN, stock: 5, status: 'published' as const };

  beforeEach(() => {
    builder = {
      buildPublishProductCommand: jest.fn().mockResolvedValue({
        internalVariantId: VARIANT,
        connectionId: CONN,
        destinationCategoryIds: [],
        price: { amount: 10, currency: 'PLN' },
        stock: 5,
        status: 'published',
      }),
    };
    records = {
      create: jest.fn().mockResolvedValue(makeRecord('pending')),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      updateExternalIdAndStatus: jest
        .fn()
        .mockResolvedValue(makeRecord('published', EXT)),
    };
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
      createMapping: jest.fn().mockResolvedValue(undefined),
    };
    adapter = {
      publishProduct: jest.fn().mockResolvedValue({ externalProductId: EXT, status: 'published' }),
    };
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(adapter) };

    service = new ProductPublishExecutionService(
      builder as never,
      records as never,
      identifierMapping as never,
      integrations as never
    );
  });

  it('should publish a new product, persist the mapping, and report ok', async () => {
    const result = await service.executePublish(input);

    expect(adapter.publishProduct).toHaveBeenCalledTimes(1);
    expect(identifierMapping.createMapping).toHaveBeenCalledWith(
      'ShopProduct',
      EXT,
      CONN,
      VARIANT
    );
    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith('rec-1', EXT, 'published', null);
    expect(result.outcome).toBe('ok');
    expect(result.listingCreationRecord.status).toBe('published');
  });

  it('should upsert when a connection-scoped mapping already exists (no new mapping)', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      { externalId: 'other-conn-prod', connectionId: 'conn-other', entityType: 'ShopProduct', platformType: 'x' },
      { externalId: EXT, connectionId: CONN, entityType: 'ShopProduct', platformType: 'woocommerce' },
    ]);

    await service.executePublish(input);

    // Command carries the existing external product id (upsert).
    expect(adapter.publishProduct).toHaveBeenCalledWith(
      expect.objectContaining({ externalProductId: EXT })
    );
    // No new mapping on upsert.
    expect(identifierMapping.createMapping).not.toHaveBeenCalled();
  });

  it('should record business_failure when the shop rejects the publish', async () => {
    adapter.publishProduct.mockRejectedValue(
      new ProductPublishRejectedException('woocommerce.restapi.v1', 422, [
        { code: 'INVALID', message: 'bad' },
      ])
    );
    records.updateStatus.mockResolvedValue(makeRecord('failed'));

    const result = await service.executePublish(input);

    expect(records.updateStatus).toHaveBeenCalledWith(
      'rec-1',
      'failed',
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID' })])
    );
    expect(result.outcome).toBe('business_failure');
  });

  it('should record business_failure when builder validation fails', async () => {
    builder.buildPublishProductCommand.mockRejectedValue(
      new ProductPublishBuilderValidationException([
        { field: 'price.amount', code: 'REQUIRED', message: 'no price' },
      ])
    );
    records.updateStatus.mockResolvedValue(makeRecord('failed'));

    const result = await service.executePublish(input);

    expect(adapter.publishProduct).not.toHaveBeenCalled();
    expect(result.outcome).toBe('business_failure');
  });

  it('should treat DuplicateIdentifierMappingError as an idempotent retry', async () => {
    identifierMapping.createMapping.mockRejectedValue(
      new DuplicateIdentifierMappingError('ShopProduct', EXT, 'woocommerce', CONN)
    );

    const result = await service.executePublish(input);

    expect(result.outcome).toBe('ok');
  });

  it('should propagate a transient (non-domain) adapter error for worker retry', async () => {
    adapter.publishProduct.mockRejectedValue(new Error('network down'));

    await expect(service.executePublish(input)).rejects.toThrow('network down');
    expect(records.updateStatus).not.toHaveBeenCalled();
  });
});
