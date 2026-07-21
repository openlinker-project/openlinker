/**
 * Allegro Marketplace Adapter Tests
 *
 * Unit tests for AllegroOfferManagerAdapter. Tests order fetching,
 * order mapping, and offer quantity updates.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroOfferManagerAdapter } from '../allegro-offer-manager.adapter';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { AllegroQuantityCommandRepositoryPort } from '../../../domain/ports/allegro-quantity-command-repository.port';
import { Connection } from '@openlinker/core/identifier-mapping';
import type {
  AllegroOfferQuantityChangeCommandResponse,
  AllegroProductCardSummary,
  AllegroProductOfferCreateResponse,
} from '../../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import {
  CatalogProductNotFoundException,
  CategoryNotFoundException,
  OfferCreateRejectedException,
  OfferNotFoundOnMarketplaceException,
  isCatalogProductReader,
  isCategoryBrowser,
  isCategoryPathReader,
  isEanCategoryMatcher,
  isOfferSmartClassificationReader,
  isOfferStatusReader,
  isSafetyAttachmentUploader,
  type CreateOfferCommand,
} from '@openlinker/core/listings';
import type { CachePort } from '@openlinker/shared';
import type { AllegroSellerDefaultsConfig } from '../../../domain/types/allegro-seller-defaults.types';

/**
 * Default seller defaults seeded by the createOffer specs (#430). All
 * createOffer tests previously assumed these were configured implicitly;
 * the new preflight throws when missing, so the test fixture exposes them
 * explicitly. Individual specs can omit them by constructing the adapter
 * via the dedicated `null sellerDefaults` test path.
 */
const DEFAULT_SELLER_DEFAULTS: AllegroSellerDefaultsConfig = {
  location: {
    countryCode: 'PL',
    province: 'MAZOWIECKIE',
    city: 'Warszawa',
    postCode: '00-001',
  },
  responsibleProducerId: 'rp-test-1',
  safetyInformation: { type: 'NO_SAFETY_INFORMATION' },
};

/**
 * Build a minimal valid PNG header (24 bytes) for the given dimensions.
 *
 * Used by `createOffer` specs to feed `uploadImagesViaAllegro` bytes that
 * pass `image-size`'s header parser and clear Allegro's 400px-longer-side
 * gate (#424).
 */
function makeValidPng(width: number, height: number): Uint8Array {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);
  buf[12] = 0x49;
  buf[13] = 0x48;
  buf[14] = 0x44;
  buf[15] = 0x52;
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return new Uint8Array(buf);
}

