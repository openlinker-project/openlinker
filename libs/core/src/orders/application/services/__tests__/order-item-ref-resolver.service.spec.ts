import { OrderItemRefResolverService } from '../order-item-ref-resolver.service';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { MissingOrderItemMappingError } from '../../../domain/exceptions/missing-order-item-mapping.error';
import { ProductVariant } from '@openlinker/core/products';
import { ProductVariantRepositoryPort } from '@openlinker/core/products';

function makeVariant(id: string, productId: string): ProductVariant {
  return {
    id,
    productId,
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('OrderItemRefResolverService', () => {
  const connectionId = 'connection-123';

  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let variantRepository: jest.Mocked<ProductVariantRepositoryPort>;
  let service: OrderItemRefResolverService;

  beforeEach(() => {
    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
      deleteMapping: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    variantRepository = {
      findById: jest.fn(),
      findByProductId: jest.fn(),
      findBySku: jest.fn(),
      findBySkuIn: jest.fn(),
      findByEanOrGtinIn: jest.fn(),
      upsert: jest.fn(),
      upsertMany: jest.fn(),
    } as unknown as jest.Mocked<ProductVariantRepositoryPort>;

    service = new OrderItemRefResolverService(identifierMapping, variantRepository);
  });

  it('resolves offer refs via IdentifierMappingService(Offer)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
    variantRepository.findById.mockResolvedValueOnce(
      makeVariant('ol_variant_1', 'ol_product_1'),
    );

    await expect(
      service.resolve(connectionId, { type: 'offer', externalId: 'offer-1' }),
    ).resolves.toEqual({
      internalProductId: 'ol_product_1',
      internalVariantId: 'ol_variant_1',
    });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Offer', 'offer-1', connectionId);
  });

  it('throws typed error when offer mapping is missing', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce(null);

    await expect(
      service.resolve(connectionId, { type: 'offer', externalId: 'offer-404' }),
    ).rejects.toBeInstanceOf(MissingOrderItemMappingError);
  });

  it('resolves product refs via IdentifierMappingService(Product)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');

    await expect(
      service.resolve(connectionId, { type: 'product', externalId: 'p-1' }),
    ).resolves.toEqual({ internalProductId: 'ol_product_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Product', 'p-1', connectionId);
  });

  it('resolves variant refs via IdentifierMappingService(ProductVariant)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
    variantRepository.findById.mockResolvedValueOnce(
      makeVariant('ol_variant_1', 'ol_product_1'),
    );

    await expect(
      service.resolve(connectionId, { type: 'variant', externalId: 'v-1' }),
    ).resolves.toEqual({ internalProductId: 'ol_product_1', internalVariantId: 'ol_variant_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('ProductVariant', 'v-1', connectionId);
  });

  it('resolves sku refs via IdentifierMappingService(Sku) and variant lookup', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
    variantRepository.findById.mockResolvedValueOnce(
      makeVariant('ol_variant_1', 'ol_product_1'),
    );

    await expect(
      service.resolve(connectionId, { type: 'sku', externalId: 'SKU-1' }),
    ).resolves.toEqual({ internalProductId: 'ol_product_1', internalVariantId: 'ol_variant_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Sku', 'SKU-1', connectionId);
  });

  it('falls back to product id when sku mapping is not a variant', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');
    variantRepository.findById.mockResolvedValueOnce(null);

    await expect(
      service.resolve(connectionId, { type: 'sku', externalId: 'SKU-2' }),
    ).resolves.toEqual({ internalProductId: 'ol_product_1' });
  });

  describe('tryResolve', () => {
    it('should return resolved=true with IDs when offer mapping exists', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
      variantRepository.findById.mockResolvedValueOnce(
        makeVariant('ol_variant_1', 'ol_product_1'),
      );

      const result = await service.tryResolve(connectionId, { type: 'offer', externalId: 'offer-1' });

      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.internalProductId).toBe('ol_product_1');
        expect(result.internalVariantId).toBe('ol_variant_1');
      }
    });

    it('should return resolved=false with reason when offer mapping is missing', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce(null);

      const productRef = { type: 'offer' as const, externalId: 'offer-404' };
      const result = await service.tryResolve(connectionId, productRef);

      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.productRef).toEqual(productRef);
        expect(result.reason).toBeTruthy();
      }
    });

    it('should return resolved=false when variant lookup fails after offer mapping', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_missing');
      variantRepository.findById.mockResolvedValueOnce(null);

      const result = await service.tryResolve(connectionId, { type: 'offer', externalId: 'offer-x' });

      expect(result.resolved).toBe(false);
    });

    it('should re-throw non-MissingOrderItemMappingError errors', async () => {
      identifierMapping.getInternalId.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        service.tryResolve(connectionId, { type: 'offer', externalId: 'offer-1' }),
      ).rejects.toThrow('DB connection lost');
    });
  });
});

