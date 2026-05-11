/**
 * Integrations Content Publisher — Unit Tests
 *
 * Master path: resolves the ProductMaster adapter and calls
 * `updateProduct` with a single-field patch keyed by `fieldKey`.
 *
 * Channel path: resolves an OfferManager adapter for the target connection,
 * type-guards `isOfferFieldUpdater`, walks the product's variants →
 * `OfferMappingRepository.findMany` → distinct `externalOfferId`s, and
 * issues one `updateOfferFields` call per distinct offer wrapping the value
 * in the Allegro-shaped TEXT section payload.
 *
 * @module libs/core/src/content/application/services
 */
import { IntegrationsContentPublisher } from './integrations-content-publisher.service';
import { ChannelAdapterLacksFieldUpdaterException } from '../../domain/exceptions/channel-adapter-lacks-field-updater.exception';
import { ContentPublishMissingVersionException } from '../../domain/exceptions/content-publish-missing-version.exception';
import { NoLinkedOffersException } from '../../domain/exceptions/no-linked-offers.exception';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { Product } from '@openlinker/core/products';
import type { ProductVariant } from '@openlinker/core/products';
import type {
  OfferManagerPort,
  OfferMappingRepositoryPort,
  UpdateOfferFieldsCommand,
} from '@openlinker/core/listings';

function buildOfferMappingsMock(): jest.Mocked<OfferMappingRepositoryPort> {
  return {
    findById: jest.fn(),
    findMany: jest.fn(),
    countByConnectionAndVariants: jest.fn().mockResolvedValue(new Map<string, number>()),
  };
}

