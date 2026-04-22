/**
 * Integrations Content Publisher — Unit Tests
 *
 * Asserts: master path resolves the ProductMaster adapter and calls
 * `updateProduct` with a single-field patch keyed by `fieldKey`; channel
 * path throws ChannelContentPublishNotSupportedException.
 *
 * @module libs/core/src/content/application/services
 */
import { IntegrationsContentPublisher } from './integrations-content-publisher.service';
import { ChannelContentPublishNotSupportedException } from '../../domain/exceptions/channel-content-publish-not-supported.exception';
import { ContentPublishMissingVersionException } from '../../domain/exceptions/content-publish-missing-version.exception';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import type { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import type { ProductMasterPort } from '@openlinker/core/products/domain/ports/product-master.port';
import type { Product } from '@openlinker/core/products/domain/entities/product.entity';

describe('IntegrationsContentPublisher', () => {
  describe('publish', () => {
    it('should resolve ProductMaster and call updateProduct with the keyed patch on master path', async () => {
      const adapterUpdateProduct = jest.fn<Promise<Product>, Parameters<ProductMasterPort['updateProduct']>>(
        () =>
          Promise.resolve({
            id: 'ol_product_abc',
            name: 'irrelevant',
            sku: null,
            price: null,
            description: 'new value',
            images: null,
            updatedAt: new Date('2026-04-22T10:30:00.000Z'),
          } as Product),
      );
      const integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
        listCapabilityAdapters: jest.fn().mockResolvedValue([
          {
            connectionId: 'conn-master',
            connection: {} as unknown,
            adapter: { updateProduct: adapterUpdateProduct } as unknown as ProductMasterPort,
            metadata: {} as unknown,
          },
        ]),
      };
      const publisher = new IntegrationsContentPublisher(integrationsService as unknown as IIntegrationsService);

      const result = await publisher.publish({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        value: 'new value',
      });

      expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({ capability: 'ProductMaster' });
      expect(adapterUpdateProduct).toHaveBeenCalledWith('ol_product_abc', { description: 'new value' });
      expect(result.baseVersion).toBe('2026-04-22T10:30:00.000Z');
    });


    it('should throw ChannelContentPublishNotSupportedException for non-null connectionId', async () => {
      const integrationsService = {
        listCapabilityAdapters: jest.fn(),
      } as unknown as IIntegrationsService;
      const publisher = new IntegrationsContentPublisher(integrationsService);

      await expect(
        publisher.publish({
          productId: 'ol_product_abc',
          connectionId: 'conn-allegro-1',
          fieldKey: 'description',
          value: 'channel-only value',
        }),
      ).rejects.toBeInstanceOf(ChannelContentPublishNotSupportedException);
    });

    it('should throw NoProductMasterAdapterException when no ProductMaster adapter is registered', async () => {
      const integrationsService = {
        listCapabilityAdapters: jest.fn().mockResolvedValue([]),
      } as unknown as IIntegrationsService;
      const publisher = new IntegrationsContentPublisher(integrationsService);

      await expect(
        publisher.publish({
          productId: 'ol_product_abc',
          connectionId: null,
          fieldKey: 'description',
          value: 'v',
        }),
      ).rejects.toBeInstanceOf(NoProductMasterAdapterException);
    });

    it('should throw ContentPublishMissingVersionException when adapter returns a product with no updatedAt', async () => {
      const adapterUpdateProduct = jest
        .fn<Promise<Product>, Parameters<ProductMasterPort['updateProduct']>>()
        .mockResolvedValue({
          id: 'ol_product_abc',
          name: 'irrelevant',
          sku: null,
          price: null,
          description: 'v',
          images: null,
          updatedAt: undefined as unknown as Date,
        } as Product);
      const integrationsService = {
        listCapabilityAdapters: jest.fn().mockResolvedValue([
          {
            connectionId: 'conn-master',
            connection: {},
            adapter: { updateProduct: adapterUpdateProduct } as unknown as ProductMasterPort,
            metadata: {},
          },
        ]),
      } as unknown as IIntegrationsService;
      const publisher = new IntegrationsContentPublisher(integrationsService);

      await expect(
        publisher.publish({
          productId: 'ol_product_abc',
          connectionId: null,
          fieldKey: 'description',
          value: 'v',
        }),
      ).rejects.toBeInstanceOf(ContentPublishMissingVersionException);
    });
  });
});
