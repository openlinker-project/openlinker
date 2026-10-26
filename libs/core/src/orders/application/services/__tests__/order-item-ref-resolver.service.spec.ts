import { OrderItemRefResolverService } from '../order-item-ref-resolver.service';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { MissingOrderItemMappingError } from '../../../domain/exceptions/missing-order-item-mapping.error';
import { StaleOrderItemError } from '../../../domain/exceptions/stale-order-item.error';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';

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

function makeProduct(id: string): Product {
  return {
    id,
    name: `product ${id}`,
    sku: null,
    description: null,
    price: null,
    currency: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Product;
}

function makeStaleVariant(id: string, productId: string): ProductVariant {
  return { ...makeVariant(id, productId), isStale: true, staleAt: new Date() };
}

describe('OrderItemRefResolverService', () => {
  const connectionId = 'connection-123';

  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  // Only the products-service method the SUT actually calls — keeps the mock
  // surface tight per #718 review.
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariant' | 'getProduct'>>;
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

    productsService = {
      getVariant: jest.fn(),
      getProduct: jest.fn(),
    };

    service = new OrderItemRefResolverService(
      identifierMapping,
      productsService as unknown as IProductsService,
    );
  });

  it('resolves offer refs via IdentifierMappingService(Offer)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
    productsService.getVariant.mockResolvedValueOnce(makeVariant('ol_variant_1', 'ol_product_1'));

    await expect(
      service.resolve(connectionId, { type: 'offer', externalId: 'offer-1' })
    ).resolves.toEqual({
      internalProductId: 'ol_product_1',
      internalVariantId: 'ol_variant_1',
    });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Offer', 'offer-1', connectionId);
  });

  it('throws typed error when offer mapping is missing', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce(null);

    await expect(
      service.resolve(connectionId, { type: 'offer', externalId: 'offer-404' })
    ).rejects.toBeInstanceOf(MissingOrderItemMappingError);
  });

  it('resolves product refs via IdentifierMappingService(Product)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');

    await expect(
      service.resolve(connectionId, { type: 'product', externalId: 'p-1' })
    ).resolves.toEqual({ internalProductId: 'ol_product_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Product', 'p-1', connectionId);
  });

  it('resolves variant refs via IdentifierMappingService(ProductVariant)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
    productsService.getVariant.mockResolvedValueOnce(makeVariant('ol_variant_1', 'ol_product_1'));

    await expect(
      service.resolve(connectionId, { type: 'variant', externalId: 'v-1' })
    ).resolves.toEqual({ internalProductId: 'ol_product_1', internalVariantId: 'ol_variant_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith(
      'ProductVariant',
      'v-1',
      connectionId
    );
  });

  it('resolves sku refs via IdentifierMappingService(Sku) and variant lookup', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
    productsService.getVariant.mockResolvedValueOnce(makeVariant('ol_variant_1', 'ol_product_1'));

    await expect(
      service.resolve(connectionId, { type: 'sku', externalId: 'SKU-1' })
    ).resolves.toEqual({ internalProductId: 'ol_product_1', internalVariantId: 'ol_variant_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Sku', 'SKU-1', connectionId);
  });

  it('falls back to product id when sku mapping is not a variant', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');
    productsService.getVariant.mockResolvedValueOnce(null);

    await expect(
      service.resolve(connectionId, { type: 'sku', externalId: 'SKU-2' })
    ).resolves.toEqual({ internalProductId: 'ol_product_1' });
  });

  describe('stale variant guard (#1599)', () => {
    it('throws StaleOrderItemError when an offer resolves to a stale variant', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
      productsService.getVariant.mockResolvedValueOnce(
        makeStaleVariant('ol_variant_1', 'ol_product_1')
      );

      await expect(
        service.resolve(connectionId, { type: 'offer', externalId: 'offer-1' })
      ).rejects.toBeInstanceOf(StaleOrderItemError);
    });

    it('throws StaleOrderItemError when a variant ref resolves to a stale variant', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
      productsService.getVariant.mockResolvedValueOnce(
        makeStaleVariant('ol_variant_1', 'ol_product_1')
      );

      await expect(
        service.resolve(connectionId, { type: 'variant', externalId: 'v-1' })
      ).rejects.toBeInstanceOf(StaleOrderItemError);
    });

    it('throws StaleOrderItemError when a sku resolves to a stale variant', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
      productsService.getVariant.mockResolvedValueOnce(
        makeStaleVariant('ol_variant_1', 'ol_product_1')
      );

      await expect(
        service.resolve(connectionId, { type: 'sku', externalId: 'SKU-1' })
      ).rejects.toBeInstanceOf(StaleOrderItemError);
    });

    it('tryResolve surfaces a stale variant as resolved=false with a message-rich reason', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
      productsService.getVariant.mockResolvedValueOnce(
        makeStaleVariant('ol_variant_1', 'ol_product_1')
      );

      const productRef = { type: 'offer' as const, externalId: 'offer-1' };
      const result = await service.tryResolve(connectionId, productRef);

      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.productRef).toEqual(productRef);
        expect(result.reason).toContain('deleted at the master');
        expect(result.kind).toBe('source_deleted');
      }
    });

    it.each([
      ['variant' as const, 'ol_variant_1'],
      ['sku' as const, 'SKU-1'],
    ])(
      'tryResolve tags a stale %s ref with kind=source_deleted',
      async (type, externalId) => {
        identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
        productsService.getVariant.mockResolvedValueOnce(
          makeStaleVariant('ol_variant_1', 'ol_product_1')
        );

        const result = await service.tryResolve(connectionId, { type, externalId });

        expect(result.resolved).toBe(false);
        if (!result.resolved) {
          expect(result.kind).toBe('source_deleted');
        }
      }
    );
  });

  describe('tryResolve', () => {
    it('should return resolved=true with IDs when offer mapping exists', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_1');
      productsService.getVariant.mockResolvedValueOnce(makeVariant('ol_variant_1', 'ol_product_1'));

      const result = await service.tryResolve(connectionId, {
        type: 'offer',
        externalId: 'offer-1',
      });

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
        expect(result.kind).toBe('missing_mapping');
      }
    });

    it('should return resolved=false when variant lookup fails after offer mapping', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_variant_missing');
      productsService.getVariant.mockResolvedValueOnce(null);

      const result = await service.tryResolve(connectionId, {
        type: 'offer',
        externalId: 'offer-x',
      });

      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.kind).toBe('missing_mapping');
      }
    });

    it('should re-throw non-MissingOrderItemMappingError errors', async () => {
      identifierMapping.getInternalId.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        service.tryResolve(connectionId, { type: 'offer', externalId: 'offer-1' })
      ).rejects.toThrow('DB connection lost');
    });
  });

  // The topology these cover: OpenLinker PUBLISHED the product to the shop, so
  // the only shop-side identity on record is the `ShopProduct` mapping the
  // publish wrote. No ProductMaster sweep ran against that shop, so the primary
  // mapping legitimately misses.
  describe('ShopProduct fallback for a published product (#3365)', () => {
    it('resolves a product ref through the publish record when no Product mapping exists', async () => {
      identifierMapping.getInternalId
        .mockResolvedValueOnce(null) // Product
        .mockResolvedValueOnce('ol_variant_9'); // ShopProduct
      productsService.getVariant.mockResolvedValueOnce(makeVariant('ol_variant_9', 'ol_product_9'));

      await expect(
        service.resolve(connectionId, { type: 'product', externalId: 'wc-77' })
      ).resolves.toEqual({ internalProductId: 'ol_product_9', internalVariantId: 'ol_variant_9' });

      expect(identifierMapping.getInternalId).toHaveBeenNthCalledWith(
        2,
        'ShopProduct',
        'wc-77',
        connectionId
      );
    });

    it('resolves a variant ref through the publish record when no ProductVariant mapping exists', async () => {
      identifierMapping.getInternalId
        .mockResolvedValueOnce(null) // ProductVariant
        .mockResolvedValueOnce('ol_variant_9'); // ShopProduct
      productsService.getVariant.mockResolvedValueOnce(makeVariant('ol_variant_9', 'ol_product_9'));

      await expect(
        service.resolve(connectionId, { type: 'variant', externalId: 'wc-78' })
      ).resolves.toEqual({ internalProductId: 'ol_product_9', internalVariantId: 'ol_variant_9' });
    });

    // A grouped parent's shop id maps to a PRODUCT id, not a variant one - the
    // one entityType carries both, so the fallback has to ask which it got.
    it('resolves to a product when the publish record names a grouped parent', async () => {
      identifierMapping.getInternalId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('ol_product_9');
      productsService.getVariant.mockResolvedValueOnce(null);
      productsService.getProduct.mockResolvedValueOnce(makeProduct('ol_product_9'));

      await expect(
        service.resolve(connectionId, { type: 'product', externalId: 'wc-79' })
      ).resolves.toEqual({ internalProductId: 'ol_product_9' });
    });

    // Never carry an id onwards that resolves to nothing: a variant id landing
    // in `internalProductId` is a silent mis-link, which is the whole reason
    // the fallback asks instead of inferring from the id's shape.
    it('refuses when the publish record points at a row that no longer exists', async () => {
      identifierMapping.getInternalId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('ol_variant_gone');
      productsService.getVariant.mockResolvedValueOnce(null);
      productsService.getProduct.mockResolvedValueOnce(null);

      await expect(
        service.resolve(connectionId, { type: 'product', externalId: 'wc-80' })
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);
    });

    it('applies the stale guard to a variant reached through the publish record', async () => {
      identifierMapping.getInternalId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('ol_variant_9');
      productsService.getVariant.mockResolvedValueOnce(
        makeStaleVariant('ol_variant_9', 'ol_product_9')
      );

      await expect(
        service.resolve(connectionId, { type: 'product', externalId: 'wc-81' })
      ).rejects.toBeInstanceOf(StaleOrderItemError);
    });

    // Precedence: a shop that really IS a ProductMaster has the sweep's own
    // identity for the row, and that answer beats a publish record.
    it('never consults the publish record when the primary mapping answers', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');

      await expect(
        service.resolve(connectionId, { type: 'product', externalId: 'p-1' })
      ).resolves.toEqual({ internalProductId: 'ol_product_1' });

      expect(identifierMapping.getInternalId).toHaveBeenCalledTimes(1);
    });

    it('still reports a missing mapping when neither record exists', async () => {
      identifierMapping.getInternalId.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await service.tryResolve(connectionId, {
        type: 'product',
        externalId: 'wc-404',
      });

      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.kind).toBe('missing_mapping');
        expect(result.reason).toContain('ShopProduct');
      }
    });
  });
});