describe('IntegrationsContentPublisher', () => {
  describe('master path (connectionId === null)', () => {
    it('should resolve ProductMaster and call updateProduct with the keyed patch', async () => {
      const adapterUpdateProduct = jest.fn<
        Promise<Product>,
        Parameters<ProductMasterPort['updateProduct']>
      >(() =>
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
      const integrationsService: jest.Mocked<
        Pick<IIntegrationsService, 'listCapabilityAdapters' | 'getCapabilityAdapter'>
      > = {
        listCapabilityAdapters: jest.fn().mockResolvedValue([
          {
            connectionId: 'conn-master',
            connection: {} as unknown,
            adapter: { updateProduct: adapterUpdateProduct } as unknown as ProductMasterPort,
            metadata: {} as unknown,
          },
        ]),
        getCapabilityAdapter: jest.fn(),
      };
      const publisher = new IntegrationsContentPublisher(
        integrationsService as unknown as IIntegrationsService,
        buildOfferMappingsMock(),
      );

      const result = await publisher.publish({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        value: 'new value',
      });

      expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
        capability: 'ProductMaster',
      });
      expect(adapterUpdateProduct).toHaveBeenCalledWith('ol_product_abc', {
        description: 'new value',
      });
      expect(result.baseVersion).toBe('2026-04-22T10:30:00.000Z');
    });

    it('should throw NoProductMasterAdapterException when no ProductMaster adapter is registered', async () => {
      const integrationsService = {
        listCapabilityAdapters: jest.fn().mockResolvedValue([]),
        getCapabilityAdapter: jest.fn(),
      } as unknown as IIntegrationsService;
      const publisher = new IntegrationsContentPublisher(
        integrationsService,
        buildOfferMappingsMock(),
      );

      await expect(
        publisher.publish({
          productId: 'ol_product_abc',
          connectionId: null,
          fieldKey: 'description',
          value: 'v',
        }),
      ).rejects.toBeInstanceOf(NoProductMasterAdapterException);
    });

    it('should throw ContentPublishMissingVersionException when adapter omits updatedAt', async () => {
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
        getCapabilityAdapter: jest.fn(),
      } as unknown as IIntegrationsService;
      const publisher = new IntegrationsContentPublisher(
        integrationsService,
        buildOfferMappingsMock(),
      );

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

  describe('channel path (connectionId !== null)', () => {
    function channelFixture(opts: {
      hasUpdateOfferFields: boolean;
      variants: ProductVariant[];
      offerMappingsByVariant: Record<string, string[]>;
    }) {
      const updateOfferFields = jest.fn<Promise<void>, [UpdateOfferFieldsCommand]>()
        .mockResolvedValue(undefined);
      const getProductVariants = jest.fn().mockResolvedValue(opts.variants);
      const channelAdapter = opts.hasUpdateOfferFields
        ? ({ updateOfferFields } as unknown as OfferManagerPort)
        : ({} as unknown as OfferManagerPort);
      const integrationsService = {
        getCapabilityAdapter: jest.fn().mockImplementation((_connectionId: string, capability: string) => {
          if (capability === 'OfferManager') return Promise.resolve(channelAdapter);
          throw new Error(`unexpected capability: ${capability}`);
        }),
        listCapabilityAdapters: jest.fn().mockResolvedValue([
          {
            connectionId: 'conn-master',
            connection: {},
            adapter: { getProductVariants } as unknown as ProductMasterPort,
            metadata: {},
          },
        ]),
      } as unknown as IIntegrationsService;
      const offerMappings = buildOfferMappingsMock();
      offerMappings.findMany.mockImplementation((filters) => {
        const ids = opts.offerMappingsByVariant[filters.internalId ?? ''] ?? [];
        return Promise.resolve({
          items: ids.map((id) => ({
            id: `map-${id}`,
            entityType: 'Offer',
            internalId: filters.internalId ?? '',
            externalId: id,
            platformType: 'allegro',
            connectionId: filters.connectionId ?? '',
            context: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          total: ids.length,
          limit: 100,
          offset: 0,
        });
      });
      return { updateOfferFields, integrationsService, offerMappings };
    }

    it('should update every distinct offer on the connection when publishing a channel override', async () => {
      const { updateOfferFields, integrationsService, offerMappings } = channelFixture({
        hasUpdateOfferFields: true,
        variants: [
          { id: 'ol_variant_a' } as ProductVariant,
          { id: 'ol_variant_b' } as ProductVariant,
        ],
        offerMappingsByVariant: {
          ol_variant_a: ['offer-1'],
          ol_variant_b: ['offer-2'],
        },
      });
      const publisher = new IntegrationsContentPublisher(integrationsService, offerMappings);

      const result = await publisher.publish({
        productId: 'ol_product_abc',
        connectionId: 'conn-allegro-1',
        fieldKey: 'description',
        value: 'channel text',
      });

      expect(updateOfferFields).toHaveBeenCalledTimes(2);
      const seenKeys = new Set<string>();
      for (const call of updateOfferFields.mock.calls) {
        const cmd = call[0];
        expect(cmd.fields).toEqual({
          description: { sections: [{ items: [{ type: 'TEXT', content: 'channel text' }] }] },
        });
        // Each offer gets a distinct idempotency key scoped by externalOfferId.
        expect(cmd.idempotencyKey).toMatch(
          /^content:ol_product_abc:conn-allegro-1:offer-\d:/,
        );
        expect(seenKeys.has(cmd.idempotencyKey!)).toBe(false);
        seenKeys.add(cmd.idempotencyKey!);
      }
      expect(seenKeys.size).toBe(2);
      expect(result.baseVersion).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
    });

    it('should dedupe variants that share the same external offer id', async () => {
      const { updateOfferFields, integrationsService, offerMappings } = channelFixture({
        hasUpdateOfferFields: true,
        variants: [
          { id: 'ol_variant_a' } as ProductVariant,
          { id: 'ol_variant_b' } as ProductVariant,
        ],
        offerMappingsByVariant: {
          ol_variant_a: ['offer-same'],
          ol_variant_b: ['offer-same'],
        },
      });
      const publisher = new IntegrationsContentPublisher(integrationsService, offerMappings);

      await publisher.publish({
        productId: 'ol_product_abc',
        connectionId: 'conn-allegro-1',
        fieldKey: 'description',
        value: 'v',
      });

      expect(updateOfferFields).toHaveBeenCalledTimes(1);
    });

    it('should throw NoLinkedOffersException when the product has no offers on the connection', async () => {
      const { integrationsService, offerMappings } = channelFixture({
        hasUpdateOfferFields: true,
        variants: [{ id: 'ol_variant_a' } as ProductVariant],
        offerMappingsByVariant: {},
      });
      const publisher = new IntegrationsContentPublisher(integrationsService, offerMappings);

      await expect(
        publisher.publish({
          productId: 'ol_product_abc',
          connectionId: 'conn-allegro-1',
          fieldKey: 'description',
          value: 'v',
        }),
      ).rejects.toBeInstanceOf(NoLinkedOffersException);
    });

    it('should throw ChannelAdapterLacksFieldUpdaterException when adapter has no updateOfferFields', async () => {
      const { integrationsService, offerMappings } = channelFixture({
        hasUpdateOfferFields: false,
        variants: [{ id: 'ol_variant_a' } as ProductVariant],
        offerMappingsByVariant: { ol_variant_a: ['offer-1'] },
      });
      const publisher = new IntegrationsContentPublisher(integrationsService, offerMappings);

      await expect(
        publisher.publish({
          productId: 'ol_product_abc',
          connectionId: 'conn-allegro-1',
          fieldKey: 'description',
          value: 'v',
        }),
      ).rejects.toBeInstanceOf(ChannelAdapterLacksFieldUpdaterException);
    });
  });
});
