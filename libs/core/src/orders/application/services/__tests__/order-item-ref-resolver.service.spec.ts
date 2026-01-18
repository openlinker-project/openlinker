import { OrderItemRefResolverService } from '../order-item-ref-resolver.service';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { MissingOrderItemMappingError } from '../../../domain/exceptions/missing-order-item-mapping.error';

describe('OrderItemRefResolverService', () => {
  const connectionId = 'connection-123';

  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let service: OrderItemRefResolverService;

  beforeEach(() => {
    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    service = new OrderItemRefResolverService(identifierMapping);
  });

  it('resolves offer refs via IdentifierMappingService(Offer)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');

    await expect(
      service.resolve(connectionId, { type: 'offer', externalId: 'offer-1' }),
    ).resolves.toEqual({
      internalProductId: 'ol_product_1',
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
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');

    await expect(
      service.resolve(connectionId, { type: 'variant', externalId: 'v-1' }),
    ).resolves.toEqual({ internalProductId: 'ol_product_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('ProductVariant', 'v-1', connectionId);
  });

  it('resolves sku refs via IdentifierMappingService(Sku)', async () => {
    identifierMapping.getInternalId.mockResolvedValueOnce('ol_product_1');

    await expect(
      service.resolve(connectionId, { type: 'sku', externalId: 'SKU-1' }),
    ).resolves.toEqual({ internalProductId: 'ol_product_1' });

    expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Sku', 'SKU-1', connectionId);
  });
});

