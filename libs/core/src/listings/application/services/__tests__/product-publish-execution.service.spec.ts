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
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  ShopProductMappingConflictException,
} from '@openlinker/core/listings';

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
  let identifierMapping: {
    getExternalIds: jest.Mock;
    getInternalId: jest.Mock;
    createMapping: jest.Mock;
    deleteMapping: jest.Mock;
  };
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
      getInternalId: jest.fn().mockResolvedValue(VARIANT),
      createMapping: jest.fn().mockResolvedValue(undefined),
      deleteMapping: jest.fn().mockResolvedValue(undefined),
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
    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith('rec-1', EXT, 'published', null, null);
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

  it('should delete the stale mapping and re-create when the upsert target is gone (404)', async () => {
    // Existing mapping → upsert path.
    identifierMapping.getExternalIds.mockResolvedValue([
      { externalId: EXT, connectionId: CONN, entityType: 'ShopProduct', platformType: 'woocommerce' },
    ]);
    const NEW_EXT = 'wc-product-99';
    adapter.publishProduct
      .mockRejectedValueOnce(
        new ProductPublishTargetNotFoundException('woocommerce.restapi.v3', EXT)
      )
      .mockResolvedValueOnce({ externalProductId: NEW_EXT, status: 'published' });
    records.updateExternalIdAndStatus.mockResolvedValue(makeRecord('published', NEW_EXT));

    const result = await service.executePublish(input);

    // Stale mapping deleted.
    expect(identifierMapping.deleteMapping).toHaveBeenCalledWith('ShopProduct', EXT, CONN);
    // Re-published as a create (no externalProductId on the second call).
    expect(adapter.publishProduct).toHaveBeenCalledTimes(2);
    expect(adapter.publishProduct).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ externalProductId: null })
    );
    // Fresh mapping written for the newly created product.
    expect(identifierMapping.createMapping).toHaveBeenCalledWith(
      'ShopProduct',
      NEW_EXT,
      CONN,
      VARIANT
    );
    expect(result.outcome).toBe('ok');
  });

  it('should record a clean business_failure when the recovery create is rejected (not an escaped throw)', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      { externalId: EXT, connectionId: CONN, entityType: 'ShopProduct', platformType: 'woocommerce' },
    ]);
    adapter.publishProduct
      .mockRejectedValueOnce(
        new ProductPublishTargetNotFoundException('woocommerce.restapi.v3', EXT)
      )
      .mockRejectedValueOnce(
        new ProductPublishRejectedException('woocommerce.restapi.v3', 422, [
          { code: 'INVALID', message: 'bad' },
        ])
      );
    records.updateStatus.mockResolvedValue(makeRecord('failed'));

    const result = await service.executePublish(input);

    // Stale mapping deleted, recovery create attempted, then its rejection
    // recorded as a terminal failure rather than escaping.
    expect(identifierMapping.deleteMapping).toHaveBeenCalledWith('ShopProduct', EXT, CONN);
    expect(adapter.publishProduct).toHaveBeenCalledTimes(2);
    expect(records.updateStatus).toHaveBeenCalledWith(
      'rec-1',
      'failed',
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID' })])
    );
    // No mapping written for a failed recovery create.
    expect(identifierMapping.createMapping).not.toHaveBeenCalled();
    expect(result.outcome).toBe('business_failure');
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

  it('should treat DuplicateIdentifierMappingError as an idempotent retry when the mapping claims the same variant (#1845)', async () => {
    identifierMapping.createMapping.mockRejectedValue(
      new DuplicateIdentifierMappingError('ShopProduct', EXT, 'woocommerce', CONN)
    );
    // The winning mapping points to the same variant — benign concurrent first publish.
    identifierMapping.getInternalId.mockResolvedValue(VARIANT);

    const result = await service.executePublish(input);

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('ShopProduct', EXT, CONN);
    expect(result.outcome).toBe('ok');
  });

  it('should treat a benign duplicate as ok when the mapping has not committed yet (null read) (#1845)', async () => {
    identifierMapping.createMapping.mockRejectedValue(
      new DuplicateIdentifierMappingError('ShopProduct', EXT, 'woocommerce', CONN)
    );
    identifierMapping.getInternalId.mockResolvedValue(null);

    const result = await service.executePublish(input);

    expect(result.outcome).toBe('ok');
  });

  it('should rethrow when a duplicate mapping claims a DIFFERENT variant (real conflict) (#1845)', async () => {
    identifierMapping.createMapping.mockRejectedValue(
      new DuplicateIdentifierMappingError('ShopProduct', EXT, 'woocommerce', CONN)
    );
    // The shop product is already claimed by another variant — genuine conflict.
    identifierMapping.getInternalId.mockResolvedValue('ol_variant_other');

    await expect(service.executePublish(input)).rejects.toBeInstanceOf(
      ShopProductMappingConflictException
    );
  });

  it('should propagate a transient (non-domain) adapter error for worker retry', async () => {
    adapter.publishProduct.mockRejectedValue(new Error('network down'));

    await expect(service.executePublish(input)).rejects.toThrow('network down');
    expect(records.updateStatus).not.toHaveBeenCalled();
  });

  it('should log a warn and persist warnings when the adapter returns a non-empty warnings array', async () => {
    const warnings = ['imageUrls deferred', 'parameters deferred'];
    adapter.publishProduct.mockResolvedValue({ externalProductId: EXT, status: 'published', warnings });
    const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');

    const result = await service.executePublish(input);

    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith('rec-1', EXT, 'published', null, warnings);
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('non-fatal adapter warnings'));
    expect(result.outcome).toBe('ok');
  });

  it('should persist null warnings and not emit a warnings warn log when the adapter returns no warnings', async () => {
    const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');

    const result = await service.executePublish(input);

    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith('rec-1', EXT, 'published', null, null);
    expect(loggerWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('non-fatal adapter warnings'));
    expect(result.outcome).toBe('ok');
  });

  describe('grouped (multi-variant) publish (#1836)', () => {
    const GROUP_ID = 'prod-1';
    const VARIATION_EXT = 'wc-variation-7';
    const PARENT_EXT = 'wc-parent-42';

    beforeEach(() => {
      builder.buildPublishProductCommand.mockResolvedValue({
        internalVariantId: VARIANT,
        connectionId: CONN,
        destinationCategoryIds: [],
        price: { amount: 10, currency: 'PLN' },
        stock: 5,
        status: 'published',
        variantGroup: {
          groupId: GROUP_ID,
          attributes: [{ name: 'Color', value: 'Red' }],
          groupAttributeValues: { Color: ['Red', 'Blue'] },
        },
      });
    });

    it('should resolve no existing parent, publish, and persist both variant + parent mappings on first publish', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([]);
      adapter.publishProduct.mockResolvedValue({
        externalProductId: VARIATION_EXT,
        status: 'published',
        externalParentProductId: PARENT_EXT,
      });

      const result = await service.executePublish(input);

      // Command passed to the adapter carries a resolved (absent) parent id.
      expect(adapter.publishProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          variantGroup: expect.objectContaining({ groupId: GROUP_ID, externalParentProductId: null }),
        }),
      );
      // Both mappings written: the variation (variant-keyed) and the parent (product-keyed).
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'ShopProduct',
        VARIATION_EXT,
        CONN,
        VARIANT,
      );
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'ShopProduct',
        PARENT_EXT,
        CONN,
        GROUP_ID,
      );
      expect(result.outcome).toBe('ok');
    });

    it('should thread an existing parent mapping into the command and skip re-creating it', async () => {
      identifierMapping.getExternalIds.mockImplementation((entityType: string, internalId: string) => {
        if (internalId === GROUP_ID) {
          return Promise.resolve([
            { externalId: PARENT_EXT, connectionId: CONN, entityType, platformType: 'woocommerce' },
          ]);
        }
        return Promise.resolve([]); // variant has no mapping yet — first variation publish
      });
      adapter.publishProduct.mockResolvedValue({
        externalProductId: VARIATION_EXT,
        status: 'published',
        externalParentProductId: PARENT_EXT,
      });

      await service.executePublish(input);

      expect(adapter.publishProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          variantGroup: expect.objectContaining({ externalParentProductId: PARENT_EXT }),
        }),
      );
      // Variation mapping is new (created); parent mapping already existed (not re-created).
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'ShopProduct',
        VARIATION_EXT,
        CONN,
        VARIANT,
      );
      expect(identifierMapping.createMapping).not.toHaveBeenCalledWith(
        'ShopProduct',
        expect.anything(),
        CONN,
        GROUP_ID,
      );
    });

    it('should skip re-creating both mappings on a steady-state re-publish (both already exist)', async () => {
      identifierMapping.getExternalIds.mockImplementation((entityType: string, internalId: string) => {
        if (internalId === GROUP_ID) {
          return Promise.resolve([
            { externalId: PARENT_EXT, connectionId: CONN, entityType, platformType: 'woocommerce' },
          ]);
        }
        return Promise.resolve([
          { externalId: VARIATION_EXT, connectionId: CONN, entityType, platformType: 'woocommerce' },
        ]);
      });
      adapter.publishProduct.mockResolvedValue({
        externalProductId: VARIATION_EXT,
        status: 'published',
        externalParentProductId: PARENT_EXT,
      });

      await service.executePublish(input);

      expect(adapter.publishProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          externalProductId: VARIATION_EXT,
          variantGroup: expect.objectContaining({ externalParentProductId: PARENT_EXT }),
        }),
      );
      expect(identifierMapping.createMapping).not.toHaveBeenCalled();
    });

    it('should swallow a benign duplicate parent-mapping race when the winner claims the same group id', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([]);
      adapter.publishProduct.mockResolvedValue({
        externalProductId: VARIATION_EXT,
        status: 'published',
        externalParentProductId: PARENT_EXT,
      });
      identifierMapping.createMapping.mockImplementation((_entityType: string, externalId: string) => {
        if (externalId === PARENT_EXT) {
          return Promise.reject(
            new DuplicateIdentifierMappingError('ShopProduct', PARENT_EXT, 'woocommerce', CONN),
          );
        }
        return Promise.resolve(undefined);
      });
      identifierMapping.getInternalId.mockResolvedValue(GROUP_ID);

      const result = await service.executePublish(input);

      expect(identifierMapping.getInternalId).toHaveBeenCalledWith('ShopProduct', PARENT_EXT, CONN);
      expect(result.outcome).toBe('ok');
    });

    it('should rethrow when a duplicate parent mapping claims a DIFFERENT group (genuine conflict)', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([]);
      adapter.publishProduct.mockResolvedValue({
        externalProductId: VARIATION_EXT,
        status: 'published',
        externalParentProductId: PARENT_EXT,
      });
      identifierMapping.createMapping.mockImplementation((_entityType: string, externalId: string) => {
        if (externalId === PARENT_EXT) {
          return Promise.reject(
            new DuplicateIdentifierMappingError('ShopProduct', PARENT_EXT, 'woocommerce', CONN),
          );
        }
        return Promise.resolve(undefined);
      });
      identifierMapping.getInternalId.mockResolvedValue('prod-other');

      await expect(service.executePublish(input)).rejects.toBeInstanceOf(
        ShopProductMappingConflictException,
      );
    });
  });
});