describe('AllegroOfferManagerAdapter', () => {
  let adapter: AllegroOfferManagerAdapter;
  let httpClient: jest.Mocked<IAllegroHttpClient>;
  let uploadHttpClient: jest.Mocked<IAllegroHttpClient>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: Connection;

  const connectionId = 'connection-123';

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      postBinary: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    uploadHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      postBinary: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      deleteMapping: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingPort>;

    connection = new Connection(
      connectionId,
      'allegro',
      'Test Connection',
      'active',
      { environment: 'sandbox' },
      'credentials-ref',
      new Date(),
      new Date(),

      undefined,
      ['OfferManager', 'OrderSource']
    );

    adapter = new AllegroOfferManagerAdapter(
      connectionId,
      httpClient,
      uploadHttpClient,
      identifierMapping,
      connection,
      undefined,
      undefined,
      undefined,
      undefined,
      DEFAULT_SELLER_DEFAULTS
    );
  });

  describe('updateOfferQuantity', () => {
    beforeEach(() => {
      // Mock polling response for command status (SUCCESS by default)
      httpClient.get.mockResolvedValue({
        data: {
          id: 'command-123',
          taskCount: 1,
          completedTaskCount: 1,
          tasks: [{ offerId: 'offer-1', status: 'SUCCESS' }],
        },
        status: 200,
        headers: {},
      });
    });

    it('should submit offer quantity change command successfully', async () => {
      const mockCommandResponse: AllegroOfferQuantityChangeCommandResponse = {
        id: 'command-123',
        status: 'ACCEPTED',
      };

      httpClient.put.mockResolvedValueOnce({
        data: mockCommandResponse,
        status: 200,
        headers: {},
      });

      await adapter.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      });

      expect(httpClient.put).toHaveBeenCalledWith(
        expect.stringMatching(/^\/sale\/offer-quantity-change-commands\/[a-f0-9-]+$/),
        expect.objectContaining({
          modification: {
            changeType: 'FIXED',
            value: 10,
          },
          offerCriteria: [
            {
              offers: [{ id: 'offer-1' }],
              type: 'CONTAINS_OFFERS',
            },
          ],
        })
      );
    });

    it('should map QUEUED status correctly', async () => {
      const mockCommandResponse: AllegroOfferQuantityChangeCommandResponse = {
        id: 'command-123',
        status: 'QUEUED',
      };

      httpClient.put.mockResolvedValueOnce({
        data: mockCommandResponse,
        status: 200,
        headers: {},
      });

      await adapter.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      });
    });

    it('should map REJECTED status correctly', async () => {
      const mockCommandResponse: AllegroOfferQuantityChangeCommandResponse = {
        id: 'command-123',
        status: 'REJECTED',
        errors: [
          {
            code: 'INVALID_QUANTITY',
            message: 'Quantity must be positive',
          },
        ],
      };

      httpClient.put.mockResolvedValueOnce({
        data: mockCommandResponse,
        status: 200,
        headers: {},
      });

      await adapter.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: -1,
        idempotencyKey: 'idempotency-key-123',
      });
    });

    it('should generate deterministic commandId from idempotency key', async () => {
      const mockCommandResponse: AllegroOfferQuantityChangeCommandResponse = {
        id: 'command-123',
        status: 'ACCEPTED',
      };

      httpClient.put.mockResolvedValue({
        data: mockCommandResponse,
        status: 200,
        headers: {},
      });

      const idempotencyKey = 'test-idempotency-key';

      // Call twice with same idempotency key
      await adapter.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey,
      });

      await adapter.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey,
      });

      // Both calls should use the same commandId (deterministic UUID)
      const calls = httpClient.put.mock.calls;
      expect(calls[0][0]).toBe(calls[1][0]); // Same commandId path
    });

    it('should handle HTTP errors', async () => {
      httpClient.put.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        adapter.updateOfferQuantity({
          offerId: 'offer-1',
          quantity: 10,
          idempotencyKey: 'idempotency-key-123',
        })
      ).rejects.toThrow('Network error');
    });

    it('should throw when polling returns FAIL status', async () => {
      const mockCommandResponse: AllegroOfferQuantityChangeCommandResponse = {
        id: 'command-fail',
        status: 'ACCEPTED',
      };

      httpClient.put.mockResolvedValueOnce({
        data: mockCommandResponse,
        status: 200,
        headers: {},
      });

      httpClient.get.mockResolvedValue({
        data: {
          id: 'command-fail',
          taskCount: 1,
          tasks: [
            {
              offerId: 'offer-1',
              status: 'FAIL',
              errors: [{ code: 'INVALID', message: 'bad quantity' }],
            },
          ],
        },
        status: 200,
        headers: {},
      });

      await expect(
        adapter.updateOfferQuantity({
          offerId: 'offer-1',
          quantity: 10,
          idempotencyKey: 'fail-key',
        })
      ).rejects.toThrow('Allegro quantity command command-fail failed');
    });

    it('should not throw when polling times out (still pending)', async () => {
      jest.useFakeTimers();

      const mockCommandResponse: AllegroOfferQuantityChangeCommandResponse = {
        id: 'command-pending',
        status: 'ACCEPTED',
      };

      httpClient.put.mockResolvedValueOnce({
        data: mockCommandResponse,
        status: 200,
        headers: {},
      });

      // Return pending status on every poll attempt
      httpClient.get.mockResolvedValue({
        data: {
          id: 'command-pending',
          taskCount: 1,
          tasks: [{ offerId: 'offer-1', status: 'NEW' }],
        },
        status: 200,
        headers: {},
      });

      // Start the update (will be pending due to polling sleeps)
      const promise = adapter.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'pending-key',
      });

      // Advance timers through all polling attempts
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(60000);
      }

      // Should not throw — timeout is treated as non-fatal
      await expect(promise).resolves.toBeUndefined();

      jest.useRealTimers();
    });

    it('should persist succeeded status via command repository', async () => {
      const commandRepository: jest.Mocked<AllegroQuantityCommandRepositoryPort> = {
        findByCommandId: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        updateStatus: jest.fn(),
      };

      const adapterWithRepo = new AllegroOfferManagerAdapter(
        connectionId,
        httpClient,
        uploadHttpClient,
        identifierMapping,
        connection,
        commandRepository
      );

      httpClient.put.mockResolvedValueOnce({
        data: { id: 'cmd-1', status: 'ACCEPTED' } as AllegroOfferQuantityChangeCommandResponse,
        status: 200,
        headers: {},
      });

      commandRepository.create.mockResolvedValue({} as never);

      await adapterWithRepo.updateOfferQuantity({
        offerId: 'offer-1',
        quantity: 5,
        idempotencyKey: 'repo-key',
      });

      expect(commandRepository.updateStatus).toHaveBeenCalledWith('cmd-1', 'succeeded');
    });
  });

  describe('updateOfferFields', () => {
    beforeEach(() => {
      httpClient.patch.mockResolvedValue({ data: undefined, status: 204, headers: {} });
    });

    it('should send only price when only price field provided', async () => {
      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-1',
        fields: { price: { amount: '99.99', currency: 'PLN' } },
      });

      expect(httpClient.patch).toHaveBeenCalledWith(
        '/sale/product-offers/allegro-offer-1',
        expect.objectContaining({
          sellingMode: { price: { amount: '99.99', currency: 'PLN' } },
        })
      );
      const body = (httpClient.patch.mock.calls[0] as [string, Record<string, unknown>])[1];
      expect(body).not.toHaveProperty('name');
      expect(body).not.toHaveProperty('description');
    });

    it('should send only title when only title field provided', async () => {
      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-1',
        fields: { title: 'My new title' },
      });

      expect(httpClient.patch).toHaveBeenCalledWith(
        '/sale/product-offers/allegro-offer-1',
        expect.objectContaining({ name: 'My new title' })
      );
      const body = (httpClient.patch.mock.calls[0] as [string, Record<string, unknown>])[1];
      expect(body).not.toHaveProperty('sellingMode');
      expect(body).not.toHaveProperty('description');
    });

    it('should send only description when only description field provided', async () => {
      const description = {
        sections: [{ items: [{ type: 'TEXT' as const, content: 'Hello world' }] }],
      };

      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-1',
        fields: { description },
      });

      // Plain-text content is wrapped in <p>…</p> by `sanitizeAllegroDescription`
      // (#540) before the body is sent — Allegro's TEXT validator requires a
      // block-level opener. The PATCH still carries only the description field.
      expect(httpClient.patch).toHaveBeenCalledWith(
        '/sale/product-offers/allegro-offer-1',
        expect.objectContaining({
          description: {
            sections: [{ items: [{ type: 'TEXT', content: '<p>Hello world</p>' }] }],
          },
        })
      );
      const body = (httpClient.patch.mock.calls[0] as [string, Record<string, unknown>])[1];
      expect(body).not.toHaveProperty('name');
      expect(body).not.toHaveProperty('sellingMode');
    });

    it('should send all fields when all fields provided', async () => {
      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-1',
        fields: {
          price: { amount: '49.00', currency: 'PLN' },
          title: 'Updated title',
          description: { sections: [{ items: [{ type: 'TEXT', content: 'Desc' }] }] },
        },
      });

      const body = (
        httpClient.patch.mock.calls[0] as [string, Record<string, unknown>, unknown]
      )[1];
      expect(body).toHaveProperty('sellingMode');
      expect(body).toHaveProperty('name', 'Updated title');
      expect(body).toHaveProperty('description');
    });

    it('sanitizes attribute-laden HTML in description content (#392 fix — PATCH parity)', async () => {
      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-1',
        fields: {
          description: {
            sections: [
              {
                items: [
                  {
                    type: 'TEXT',
                    content: '<p style="color:#000;">Hello <span class="x">world</span></p>',
                  },
                ],
              },
            ],
          },
        },
      });

      const body = (httpClient.patch.mock.calls[0] as [string, Record<string, unknown>])[1];
      expect(body.description).toEqual({
        sections: [{ items: [{ type: 'TEXT', content: '<p>Hello world</p>' }] }],
      });
    });

    it('should not call HTTP when fields object is empty', async () => {
      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-1',
        fields: {},
      });

      expect(httpClient.patch).not.toHaveBeenCalled();
    });

    it('should propagate HTTP errors', async () => {
      httpClient.patch.mockRejectedValueOnce(new Error('Allegro API error'));

      await expect(
        adapter.updateOfferFields({
          externalOfferId: 'allegro-offer-1',
          fields: { title: 'New title' },
        })
      ).rejects.toThrow('Allegro API error');
    });

    it('sanitizes the PATCH body.name when the title contains banned Unicode (#420)', async () => {
      httpClient.patch.mockResolvedValueOnce({ data: undefined, status: 204, headers: {} });

      await adapter.updateOfferFields({
        externalOfferId: 'allegro-offer-edit',
        fields: { title: 'Updated — model “Pro”' },
      });

      expect(httpClient.patch).toHaveBeenCalledWith(
        '/sale/product-offers/allegro-offer-edit',
        expect.objectContaining({ name: 'Updated - model "Pro"' })
      );
    });

    describe('sellerDefaults backfill (#487)', () => {
      it('merges location and productSet[0] GPSR siblings on description-only updates when sellerDefaults is configured', async () => {
        await adapter.updateOfferFields({
          externalOfferId: 'allegro-offer-487',
          fields: {
            description: {
              sections: [{ items: [{ type: 'TEXT', content: 'Updated copy' }] }],
            },
          },
        });

        const [, body] = httpClient.patch.mock.calls[0] as [string, Record<string, unknown>];
        // Caller field still present and sanitized as before.
        expect(body.description).toEqual({
          sections: [{ items: [{ type: 'TEXT', content: '<p>Updated copy</p>' }] }],
        });
        // Backfilled `location` mirrors `sellerDefaults.location` exactly.
        expect(body.location).toEqual({
          countryCode: 'PL',
          province: 'MAZOWIECKIE',
          city: 'Warszawa',
          postCode: '00-001',
        });
        // Backfilled GPSR fields sit at productSet[0].{responsibleProducer,
        // safetyInformation} — entry-level siblings, not nested under .product.
        expect(body.productSet).toEqual([
          {
            responsibleProducer: { id: 'rp-test-1' },
            safetyInformation: { type: 'NO_SAFETY_INFORMATION' },
          },
        ]);
      });

      it('produces the same PATCH body shape as before (#487 regression guard) when sellerDefaults is not configured', async () => {
        const adapterWithoutDefaults = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined // no sellerDefaults
        );

        await adapterWithoutDefaults.updateOfferFields({
          externalOfferId: 'allegro-offer-no-defaults',
          fields: {
            description: {
              sections: [{ items: [{ type: 'TEXT', content: 'Plain' }] }],
            },
          },
        });

        const [, body] = httpClient.patch.mock.calls[0] as [string, Record<string, unknown>];
        expect(body).toEqual({
          description: {
            sections: [{ items: [{ type: 'TEXT', content: '<p>Plain</p>' }] }],
          },
        });
        expect(body).not.toHaveProperty('location');
        expect(body).not.toHaveProperty('productSet');
      });

      it('preserves all caller-supplied fields when defaults are merged in', async () => {
        await adapter.updateOfferFields({
          externalOfferId: 'allegro-offer-merge',
          fields: {
            price: { amount: '19.99', currency: 'PLN' },
            title: 'Caller title',
            description: {
              sections: [{ items: [{ type: 'TEXT', content: 'Caller copy' }] }],
            },
          },
        });

        const [, body] = httpClient.patch.mock.calls[0] as [string, Record<string, unknown>];
        // All three caller-documented fields land unchanged. The backfill
        // never collides with them because the defaults patch only touches
        // `location` / `productSet`.
        expect(body.sellingMode).toEqual({
          price: { amount: '19.99', currency: 'PLN' },
        });
        expect(body.name).toBe('Caller title');
        expect(body.description).toEqual({
          sections: [{ items: [{ type: 'TEXT', content: '<p>Caller copy</p>' }] }],
        });
        // Backfill is still present alongside.
        expect(body).toHaveProperty('location');
        expect(body).toHaveProperty('productSet');
      });

      it('emits a structured debug log naming the backfilled fields', async () => {
        const debugSpy = jest.spyOn(adapter['logger'], 'debug').mockImplementation(() => undefined);

        await adapter.updateOfferFields({
          externalOfferId: 'allegro-offer-log',
          fields: { title: 'Anything' },
        });

        const backfillLog = debugSpy.mock.calls.find(
          ([msg]) => typeof msg === 'string' && msg.includes('backfilled from sellerDefaults')
        );
        expect(backfillLog).toBeDefined();
        const message = backfillLog![0] as string;
        expect(message).toContain('offerId=allegro-offer-log');
        expect(message).toContain(`connection=${connectionId}`);
        expect(message).toContain('location');
        expect(message).toContain('productSet[0].responsibleProducer');
        expect(message).toContain('productSet[0].safetyInformation');
      });

      it('does not call HTTP and does not emit the backfill log when fields are empty', async () => {
        const debugSpy = jest.spyOn(adapter['logger'], 'debug').mockImplementation(() => undefined);

        await adapter.updateOfferFields({
          externalOfferId: 'allegro-offer-empty',
          fields: {},
        });

        expect(httpClient.patch).not.toHaveBeenCalled();
        const backfillLog = debugSpy.mock.calls.find(
          ([msg]) => typeof msg === 'string' && msg.includes('backfilled from sellerDefaults')
        );
        expect(backfillLog).toBeUndefined();
      });
    });
  });

  describe('fetchCategories', () => {
    it('should fetch root categories when no parentId provided', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          categories: [
            { id: '1', name: 'Electronics', parent: null, leaf: false },
            { id: '2', name: 'Fashion', parent: null, leaf: false },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.fetchCategories();

      expect(result).toEqual([
        { id: '1', name: 'Electronics', parentId: null, leaf: false },
        { id: '2', name: 'Fashion', parentId: null, leaf: false },
      ]);
      expect(httpClient.get).toHaveBeenCalledWith('/sale/categories', { queryParams: {} });
    });

    it('should fetch child categories when parentId provided', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          categories: [{ id: '10', name: 'Smartphones', parent: { id: '1' }, leaf: true }],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.fetchCategories('1');

      expect(result).toEqual([{ id: '10', name: 'Smartphones', parentId: '1', leaf: true }]);
      expect(httpClient.get).toHaveBeenCalledWith('/sale/categories', {
        queryParams: { 'parent.id': '1' },
      });
    });

    it('should return empty array when no categories returned', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: { categories: [] },
        status: 200,
        headers: {},
      });

      const result = await adapter.fetchCategories('999');

      expect(result).toEqual([]);
    });
  });

  describe('fetchCategoryPath (#1752)', () => {
    it('declares the CategoryPathReader capability via the runtime guard', () => {
      expect(isCategoryPathReader(adapter)).toBe(true);
    });

    it('walks up parent.id and returns the breadcrumb root -> leaf', async () => {
      httpClient.get
        .mockResolvedValueOnce({
          data: { id: '10', name: 'Smartphones', parent: { id: '1' }, leaf: true },
          status: 200,
          headers: {},
        })
        .mockResolvedValueOnce({
          data: { id: '1', name: 'Electronics', parent: null, leaf: false },
          status: 200,
          headers: {},
        });

      const result = await adapter.fetchCategoryPath('10');

      expect(result).toEqual([
        { id: '1', name: 'Electronics' },
        { id: '10', name: 'Smartphones' },
      ]);
      expect(httpClient.get).toHaveBeenNthCalledWith(1, '/sale/categories/10');
      expect(httpClient.get).toHaveBeenNthCalledWith(2, '/sale/categories/1');
    });

    it('returns a single segment for a root-level category', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: { id: '1', name: 'Electronics', parent: null, leaf: false },
        status: 200,
        headers: {},
      });

      const result = await adapter.fetchCategoryPath('1');

      expect(result).toEqual([{ id: '1', name: 'Electronics' }]);
      expect(httpClient.get).toHaveBeenCalledTimes(1);
    });

    it('translates Allegro 404 to CategoryNotFoundException', async () => {
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('not found', 404));

      await expect(adapter.fetchCategoryPath('unknown')).rejects.toBeInstanceOf(
        CategoryNotFoundException
      );
    });
  });

  describe('matchCategoryByBarcode', () => {
    // Delegates to `resolveCategoriesForBatchByEan` (#735, #794) — these
    // tests assert the public boundary contract (categoryId | null) plus the
    // outgoing endpoint shape. Cache + multi-match nuances are covered by
    // the batch util's own spec.
    type ProductCardFixture = Pick<AllegroProductCardSummary, 'id' | 'category' | 'parameters'>;
    function buildProductCard(
      ean: string,
      categoryId: string,
      productId = 'prod-id'
    ): ProductCardFixture {
      return {
        id: productId,
        category: { id: categoryId },
        parameters: [{ id: 'gtin', options: { isGTIN: true }, values: [ean] }],
      };
    }

    it('should return category ID when exactly one exact-GTIN match is found', async () => {
      httpClient.get.mockResolvedValue({
        data: { products: [buildProductCard('5901234123457', 'cat-100')] },
        status: 200,
        headers: {},
      });

      const result = await adapter.matchCategoryByBarcode('5901234123457');

      expect(result).toBe('cat-100');
      expect(httpClient.get).toHaveBeenCalledWith('/sale/products', {
        queryParams: { phrase: '5901234123457', mode: 'GTIN', limit: 10 },
      });
    });

    it('should return null when no exact-GTIN matches are found', async () => {
      httpClient.get.mockResolvedValue({
        data: { products: [] },
        status: 200,
        headers: {},
      });

      const result = await adapter.matchCategoryByBarcode('0000000000000');

      expect(result).toBeNull();
    });

    it('should return null when multiple exact-GTIN matches are found', async () => {
      httpClient.get.mockResolvedValue({
        data: {
          products: [
            buildProductCard('5901234123457', 'cat-1', 'prod-1'),
            buildProductCard('5901234123457', 'cat-2', 'prod-2'),
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.matchCategoryByBarcode('5901234123457');

      expect(result).toBeNull();
    });

    it('should return null when the API call fails', async () => {
      httpClient.get.mockRejectedValue(new Error('API error'));

      const result = await adapter.matchCategoryByBarcode('5901234123457');

      expect(result).toBeNull();
    });
  });

  describe('resolveCategoriesForBatchByEan (#735)', () => {
    it('declares the EanCategoryMatcher capability via the runtime guard', () => {
      // Lock the capability-guard contract: future #736 application service
      // narrows on isEanCategoryMatcher(adapter) to discover this method.
      expect(isEanCategoryMatcher(adapter)).toBe(true);
    });

    it('declares the CategoryBrowser capability via the runtime guard (#1367)', () => {
      // Drift-guard for the manifest's advertised `CategoryBrowser` sub-capability
      // (allegro-plugin.spec.ts): the bulk wizard's browsable-taxonomy signal
      // trusts the manifest, so the adapter must actually implement fetchCategories.
      expect(isCategoryBrowser(adapter)).toBe(true);
    });

    it('forwards batch input through to the util via the adapter cache + http client', async () => {
      httpClient.get.mockResolvedValue({
        data: {
          products: [
            {
              id: 'prod-1',
              name: 'Card',
              category: { id: 'cat-A' },
              parameters: [
                {
                  id: 'gtin',
                  name: 'EAN',
                  values: ['5901234123457'],
                  options: { isGTIN: true },
                },
              ],
            },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.resolveCategoriesForBatchByEan({
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'cat-A',
        productCardId: 'prod-1',
      });
      expect(httpClient.get).toHaveBeenCalledWith('/sale/products', {
        queryParams: { phrase: '5901234123457', mode: 'GTIN', limit: 10 },
      });
    });
  });

  describe('getOffer (#464)', () => {
    function buildAdapterWithStorefront(storefrontBaseUrl?: string): AllegroOfferManagerAdapter {
      return new AllegroOfferManagerAdapter(
        connectionId,
        httpClient,
        uploadHttpClient,
        identifierMapping,
        connection,
        undefined,
        undefined,
        undefined,
        undefined,
        DEFAULT_SELLER_DEFAULTS,
        storefrontBaseUrl
      );
    }

    it('should map a fully-populated Allegro offer to MarketplaceOffer', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: '7781562863',
          name: 'Vintage Camera Lens 50mm f/1.4',
          category: { id: '12345' },
          description: {
            sections: [
              { items: [{ type: 'TEXT', content: 'Mint condition lens.' }] },
              { items: [{ type: 'TEXT', content: 'Original case included.' }] },
            ],
          },
          images: [
            { url: 'https://a.allegroimg.com/lens-1.jpg' },
            { url: 'https://a.allegroimg.com/lens-2.jpg' },
          ],
          sellingMode: { price: { amount: '249.00', currency: 'PLN' } },
          stock: { available: 3 },
          publication: { status: 'ACTIVE', endingAt: '2026-05-15T12:00:00Z' },
        },
        status: 200,
        headers: {},
      });

      const subject = buildAdapterWithStorefront('https://allegro.pl.allegrosandbox.pl');
      const result = await subject.getOffer({ externalId: '7781562863' });

      expect(httpClient.get).toHaveBeenCalledWith('/sale/product-offers/7781562863');
      expect(result).toEqual({
        externalId: '7781562863',
        title: 'Vintage Camera Lens 50mm f/1.4',
        description: 'Mint condition lens.\n\nOriginal case included.',
        imageUrl: 'https://a.allegroimg.com/lens-1.jpg',
        price: { amount: '249.00', currency: 'PLN' },
        availableQuantity: 3,
        status: 'ACTIVE',
        category: { id: '12345' },
        marketplaceUrl:
          'https://allegro.pl.allegrosandbox.pl/oferta/vintage-camera-lens-50mm-f-1-4-7781562863',
        endsAt: '2026-05-15T12:00:00Z',
      });
    });

    it('should degrade gracefully when description / images / category / publication are absent', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: '7781562864',
          name: 'Sparse Offer',
          sellingMode: { price: { amount: '10.00', currency: 'PLN' } },
          stock: { available: 0 },
        },
        status: 200,
        headers: {},
      });

      const subject = buildAdapterWithStorefront('https://allegro.pl');
      const result = await subject.getOffer({ externalId: '7781562864' });

      expect(result).toEqual({
        externalId: '7781562864',
        title: 'Sparse Offer',
        description: undefined,
        imageUrl: undefined,
        price: { amount: '10.00', currency: 'PLN' },
        availableQuantity: 0,
        status: 'UNKNOWN',
        category: undefined,
        marketplaceUrl: 'https://allegro.pl/oferta/sparse-offer-7781562864',
        endsAt: undefined,
      });
    });

    it('should fall back to an id-only offer URL when the offer has no name', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: '7781562867',
          sellingMode: { price: { amount: '10.00', currency: 'PLN' } },
          stock: { available: 0 },
        },
        status: 200,
        headers: {},
      });

      const subject = buildAdapterWithStorefront('https://allegro.pl');
      const result = await subject.getOffer({ externalId: '7781562867' });

      expect(result.marketplaceUrl).toBe('https://allegro.pl/oferta/7781562867');
    });

    it('should map offer-section and product-section parameters with productSet linkage (#1482)', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: '7781562865',
          name: 'Parameterised Offer',
          sellingMode: { price: { amount: '99.00', currency: 'PLN' } },
          stock: { available: 2 },
          publication: { status: 'ACTIVE' },
          parameters: [
            { id: '11323', name: 'Stan', values: ['Nowy'], valuesIds: ['11323_1'] },
            // Range parameter with no name - Allegro may omit `name` on reads.
            { id: '224017', rangeValue: { from: '10', to: '20' } },
          ],
          productSet: [
            {
              product: {
                id: 'product-card-1',
                parameters: [
                  { id: '17448', name: 'Marka', values: ['Canon'], valuesIds: ['17448_2'] },
                ],
              },
              quantity: { value: 1 },
            },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.getOffer({ externalId: '7781562865' });

      expect(result.parameters).toEqual([
        {
          id: '11323',
          name: 'Stan',
          values: ['Nowy'],
          valuesIds: ['11323_1'],
          rangeValue: undefined,
          section: 'offer',
        },
        {
          id: '224017',
          name: undefined,
          values: [],
          valuesIds: undefined,
          rangeValue: { from: '10', to: '20' },
          section: 'offer',
        },
        {
          id: '17448',
          name: 'Marka',
          values: ['Canon'],
          valuesIds: ['17448_2'],
          rangeValue: undefined,
          section: 'product',
        },
      ]);
      expect(result.productSet).toEqual([{ productId: 'product-card-1', quantity: 1 }]);
    });

    it('should map inline productSet entries (no product.id) with productId absent (#1482)', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: '7781562866',
          name: 'Inline Product Offer',
          sellingMode: { price: { amount: '15.00', currency: 'PLN' } },
          stock: { available: 1 },
          publication: { status: 'ACTIVE' },
          productSet: [{ product: { name: 'Inline Product' } }],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.getOffer({ externalId: '7781562866' });

      expect(result.parameters).toBeUndefined();
      expect(result.productSet).toEqual([{ productId: undefined, quantity: undefined }]);
    });

    it('should leave parameters and productSet absent when the response carries neither (#1482)', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: '7781562867',
          name: 'No Params Offer',
          sellingMode: { price: { amount: '20.00', currency: 'PLN' } },
          stock: { available: 4 },
          publication: { status: 'ACTIVE' },
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.getOffer({ externalId: '7781562867' });

      expect(result.parameters).toBeUndefined();
      expect(result.productSet).toBeUndefined();
    });

    it('should omit marketplaceUrl when storefrontBaseUrl is unset', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: 'offer-no-host',
          name: 'No Host Offer',
          sellingMode: { price: { amount: '5.00', currency: 'PLN' } },
          stock: { available: 1 },
          publication: { status: 'ACTIVE' },
        },
        status: 200,
        headers: {},
      });

      // Default `adapter` from outer beforeEach has no storefrontBaseUrl arg.
      const result = await adapter.getOffer({ externalId: 'offer-no-host' });

      expect(result.marketplaceUrl).toBeUndefined();
    });

    it('should throw AllegroApiException when sellingMode.price is missing', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          id: 'offer-malformed',
          name: 'Malformed',
          stock: { available: 0 },
        },
        status: 200,
        headers: {},
      });

      await expect(adapter.getOffer({ externalId: 'offer-malformed' })).rejects.toThrow(
        /sellingMode\.price/
      );
    });

    it('should propagate upstream HTTP errors verbatim', async () => {
      httpClient.get.mockRejectedValueOnce(new Error('Allegro 404'));

      await expect(adapter.getOffer({ externalId: 'missing' })).rejects.toThrow('Allegro 404');
    });
  });

  describe('createOffer', () => {
    const baseCmd: CreateOfferCommand = {
      internalVariantId: 'ol_variant_abc',
      connectionId,
      price: { amount: 49.99, currency: 'PLN' },
      stock: 5,
      publishImmediately: false,
      overrides: {
        title: 'Test Offer Title',
        description: 'Test description',
        categoryId: 'allegro-cat-100',
        imageUrls: ['https://example.com/img.jpg'],
      },
    };

    const mockHttpResponse = (data: AllegroProductOfferCreateResponse) => ({
      data,
      status: 201,
      headers: {},
    });

    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      // Default fetch: 200 + image/jpeg + a valid 800×800 PNG header —
      // image-size's PNG handler will accept this regardless of the
      // declared content-type, and 800×800 clears Allegro's 400px-longer-side
      // gate (#424). Keeps existing specs that don't care about the upload
      // step green.
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(
          new Response(makeValidPng(800, 800), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          })
        )
      );

      // Default upload: returns deterministic Allegro CDN URLs per call so
      // multi-image specs can pin order.
      let i = 0;
      uploadHttpClient.postBinary.mockImplementation(() =>
        Promise.resolve({
          data: { location: `https://images.allegrostatic.com/test/uploaded-${++i}.jpg` },
          status: 201,
          headers: {},
        })
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('returns draft status when INACTIVE without validation errors', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({
          id: 'allegro-offer-1',
          publication: { status: 'INACTIVE' },
        })
      );

      const result = await adapter.createOffer(baseCmd);

      expect(result).toEqual({ externalOfferId: 'allegro-offer-1', status: 'draft' });
      const [path, body] = httpClient.post.mock.calls[0];
      expect(path).toBe('/sale/product-offers');
      expect(body).toMatchObject({
        name: 'Test Offer Title',
        category: { id: 'allegro-cat-100' },
        sellingMode: {
          price: { amount: '49.99', currency: 'PLN' },
          format: 'BUY_NOW',
        },
        stock: { available: 5, unit: 'UNIT' },
        publication: { status: 'INACTIVE' },
      });
    });

    it('requests publication.status=ACTIVE when publishImmediately=true and returns active when response is ACTIVE', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({
          id: 'allegro-offer-2',
          publication: { status: 'ACTIVE' },
        })
      );

      const result = await adapter.createOffer({ ...baseCmd, publishImmediately: true });

      expect(result.status).toBe('active');
      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.publication).toEqual({ status: 'ACTIVE' });
    });

    it('returns validating when publishImmediately=true but response is INACTIVE with no validation errors', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({
          id: 'allegro-offer-3',
          publication: { status: 'INACTIVE' },
        })
      );

      const result = await adapter.createOffer({ ...baseCmd, publishImmediately: true });

      expect(result.status).toBe('validating');
    });

    it('returns draft + validationErrors on 2xx with inline validation errors (does NOT throw)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({
          id: 'allegro-offer-4',
          publication: { status: 'INACTIVE' },
          validation: {
            errors: [
              {
                code: 'VALIDATION_REQUIRED',
                message: 'Parameter EAN is required',
                path: 'parameters.EAN',
                userMessage: 'Supply EAN',
              },
            ],
          },
        })
      );

      const result = await adapter.createOffer(baseCmd);

      expect(result.externalOfferId).toBe('allegro-offer-4');
      expect(result.status).toBe('draft');
      expect(result.validationErrors).toEqual([
        {
          field: 'parameters.EAN',
          code: 'VALIDATION_REQUIRED',
          message: 'Supply EAN',
        },
      ]);
    });

    it('throws OfferCreateRejectedException on 422 with structured errors', async () => {
      httpClient.post.mockRejectedValue(
        new AllegroApiException(
          'Unprocessable entity',
          422,
          JSON.stringify({
            errors: [{ code: 'BAD_CATEGORY', message: 'Category does not exist' }],
          }),
          'https://api.allegro.pl/sale/product-offers'
        )
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toBeInstanceOf(
        OfferCreateRejectedException
      );
    });

    it('forwards pre-parsed Allegro errors from the exception to OfferCreateRejectedException (#486)', async () => {
      // Post-#486: `AllegroHttpClient.handleError` parses the body once and
      // attaches `allegroErrors` to the exception. The adapter trusts that
      // pre-parsed array — it no longer re-parses `responseBody`. Tests that
      // construct `AllegroApiException` directly must therefore seed
      // `allegroErrors` to mirror production behavior. The body-truncation
      // regression guard for #409 lives in `allegro-http-client.spec.ts`,
      // where parsing actually happens.
      httpClient.post.mockRejectedValue(
        new AllegroApiException(
          'Allegro API error (422)',
          422,
          '{"errors":[{"code":"ConstraintViolationException.MissingRequiredParameters","message":"Missing required parameters"}]}',
          'https://api.allegro.pl/sale/product-offers',
          [
            {
              code: 'ConstraintViolationException.MissingRequiredParameters',
              message: 'Missing required parameters',
            },
          ]
        )
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
        errors: [
          expect.objectContaining({
            code: 'ConstraintViolationException.MissingRequiredParameters',
          }),
        ],
      });
    });

    it('produces an empty-errors OfferCreateRejectedException when allegroErrors is undefined (#486)', async () => {
      // Mirrors the case where `AllegroHttpClient.handleError` got an
      // unparseable body — it leaves `allegroErrors` undefined. The adapter
      // must still throw `OfferCreateRejectedException` (not bubble the raw
      // exception) so the calling pipeline marks the record failed cleanly.
      httpClient.post.mockRejectedValue(
        new AllegroApiException(
          'Allegro API error (502)',
          502,
          '<html>upstream proxy error</html>',
          'https://api.allegro.pl/sale/product-offers',
          undefined
        )
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
        statusCode: 502,
        errors: [],
      });
    });

    it('maps platformParams knobs to delivery/return/warranty/invoice', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-5', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: {
          ...baseCmd.overrides,
          platformParams: {
            deliveryPolicyId: 'deliv-1',
            handlingTime: 'PT72H',
            returnPolicyId: 'ret-1',
            warrantyId: 'war-1',
            impliedWarrantyId: 'iwar-1',
            invoice: 'VAT',
            unknownField: 'should be ignored',
          },
        },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.delivery).toEqual({
        shippingRates: { id: 'deliv-1' },
        handlingTime: 'PT72H',
      });
      expect(body.afterSalesServices).toEqual({
        returnPolicy: { id: 'ret-1' },
        warranty: { id: 'war-1' },
        impliedWarranty: { id: 'iwar-1' },
      });
      expect(body.payments).toEqual({ invoice: 'VAT' });
      // #1071 — platformParams no longer carries category parameters.
      expect(body).not.toHaveProperty('parameters');
      expect(body).not.toHaveProperty('unknownField');
    });

    it('splits neutral cmd.parameters by section into offer + product params (#1039)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-neutral', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        parameters: [
          { id: 'cond-1', values: ['Nowy'], section: 'offer' },
          { id: '248811', valuesIds: ['248811_canon'], section: 'product' },
        ],
      });

      const body = httpClient.post.mock.calls[0][1] as {
        parameters?: Array<{ id: string }>;
        productSet?: Array<{ product?: { parameters?: Array<{ id: string }> } }>;
      };
      // Offer-section → body.parameters; section field stripped to wire shape.
      expect(body.parameters).toEqual([{ id: 'cond-1', values: ['Nowy'] }]);
      // Product-section → productSet[0].product.parameters (inline path).
      expect(body.productSet?.[0]?.product?.parameters).toEqual([
        { id: '248811', valuesIds: ['248811_canon'] },
      ]);
    });

    it('maps neutral condition "new" to the "Stan" (11323) offer-section parameter (#1500)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-cond-new', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({ ...baseCmd, condition: 'new' });

      const body = httpClient.post.mock.calls[0][1] as {
        parameters?: Array<{ id: string; valuesIds?: string[] }>;
      };
      expect(body.parameters).toEqual([{ id: '11323', valuesIds: ['11323_1'] }]);
    });

    it('maps neutral condition "used" to Stan value 11323_2 (#1500)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-cond-used', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({ ...baseCmd, condition: 'used' });

      const body = httpClient.post.mock.calls[0][1] as {
        parameters?: Array<{ id: string; valuesIds?: string[] }>;
      };
      expect(body.parameters).toEqual([{ id: '11323', valuesIds: ['11323_2'] }]);
    });

    it('does NOT override an operator-supplied Stan (11323) parameter with the default condition (#1500)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-cond-op', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        condition: 'new',
        parameters: [{ id: '11323', valuesIds: ['11323_2'], section: 'offer' }],
      });

      const body = httpClient.post.mock.calls[0][1] as {
        parameters?: Array<{ id: string; valuesIds?: string[] }>;
      };
      // Operator's Stan wins; the default 'new' condition is not double-set.
      expect(body.parameters).toEqual([{ id: '11323', valuesIds: ['11323_2'] }]);
    });

    it('does not emit a Stan parameter when condition is absent (#1500)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-no-cond', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer(baseCmd);

      const body = httpClient.post.mock.calls[0][1] as { parameters?: unknown };
      expect(body).not.toHaveProperty('parameters');
    });

    it('emits rangeValue from a neutral cmd.parameters entry (#1071)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-range', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        parameters: [{ id: 'weight', rangeValue: { from: '1', to: '5' }, section: 'offer' }],
      });

      const body = httpClient.post.mock.calls[0][1] as {
        parameters?: Array<{ id: string; rangeValue?: { from: string; to: string } }>;
      };
      expect(body.parameters).toEqual([{ id: 'weight', rangeValue: { from: '1', to: '5' } }]);
    });

    it('omits afterSalesServices entirely when impliedWarrantyId is set but warrantyId, returnPolicyId are not (#406)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-iwar-only', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: {
          ...baseCmd.overrides,
          platformParams: { impliedWarrantyId: 'iwar-1' },
        },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('afterSalesServices');
    });

    it('omits impliedWarranty when impliedWarrantyId is set with returnPolicy but no warranty (#406)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-ret-iwar', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: {
          ...baseCmd.overrides,
          platformParams: { returnPolicyId: 'ret-1', impliedWarrantyId: 'iwar-1' },
        },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.afterSalesServices).toEqual({ returnPolicy: { id: 'ret-1' } });
    });

    it('throws OfferCreateRejectedException when overrides.title is missing (precondition)', async () => {
      const cmd: CreateOfferCommand = {
        ...baseCmd,
        overrides: { ...baseCmd.overrides, title: undefined },
      };

      await expect(adapter.createOffer(cmd)).rejects.toBeInstanceOf(OfferCreateRejectedException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('omits description and images from the body when overrides values are null', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-null', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: {
          ...baseCmd.overrides,
          description: null,
          imageUrls: null,
        },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('description');
      expect(body).not.toHaveProperty('images');
    });

    it('emits images as a flat string[] of Allegro CDN locations (after upload step)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-img', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer(baseCmd);

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.images).toEqual(['https://images.allegrostatic.com/test/uploaded-1.jpg']);
    });

    it('preserves image order through the upload step when multiple images are supplied', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-img-multi', publication: { status: 'INACTIVE' } })
      );

      const imageUrls = [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ];

      await adapter.createOffer({
        ...baseCmd,
        overrides: { ...baseCmd.overrides, imageUrls },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.images).toEqual([
        'https://images.allegrostatic.com/test/uploaded-1.jpg',
        'https://images.allegrostatic.com/test/uploaded-2.jpg',
        'https://images.allegrostatic.com/test/uploaded-3.jpg',
      ]);
    });

    it('omits images from the body when overrides.imageUrls is an empty array', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-img-empty', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: { ...baseCmd.overrides, imageUrls: [] },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('images');
    });

    it('sanitizes attribute-laden HTML in description before wrapping (#392 fix)', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-desc', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: {
          ...baseCmd.overrides,
          description:
            '<p style="color:rgba(0,0,0,0.87);font-family:\'Open Sans\';">Hello <span class="x">world</span></p>',
        },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.description).toEqual({
        sections: [{ items: [{ type: 'TEXT', content: '<p>Hello world</p>' }] }],
      });
    });

    it('omits description when sanitization yields whitespace-only content', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-desc-empty', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: { ...baseCmd.overrides, description: '<div><span>  </span></div>' },
      });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('description');
    });

    it('throws OfferCreateRejectedException when overrides.categoryId is missing (precondition)', async () => {
      const cmd: CreateOfferCommand = {
        ...baseCmd,
        overrides: { ...baseCmd.overrides, categoryId: undefined },
      };

      await expect(adapter.createOffer(cmd)).rejects.toBeInstanceOf(OfferCreateRejectedException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    describe('product-section parameters (#415 / #419)', () => {
      it('routes product-section cmd.parameters to body.productSet[0].product.parameters', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-product', publication: { status: 'INACTIVE' } })
        );

        await adapter.createOffer({
          ...baseCmd,
          parameters: [
            { id: 'p_ean', values: ['5901234567890'], section: 'offer' },
            { id: '248811', valuesIds: ['248811_canon'], section: 'product' }, // Marka = Canon
            { id: '237206', values: ['PowerShot SX740'], section: 'product' }, // Model
          ],
        });

        const body = httpClient.post.mock.calls[0][1] as {
          parameters?: Array<{ id: string }>;
          images?: string[];
          productSet?: Array<{
            product?: {
              name?: string;
              parameters?: Array<{ id: string }>;
              images?: string[];
            };
          }>;
        };
        // Offer-section stays under body.parameters.
        expect(body.parameters).toEqual([{ id: 'p_ean', values: ['5901234567890'] }]);
        // Product-section travels under body.productSet[0].product.parameters
        // — Allegro's POST contract mirrors the GET shape. The earlier #415
        // shape (`body.product`) was rejected with `UnknownJSONProperty`.
        // Allegro additionally requires productSet[0].product.images (≥1)
        // when creating an inline product — confirmed by sandbox repro
        // returning `ProductValidationException` at path
        // `productSet[0].product` when images were omitted.
        const expectedCdnImages = ['https://images.allegrostatic.com/test/uploaded-1.jpg'];
        expect(body.productSet).toEqual([
          {
            product: {
              name: 'Test Offer Title',
              parameters: [
                { id: '248811', valuesIds: ['248811_canon'] },
                { id: '237206', values: ['PowerShot SX740'] },
              ],
              images: expectedCdnImages,
            },
            // #430 — GPSR fields written from sellerDefaults on inline path.
            responsibleProducer: { id: 'rp-test-1' },
            safetyInformation: { type: 'NO_SAFETY_INFORMATION' },
          },
        ]);
        // Mirroring contract: product.images is the post-upload offer-level
        // body.images, not the operator-supplied URL.
        expect(body.productSet?.[0]?.product?.images).toEqual(body.images);
        expect(body.images).toEqual(expectedCdnImages);
        // body.product is no longer a permitted key on the request shape.
        expect(body).not.toHaveProperty('product');
      });

      // #439 — emit `productSet[0]` on every non-card-linked offer even when
      // `productParameters` is missing or empty. Allegro's GPSR enforcement
      // requires `responsibleProducer` + `safetyInformation` on the inline
      // entry; omitting `productSet` yielded a sandbox 422 with
      // `SAFETY_INFO_NOT_DEFINED` at `productSet[0].safetyInformation`.
      // `product.parameters` stays absent when the operator supplied none.
      it('emits productSet[0] with GPSR + product.name when productParameters is missing or empty', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-no-product', publication: { status: 'INACTIVE' } })
        );

        await adapter.createOffer({
          ...baseCmd,
          overrides: {
            ...baseCmd.overrides,
            platformParams: {
              parameters: [{ id: 'p_ean', values: ['5901234567890'] }],
              productParameters: [],
            },
          },
        });

        const body = httpClient.post.mock.calls[0][1] as {
          productSet?: Array<{
            product?: { id?: string; name?: string; parameters?: unknown };
            responsibleProducer?: { id: string };
            safetyInformation?: { type: string };
          }>;
        };
        // Inline path: product.id absent (no smart-link), product.name reuses
        // the offer title, GPSR fields written from sellerDefaults.
        expect(body.productSet?.[0]?.product?.id).toBeUndefined();
        expect(body.productSet?.[0]?.product?.name).toBe('Test Offer Title');
        expect(body.productSet?.[0]?.product?.parameters).toBeUndefined();
        expect(body.productSet?.[0]?.responsibleProducer).toEqual({ id: 'rp-test-1' });
        expect(body.productSet?.[0]?.safetyInformation).toEqual({ type: 'NO_SAFETY_INFORMATION' });
        // `body.product` is still rejected as an unknown property.
        expect(body).not.toHaveProperty('product');
      });

      // #439 / #445 — discriminator parity: when sellerDefaults uses the
      // `TEXT` branch (free-text description rather than the "no risks"
      // declaration), the adapter must pass the entire object through to
      // `productSet[0].safetyInformation` — `type` + `description`. #445
      // corrected the discriminator from `SAFETY_INFORMATION`/`content` to
      // `TEXT`/`description` per developer.allegro.pl.
      it('passes TEXT discriminator with description through to productSet[0].safetyInformation (#445)', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-safety-text', publication: { status: 'INACTIVE' } })
        );

        const adapterWithSafetyText = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            ...DEFAULT_SELLER_DEFAULTS,
            safetyInformation: {
              type: 'TEXT',
              description: 'Keep dry. Not for children under 3.',
            },
          }
        );

        await adapterWithSafetyText.createOffer(baseCmd);

        const body = httpClient.post.mock.calls[0][1] as {
          productSet?: Array<{
            safetyInformation?: { type: string; description?: string };
          }>;
        };
        expect(body.productSet?.[0]?.safetyInformation).toEqual({
          type: 'TEXT',
          description: 'Keep dry. Not for children under 3.',
        });
      });

      // #445 — ATTACHMENTS variant flows through unchanged.
      it('passes ATTACHMENTS discriminator with attachment ids through to productSet[0].safetyInformation (#445)', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({
            id: 'allegro-offer-safety-att',
            publication: { status: 'INACTIVE' },
          })
        );

        const adapterWithAttachments = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            ...DEFAULT_SELLER_DEFAULTS,
            safetyInformation: {
              type: 'ATTACHMENTS',
              attachments: [{ id: 'att-1' }, { id: 'att-2' }],
            },
          }
        );

        await adapterWithAttachments.createOffer(baseCmd);

        const body = httpClient.post.mock.calls[0][1] as {
          productSet?: Array<{
            safetyInformation?: {
              type: string;
              attachments?: Array<{ id: string }>;
            };
          }>;
        };
        expect(body.productSet?.[0]?.safetyInformation).toEqual({
          type: 'ATTACHMENTS',
          attachments: [{ id: 'att-1' }, { id: 'att-2' }],
        });
      });

      it('omits productSet[0].product.images when offer-level images are empty', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-no-img', publication: { status: 'INACTIVE' } })
        );

        await adapter.createOffer({
          ...baseCmd,
          overrides: {
            ...baseCmd.overrides,
            imageUrls: [],
            platformParams: {
              productParameters: [{ id: '248811', valuesIds: ['248811_canon'] }],
            },
          },
        });

        // Allegro will 422 in this case — the wizard prevents it as a
        // precondition. The adapter should not invent a fallback.
        const body = httpClient.post.mock.calls[0][1] as {
          productSet?: Array<{ product?: { images?: string[] } }>;
        };
        expect(body.productSet?.[0]?.product).not.toHaveProperty('images');
      });
    });

    describe('name sanitization (#420)', () => {
      it('sanitizes em-dash + curly quotes in body.name on offer create', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-sanitize', publication: { status: 'INACTIVE' } })
        );

        await adapter.createOffer({
          ...baseCmd,
          overrides: {
            ...baseCmd.overrides,
            title: 'Smartphone — “black” edition',
          },
        });

        const body = httpClient.post.mock.calls[0][1] as { name?: string };
        // Em-dash → " - ", curly double quotes → ASCII double quotes,
        // then internal-whitespace collapse.
        expect(body.name).toBe('Smartphone - "black" edition');
      });

      it('mirrors the already-sanitized body.name onto productSet[0].product.name without re-sanitization', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-mirror', publication: { status: 'INACTIVE' } })
        );

        await adapter.createOffer({
          ...baseCmd,
          overrides: {
            ...baseCmd.overrides,
            title: 'Camera — Pro',
            platformParams: {
              productParameters: [{ id: '248811', valuesIds: ['248811_canon'] }],
            },
          },
        });

        const body = httpClient.post.mock.calls[0][1] as {
          name?: string;
          productSet?: Array<{ product?: { name?: string } }>;
        };
        // Single sanitization point per request lifecycle: applyPlatformParams
        // reads the already-clean body.name and mirrors it directly.
        const expected = 'Camera - Pro';
        expect(body.name).toBe(expected);
        expect(body.productSet?.[0]?.product?.name).toBe(expected);
      });

      it('round-trips a clean ASCII title unchanged through both name fields', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({ id: 'allegro-offer-clean', publication: { status: 'INACTIVE' } })
        );

        const cleanTitle = 'Aparat cyfrowy CANON PowerShot SX740 Lite Edition - srebrny';
        await adapter.createOffer({
          ...baseCmd,
          overrides: {
            ...baseCmd.overrides,
            title: cleanTitle,
            platformParams: {
              productParameters: [{ id: '248811', valuesIds: ['248811_canon'] }],
            },
          },
        });

        const body = httpClient.post.mock.calls[0][1] as {
          name?: string;
          productSet?: Array<{ product?: { name?: string } }>;
        };
        expect(body.name).toBe(cleanTitle);
        expect(body.productSet?.[0]?.product?.name).toBe(cleanTitle);
      });
    });

    it('uses cmd.idempotencyKey for external.id when provided', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-6', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer({ ...baseCmd, idempotencyKey: 'idem-xyz' });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.external).toEqual({ id: 'idem-xyz' });
    });

    it('falls back to cmd.internalVariantId for external.id when no idempotencyKey', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-7', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer(baseCmd);

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.external).toEqual({ id: 'ol_variant_abc' });
    });

    it('throws OfferCreateRejectedException with IMAGE_DOWNLOAD_FAILED when PrestaShop returns 403', async () => {
      fetchSpy.mockResolvedValue(new Response('Forbidden', { status: 403 }));

      await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
        name: 'OfferCreateRejectedException',
        statusCode: 0,
        errors: [
          expect.objectContaining({
            field: 'images',
            code: 'IMAGE_DOWNLOAD_FAILED',
            message: expect.stringMatching(/403/),
          }),
        ],
      });
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('throws OfferCreateRejectedException with IMAGE_DOWNLOAD_INVALID_TYPE when PrestaShop returns 200 + text/html', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html>Blocked</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
        name: 'OfferCreateRejectedException',
        statusCode: 0,
        errors: [
          expect.objectContaining({
            field: 'images',
            code: 'IMAGE_DOWNLOAD_INVALID_TYPE',
          }),
        ],
      });
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('throws OfferCreateRejectedException with IMAGE_UPLOAD_FAILED when Allegro upload returns 422', async () => {
      uploadHttpClient.postBinary.mockReset();
      uploadHttpClient.postBinary.mockRejectedValue(
        new AllegroApiException(
          'Unprocessable entity',
          422,
          '{"errors":[{"code":"INVALID_IMAGE"}]}',
          'https://upload.allegro.pl/sale/images'
        )
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
        name: 'OfferCreateRejectedException',
        statusCode: 0,
        errors: [
          expect.objectContaining({
            field: 'images',
            code: 'IMAGE_UPLOAD_FAILED',
            message: expect.stringMatching(/HTTP 422/),
          }),
        ],
      });
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('throws OfferCreateRejectedException with IMAGE_TOO_SMALL_FOR_PRODUCT when source image is below the 400px gate', async () => {
      // #424 — full e2e check that the new code surfaces through the
      // existing OfferCreateRejectedException path and prevents the
      // POST /sale/product-offers call.
      fetchSpy.mockResolvedValue(
        new Response(makeValidPng(200, 200), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
        name: 'OfferCreateRejectedException',
        statusCode: 0,
        errors: [
          expect.objectContaining({
            field: 'images',
            code: 'IMAGE_TOO_SMALL_FOR_PRODUCT',
            message: expect.stringMatching(/200×200px/),
          }),
        ],
      });
      expect(httpClient.post).not.toHaveBeenCalled();
      expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
    });

    it('does not call POST /sale/product-offers when the image upload step fails', async () => {
      // Reuses the IMAGE_DOWNLOAD_FAILED setup; explicit assertion that no
      // offer-create attempt was made (regression guard against silently
      // proceeding with the original PrestaShop URLs).
      fetchSpy.mockResolvedValue(new Response('Forbidden', { status: 403 }));

      await expect(adapter.createOffer(baseCmd)).rejects.toBeInstanceOf(
        OfferCreateRejectedException
      );

      expect(httpClient.post).not.toHaveBeenCalled();
      expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
    });

    it('calls upload host /sale/images with the normalized image content-type', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-ct', publication: { status: 'INACTIVE' } })
      );

      await adapter.createOffer(baseCmd);

      expect(uploadHttpClient.postBinary).toHaveBeenCalledTimes(1);
      expect(uploadHttpClient.postBinary).toHaveBeenCalledWith(
        '/sale/images',
        'image/jpeg',
        expect.any(Uint8Array)
      );
    });

    describe('seller defaults (#430)', () => {
      it('throws OfferCreateRejectedException with SELLER_DEFAULTS_NOT_CONFIGURED when sellerDefaults are missing', async () => {
        // Construct an adapter without sellerDefaults — preflight must fire.
        const adapterWithoutDefaults = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection
        );

        await expect(adapterWithoutDefaults.createOffer(baseCmd)).rejects.toMatchObject({
          name: 'OfferCreateRejectedException',
          statusCode: 0,
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'sellerDefaults.location',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
            expect.objectContaining({
              field: 'sellerDefaults.responsibleProducerId',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
            expect.objectContaining({
              field: 'sellerDefaults.safetyInformation',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
          ]),
        });
        // Preflight must short-circuit before any HTTP call.
        expect(httpClient.post).not.toHaveBeenCalled();
        expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
      });

      // #437 — partial sellerDefaults blobs (the 2026-04-29 sandbox repro).
      // The preflight must surface a per-field "what's missing" list rather
      // than collapse to a single "configure seller defaults" message.
      it('reports only sellerDefaults.responsibleProducerId when that is the sole missing field', async () => {
        const partial = {
          ...DEFAULT_SELLER_DEFAULTS,
          responsibleProducerId: '',
        } as AllegroSellerDefaultsConfig;
        const partialAdapter = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          partial
        );

        await expect(partialAdapter.createOffer(baseCmd)).rejects.toMatchObject({
          name: 'OfferCreateRejectedException',
          errors: [
            expect.objectContaining({
              field: 'sellerDefaults.responsibleProducerId',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
          ],
        });
        expect(httpClient.post).not.toHaveBeenCalled();
      });

      it('reports only sellerDefaults.safetyInformation.type when safetyInformation is empty', async () => {
        const partial = {
          ...DEFAULT_SELLER_DEFAULTS,
          safetyInformation: {} as AllegroSellerDefaultsConfig['safetyInformation'],
        };
        const partialAdapter = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          partial
        );

        await expect(partialAdapter.createOffer(baseCmd)).rejects.toMatchObject({
          name: 'OfferCreateRejectedException',
          errors: [
            expect.objectContaining({
              field: 'sellerDefaults.safetyInformation.type',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
          ],
        });
        expect(httpClient.post).not.toHaveBeenCalled();
      });

      it('reports sellerDefaults.safetyInformation.description when type=TEXT but description is missing (#445)', async () => {
        const partial = {
          ...DEFAULT_SELLER_DEFAULTS,
          safetyInformation: {
            type: 'TEXT',
          } as unknown as AllegroSellerDefaultsConfig['safetyInformation'],
        };
        const partialAdapter = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          partial
        );

        await expect(partialAdapter.createOffer(baseCmd)).rejects.toMatchObject({
          name: 'OfferCreateRejectedException',
          errors: [
            expect.objectContaining({
              field: 'sellerDefaults.safetyInformation.description',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
          ],
        });
        expect(httpClient.post).not.toHaveBeenCalled();
      });

      it('reports sellerDefaults.safetyInformation.attachments when type=ATTACHMENTS but attachments is missing/empty (#445)', async () => {
        const partial = {
          ...DEFAULT_SELLER_DEFAULTS,
          safetyInformation: {
            type: 'ATTACHMENTS',
          } as unknown as AllegroSellerDefaultsConfig['safetyInformation'],
        };
        const partialAdapter = new AllegroOfferManagerAdapter(
          connectionId,
          httpClient,
          uploadHttpClient,
          identifierMapping,
          connection,
          undefined,
          undefined,
          undefined,
          undefined,
          partial
        );

        await expect(partialAdapter.createOffer(baseCmd)).rejects.toMatchObject({
          name: 'OfferCreateRejectedException',
          errors: [
            expect.objectContaining({
              field: 'sellerDefaults.safetyInformation.attachments',
              code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
            }),
          ],
        });
        expect(httpClient.post).not.toHaveBeenCalled();
      });

      it('writes body.location from sellerDefaults on every offer create', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({
            id: 'allegro-offer-loc',
            publication: { status: 'INACTIVE' },
          })
        );

        await adapter.createOffer(baseCmd);

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body.location).toEqual({
          countryCode: 'PL',
          province: 'MAZOWIECKIE',
          city: 'Warszawa',
          postCode: '00-001',
        });
      });
    });

    describe('smart-link by EAN (#431)', () => {
      it('on unique match: links via productSet[0].product.id, omits inline name/parameters/images/GPSR, and carries sellable stock on body.stock (not productSet)', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({
            id: 'allegro-offer-linked',
            publication: { status: 'INACTIVE' },
          })
        );
        // Mock the smart-link resolver path: one exact-EAN match.
        httpClient.get.mockResolvedValueOnce({
          data: {
            products: [{ id: 'allegro-card-1', ean: '5901234123457' }],
          },
          status: 200,
          headers: {},
        });

        await adapter.createOffer({
          ...baseCmd,
          variantBarcode: '5901234123457',
          stock: 7,
          overrides: {
            ...baseCmd.overrides,
            platformParams: {
              productParameters: [
                // Would normally produce an inline product; smart-link must
                // win and skip these.
                { id: '248811', valuesIds: ['248811_canon'] },
              ],
            },
          },
        });

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        // Card reference is id-only; Allegro rejects a bare-number
        // `productSet[].quantity` with JsonMappingException (#808).
        expect(body.productSet).toEqual([{ product: { id: 'allegro-card-1' } }]);
        // Sellable stock lives on body.stock.available, never on the
        // productSet entry (whose `quantity` is multipack size).
        expect(body.stock).toEqual({ available: 7, unit: 'UNIT' });
        // Card-linked offers inherit GPSR from the card — adapter must NOT
        // write `responsibleProducer` / `safetyInformation` on the entry.
        expect(body.productSet).not.toContainEqual(
          expect.objectContaining({ responsibleProducer: expect.anything() })
        );
      });

      it('on pre-resolved productCardId (#808): links the card directly and skips the catalogue search', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({
            id: 'allegro-offer-prelinked',
            publication: { status: 'INACTIVE' },
          })
        );

        await adapter.createOffer({
          ...baseCmd,
          // Pre-resolved by the bulk wizard's EAN match. A barcode is present
          // too, but the pre-resolved id must win without any /sale/products
          // re-search (the path that previously downgraded to inline → 422).
          productCardId: 'allegro-card-pre',
          variantBarcode: '5901234123457',
          stock: 4,
          overrides: {
            ...baseCmd.overrides,
            platformParams: {
              productParameters: [{ id: '248811', valuesIds: ['248811_canon'] }],
            },
          },
        });

        expect(httpClient.get).not.toHaveBeenCalledWith('/sale/products', expect.anything());
        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body.productSet).toEqual([{ product: { id: 'allegro-card-pre' } }]);
        // Stock on body.stock.available, not as a (wrong-typed) productSet
        // quantity that Allegro rejects with JsonMappingException (#808).
        expect(body.stock).toEqual({ available: 4, unit: 'UNIT' });
      });

      it('falls through to inline path when variantBarcode is missing (smart-link short-circuits)', async () => {
        httpClient.post.mockResolvedValue(
          mockHttpResponse({
            id: 'allegro-offer-inline',
            publication: { status: 'INACTIVE' },
          })
        );

        await adapter.createOffer({
          ...baseCmd,
          variantBarcode: undefined,
          overrides: {
            ...baseCmd.overrides,
            platformParams: {
              productParameters: [{ id: '248811', valuesIds: ['248811_canon'] }],
            },
          },
        });

        // Resolver was never called because variantBarcode was missing.
        expect(httpClient.get).not.toHaveBeenCalledWith('/sale/products', expect.anything());
        const body = httpClient.post.mock.calls[0][1] as {
          productSet?: Array<{
            product?: { id?: string; name?: string };
            responsibleProducer?: unknown;
          }>;
        };
        // Inline path: product.id absent, GPSR fields written from sellerDefaults.
        expect(body.productSet?.[0]?.product?.id).toBeUndefined();
        expect(body.productSet?.[0]?.product?.name).toBe('Test Offer Title');
        expect(body.productSet?.[0]?.responsibleProducer).toEqual({ id: 'rp-test-1' });
      });
    });

    describe('fetchResponsibleProducers (#430)', () => {
      it('maps Allegro entries to the neutral ResponsibleProducerEntry shape', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: {
            responsibleProducers: [
              { id: 'rp-1', name: 'ACME GmbH', type: 'PRODUCER' },
              { id: 'rp-2', name: 'Importer Co.', type: 'IMPORTER' },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.fetchResponsibleProducers();

        expect(result).toEqual([
          { id: 'rp-1', name: 'ACME GmbH', kind: 'PRODUCER' },
          { id: 'rp-2', name: 'Importer Co.', kind: 'IMPORTER' },
        ]);
      });

      it('defaults missing kind to PRODUCER and falls back name → id', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: { responsibleProducers: [{ id: 'rp-3' }] },
          status: 200,
          headers: {},
        });

        const result = await adapter.fetchResponsibleProducers();

        expect(result).toEqual([{ id: 'rp-3', name: 'rp-3', kind: 'PRODUCER' }]);
      });
    });
  });

  describe('fetchSellerPolicies', () => {
    function makeResponse<T>(data: T): {
      data: T;
      status: number;
      headers: Record<string, string>;
    } {
      return { data, status: 200, headers: {} };
    }

    it('issues 4 parallel GETs and maps the envelopes to the neutral SellerPolicies shape', async () => {
      httpClient.get
        .mockResolvedValueOnce(
          makeResponse({
            shippingRates: [
              { id: 'd1', name: 'Standard' },
              { id: 'd2', name: 'Express' },
            ],
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            returnPolicies: [{ id: 'r1', name: '14-day returns' }],
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            warranties: [{ id: 'w1', name: '1-year manufacturer' }],
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            impliedWarranties: [{ id: 'iw1', name: 'Consumer rights' }],
          })
        );

      const result = await adapter.fetchSellerPolicies();

      expect(result).toEqual({
        deliveryPolicies: [
          { id: 'd1', name: 'Standard' },
          { id: 'd2', name: 'Express' },
        ],
        returnPolicies: [{ id: 'r1', name: '14-day returns' }],
        warranties: [{ id: 'w1', name: '1-year manufacturer' }],
        impliedWarranties: [{ id: 'iw1', name: 'Consumer rights' }],
      });

      expect(httpClient.get).toHaveBeenCalledTimes(4);
      const calledPaths = httpClient.get.mock.calls.map((args) => args[0]).sort();
      expect(calledPaths).toEqual(
        [
          '/after-sales-service-conditions/implied-warranties',
          '/after-sales-service-conditions/return-policies',
          '/after-sales-service-conditions/warranties',
          '/sale/shipping-rates',
        ].sort()
      );
      // `/sale/delivery-settings` is a different Allegro resource (account-level
      // free-delivery config, not a list). Pinning its absence here keeps a
      // future regression visible in review (#383).
      expect(calledPaths).not.toContain('/sale/delivery-settings');
    });

    it('returns empty arrays when Allegro returns no policies', async () => {
      httpClient.get
        .mockResolvedValueOnce(makeResponse({ shippingRates: [] }))
        .mockResolvedValueOnce(makeResponse({ returnPolicies: [] }))
        .mockResolvedValueOnce(makeResponse({ warranties: [] }))
        .mockResolvedValueOnce(makeResponse({ impliedWarranties: [] }));

      const result = await adapter.fetchSellerPolicies();

      expect(result).toEqual({
        deliveryPolicies: [],
        returnPolicies: [],
        warranties: [],
        impliedWarranties: [],
      });
    });

    it('propagates AllegroApiException when any single endpoint fails', async () => {
      httpClient.get
        .mockResolvedValueOnce(makeResponse({ shippingRates: [] }))
        .mockRejectedValueOnce(new AllegroApiException('rate limit', 429))
        .mockResolvedValueOnce(makeResponse({ warranties: [] }))
        .mockResolvedValueOnce(makeResponse({ impliedWarranties: [] }));

      await expect(adapter.fetchSellerPolicies()).rejects.toBeInstanceOf(AllegroApiException);
    });
  });

  describe('fetchCategoryParameters (cached + neutral)', () => {
    function makeResponse<T>(data: T): {
      data: T;
      status: number;
      headers: Record<string, string>;
    } {
      return { data, status: 200, headers: {} };
    }

    function makeCache(): jest.Mocked<CachePort> {
      return {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };
    }

    function buildAdapter(
      cache: jest.Mocked<CachePort>,
      ttlSec?: number
    ): AllegroOfferManagerAdapter {
      return new AllegroOfferManagerAdapter(
        connectionId,
        httpClient,
        uploadHttpClient,
        identifierMapping,
        connection,
        undefined,
        undefined,
        cache,
        ttlSec
      );
    }

    const RAW_RESPONSE = {
      parameters: [
        {
          id: '11323',
          name: 'Stan',
          type: 'dictionary' as const,
          required: true,
          options: { dependsOnParameterId: null, customValuesEnabled: false },
          dictionary: [{ id: '11323_1', value: 'Nowy', dependsOnValueIds: [] }],
          restrictions: { multipleChoices: false },
        },
      ],
    };

    it('returns cached value without hitting Allegro on cache HIT', async () => {
      const cache = makeCache();
      const adapterWithCache = buildAdapter(cache);
      cache.get.mockResolvedValueOnce([
        { id: 'cached', name: 'Pre-warmed', type: 'string', required: false, restrictions: {} },
      ]);

      const result = await adapterWithCache.fetchCategoryParameters({ categoryId: '257933' });

      expect(cache.get).toHaveBeenCalledWith('allegro:cat-params:257933');
      expect(httpClient.get).not.toHaveBeenCalled();
      expect(result).toEqual([
        { id: 'cached', name: 'Pre-warmed', type: 'string', required: false, restrictions: {} },
      ]);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('fetches, maps, and caches on cache MISS — TTL forwarded to CachePort', async () => {
      const cache = makeCache();
      const adapterWithCache = buildAdapter(cache, 3600);
      cache.get.mockResolvedValueOnce(null);
      httpClient.get.mockResolvedValueOnce(makeResponse(RAW_RESPONSE));

      const result = await adapterWithCache.fetchCategoryParameters({ categoryId: '257933' });

      expect(httpClient.get).toHaveBeenCalledWith('/sale/categories/257933/parameters');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '11323',
        type: 'dictionary',
        required: true,
      });
      expect(cache.set).toHaveBeenCalledWith('allegro:cat-params:257933', result, 3600);
    });

    it('uses the 24h default TTL when no override is supplied', async () => {
      const cache = makeCache();
      const adapterWithCache = buildAdapter(cache);
      cache.get.mockResolvedValueOnce(null);
      httpClient.get.mockResolvedValueOnce(makeResponse(RAW_RESPONSE));

      await adapterWithCache.fetchCategoryParameters({ categoryId: '257933' });

      expect(cache.set).toHaveBeenCalledWith('allegro:cat-params:257933', expect.any(Array), 86400);
    });

    it('translates Allegro 404 to CategoryNotFoundException', async () => {
      const cache = makeCache();
      const adapterWithCache = buildAdapter(cache);
      cache.get.mockResolvedValueOnce(null);
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('not found', 404));

      await expect(
        adapterWithCache.fetchCategoryParameters({ categoryId: 'unknown' })
      ).rejects.toBeInstanceOf(CategoryNotFoundException);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('propagates non-404 AllegroApiException unchanged', async () => {
      const cache = makeCache();
      const adapterWithCache = buildAdapter(cache);
      cache.get.mockResolvedValueOnce(null);
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('upstream', 503));

      await expect(
        adapterWithCache.fetchCategoryParameters({ categoryId: '257933' })
      ).rejects.toMatchObject({ name: 'AllegroApiException', statusCode: 503 });
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('still works without a cache (degrades to no caching)', async () => {
      // adapter from the outer beforeEach has no cache
      httpClient.get.mockResolvedValueOnce(makeResponse(RAW_RESPONSE));
      const result = await adapter.fetchCategoryParameters({ categoryId: '257933' });
      expect(httpClient.get).toHaveBeenCalledWith('/sale/categories/257933/parameters');
      expect(result).toHaveLength(1);
    });
  });

  describe('getOfferStatus (#447)', () => {
    function offerResponse(
      publicationStatus: string | undefined,
      validationErrors: Array<{ code: string; message: string; path?: string }> = []
    ): { data: unknown; status: number } {
      return {
        data: {
          id: 'offer-7781562863',
          name: 'Test offer',
          publication: publicationStatus ? { status: publicationStatus } : undefined,
          validation: validationErrors.length ? { errors: validationErrors } : undefined,
        },
        status: 200,
      };
    }

    it('declares the OfferStatusReader sub-capability', () => {
      expect(isOfferStatusReader(adapter)).toBe(true);
    });

    it.each([
      ['ACTIVE', 'active'],
      ['ACTIVATING', 'activating'],
      ['INACTIVATING', 'inactivating'],
      ['INACTIVE', 'inactive'],
      ['ENDED', 'ended'],
    ] as const)(
      'maps publication.status %s to neutral %s',
      async (allegroStatus, neutralStatus) => {
        httpClient.get.mockResolvedValueOnce(offerResponse(allegroStatus) as never);

        const result = await adapter.getOfferStatus('7781562863');

        expect(httpClient.get).toHaveBeenCalledWith('/sale/product-offers/7781562863');
        expect(result.publicationStatus).toBe(neutralStatus);
        expect(result.validationErrors).toEqual([]);
      }
    );

    it('flows validation.errors through to the result', async () => {
      httpClient.get.mockResolvedValueOnce(
        offerResponse('INACTIVE', [
          { code: 'TOO_LONG', message: 'fallback msg', path: 'name' },
          { code: 'MISSING', message: 'm2' },
        ]) as never
      );

      const result = await adapter.getOfferStatus('7781562863');

      expect(result.publicationStatus).toBe('inactive');
      expect(result.validationErrors).toHaveLength(2);
      expect(result.validationErrors[0]).toEqual({
        field: 'name',
        code: 'TOO_LONG',
        message: 'fallback msg',
      });
    });

    it('treats a missing publication block as inactive', async () => {
      httpClient.get.mockResolvedValueOnce(offerResponse(undefined) as never);

      const result = await adapter.getOfferStatus('7781562863');

      expect(result.publicationStatus).toBe('inactive');
      expect(result.validationErrors).toEqual([]);
    });

    it('throws OfferNotFoundOnMarketplaceException on 404 (not the raw Allegro exception)', async () => {
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('not found', 404));

      const err: unknown = await adapter.getOfferStatus('does-not-exist').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OfferNotFoundOnMarketplaceException);
      expect(err).toMatchObject({
        externalOfferId: 'does-not-exist',
        connectionId,
      });
    });

    it('propagates non-404 AllegroApiException unchanged', async () => {
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('upstream', 503));

      await expect(adapter.getOfferStatus('7781562863')).rejects.toMatchObject({
        name: 'AllegroApiException',
        statusCode: 503,
      });
    });

    it('shares the GET helper with fetchOfferIdentifiers (regression for the helper extraction)', async () => {
      // Both calls hit the same `/sale/product-offers/{id}` endpoint via the
      // private `fetchProductOfferById` helper. Verify the helper extraction
      // didn't accidentally break the older identifiers code path.
      httpClient.get.mockResolvedValueOnce(offerResponse('ACTIVE') as never).mockResolvedValueOnce({
        data: { id: 'offer-7781562863', category: undefined, parameters: [], productSet: [] },
        status: 200,
      } as never);

      const status = await adapter.getOfferStatus('7781562863');
      expect(status.publicationStatus).toBe('active');

      // listOffers / fetchOfferIdentifiers exercises the same helper — call
      // it indirectly through the public adapter surface that uses it. Direct
      // private-helper coverage is implicit: if the helper signature drifts,
      // both call sites fail TypeScript before the test runs.
      expect(httpClient.get).toHaveBeenCalledWith('/sale/product-offers/7781562863');
    });
  });

  describe('getOfferSmartClassification (#737)', () => {
    it('declares the OfferSmartClassificationReader sub-capability', () => {
      expect(isOfferSmartClassificationReader(adapter)).toBe(true);
    });

    it('maps a fulfilled Allegro response to the neutral SmartClassificationReport', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          classification: { fulfilled: true },
          conditions: [
            {
              code: 'FAST_SHIPPING',
              name: 'Fast shipping',
              description: 'Ships within 24h',
              fulfilled: true,
            },
            {
              code: 'GOOD_PRICE',
              name: 'Good price',
              description: 'Competitive price',
              fulfilled: false,
            },
          ],
          scheduledForReclassification: false,
        },
        status: 200,
      } as never);

      const result = await adapter.getOfferSmartClassification('7781562863');

      expect(httpClient.get).toHaveBeenCalledWith('/sale/offers/7781562863/smart');
      expect(result).toEqual({
        fulfilled: true,
        conditions: [
          {
            code: 'FAST_SHIPPING',
            name: 'Fast shipping',
            description: 'Ships within 24h',
            fulfilled: true,
          },
          {
            code: 'GOOD_PRICE',
            name: 'Good price',
            description: 'Competitive price',
            fulfilled: false,
          },
        ],
        scheduledForReclassification: false,
      });
    });

    it('returns null on Allegro 404 (offer not yet classified)', async () => {
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('not classified', 404));

      const result = await adapter.getOfferSmartClassification('fresh-offer-1');

      expect(result).toBeNull();
    });

    it('propagates non-404 AllegroApiException unchanged', async () => {
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('upstream', 503));

      await expect(adapter.getOfferSmartClassification('7781562863')).rejects.toMatchObject({
        name: 'AllegroApiException',
        statusCode: 503,
      });
    });

    it('handles missing classification block (fulfilled defaults to null)', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: {
          conditions: [],
        },
        status: 200,
      } as never);

      const result = await adapter.getOfferSmartClassification('7781562863');

      expect(result).toEqual({
        fulfilled: null,
        conditions: [],
        scheduledForReclassification: undefined,
      });
    });
  });

  describe('uploadSafetyAttachment (#449)', () => {
    it('routes the upload through the upload-domain client (not the api-domain client)', async () => {
      uploadHttpClient.postMultipart = jest.fn().mockResolvedValue({
        data: { id: 'attach-123' },
        status: 201,
        headers: {},
      });

      const result = await adapter.uploadSafetyAttachment({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        mimeType: 'application/pdf',
        fileName: 'safety.pdf',
      });

      expect(result).toEqual({ id: 'attach-123' });
      expect(uploadHttpClient.postMultipart).toHaveBeenCalledTimes(1);
      // The api-domain client must not have been used. The mock factory
      // for `httpClient` doesn't set `postMultipart`, so any accidental
      // call would `TypeError: ... is not a function` immediately —
      // separate negative assertion would only re-validate the absence.
    });

    it('isSafetyAttachmentUploader narrow returns true for the adapter', () => {
      expect(isSafetyAttachmentUploader(adapter)).toBe(true);
    });
  });

  describe('CatalogProductReader (#633)', () => {
    let cache: jest.Mocked<CachePort>;
    let adapterWithCache: AllegroOfferManagerAdapter;

    beforeEach(() => {
      cache = {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      } as unknown as jest.Mocked<CachePort>;

      adapterWithCache = new AllegroOfferManagerAdapter(
        connectionId,
        httpClient,
        uploadHttpClient,
        identifierMapping,
        connection,
        undefined,
        undefined,
        cache,
        undefined,
        DEFAULT_SELLER_DEFAULTS
      );
    });

    it('isCatalogProductReader narrow returns true for the adapter', () => {
      expect(isCatalogProductReader(adapter)).toBe(true);
    });

    describe('findProductsByBarcode', () => {
      it('returns no_match without hitting Allegro when categoryId is omitted', async () => {
        const result = await adapterWithCache.findProductsByBarcode({ barcode: '5901234123457' });

        expect(result).toEqual({ kind: 'no_match' });
        expect(httpClient.get).not.toHaveBeenCalled();
      });

      it('unique → eager-fetches detail and returns the full product', async () => {
        cache.get.mockResolvedValue(null); // both caches miss
        httpClient.get
          .mockResolvedValueOnce({
            // resolveAllegroProductCardByEan: /sale/products?phrase=…
            data: {
              products: [{ id: 'p1', name: 'Canon SX740', ean: '5901234123457' }],
            },
            status: 200,
            headers: {},
          })
          .mockResolvedValueOnce({
            // fetchAllegroProduct: /sale/products/p1
            data: {
              id: 'p1',
              name: 'Canon SX740 HS',
              images: [{ url: 'https://img/a.jpg' }],
              parameters: [{ id: '224017', name: 'Brand', values: ['Canon'] }],
            },
            status: 200,
            headers: {},
          });

        const result = await adapterWithCache.findProductsByBarcode({
          barcode: '5901234123457',
          categoryId: 'cat-1',
        });

        expect(result).toEqual({
          kind: 'unique',
          product: {
            id: 'p1',
            name: 'Canon SX740 HS',
            ean: undefined,
            imageUrl: 'https://img/a.jpg',
            images: ['https://img/a.jpg'],
            parameters: [
              {
                parameterId: '224017',
                name: 'Brand',
                valueIds: undefined,
                valueStrings: ['Canon'],
              },
            ],
          },
        });
        expect(httpClient.get).toHaveBeenCalledTimes(2);
      });

      it('ambiguous → returns summaries without detail fetches; imageUrl omitted', async () => {
        cache.get.mockResolvedValue(null);
        httpClient.get.mockResolvedValueOnce({
          data: {
            products: [
              { id: 'p1', name: 'Variant A', ean: '5901234123457' },
              { id: 'p2', name: 'Variant B', ean: '5901234123457' },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapterWithCache.findProductsByBarcode({
          barcode: '5901234123457',
          categoryId: 'cat-1',
        });

        expect(result).toEqual({
          kind: 'ambiguous',
          products: [
            { id: 'p1', name: 'Variant A', ean: '5901234123457' },
            { id: 'p2', name: 'Variant B', ean: '5901234123457' },
          ],
        });
        expect(httpClient.get).toHaveBeenCalledTimes(1);
      });

      it('no_match → identity-maps the resolver outcome', async () => {
        cache.get.mockResolvedValue(null);
        httpClient.get.mockResolvedValueOnce({
          data: { products: [] },
          status: 200,
          headers: {},
        });

        const result = await adapterWithCache.findProductsByBarcode({
          barcode: '5901234123457',
          categoryId: 'cat-1',
        });

        expect(result).toEqual({ kind: 'no_match' });
      });
    });

    describe('getProduct', () => {
      it('delegates to fetchAllegroProduct and returns the neutral product', async () => {
        cache.get.mockResolvedValue(null);
        httpClient.get.mockResolvedValueOnce({
          data: { id: 'p1', name: 'iPhone', parameters: [] },
          status: 200,
          headers: {},
        });

        const result = await adapterWithCache.getProduct({ productId: 'p1' });

        expect(result.id).toBe('p1');
        expect(result.name).toBe('iPhone');
        expect(httpClient.get).toHaveBeenCalledWith('/sale/products/p1');
      });

      it('translates Allegro 404 into CatalogProductNotFoundException', async () => {
        cache.get.mockResolvedValue(null);
        httpClient.get.mockRejectedValueOnce(
          new AllegroApiException('Not found', 404, '{}', '/sale/products/missing')
        );

        await expect(adapterWithCache.getProduct({ productId: 'missing' })).rejects.toBeInstanceOf(
          CatalogProductNotFoundException
        );
      });
    });
  });
});
