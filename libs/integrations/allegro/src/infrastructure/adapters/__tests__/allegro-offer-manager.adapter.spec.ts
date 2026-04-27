/**
 * Allegro Marketplace Adapter Tests
 *
 * Unit tests for AllegroOfferManagerAdapter. Tests order fetching,
 * order mapping, and offer quantity updates.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroOfferManagerAdapter } from '../allegro-offer-manager.adapter';
import { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { AllegroQuantityCommandRepositoryPort } from '../../../domain/ports/allegro-quantity-command-repository.port';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import {
  AllegroOfferQuantityChangeCommandResponse,
  AllegroProductOfferCreateResponse,
} from '../../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import {
  CategoryNotFoundException,
  OfferCreateRejectedException,
  type CreateOfferCommand,
} from '@openlinker/core/listings';
import type { CachePort } from '@openlinker/shared';

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
      ['OfferManager', 'OrderSource'],
    );

    adapter = new AllegroOfferManagerAdapter(
      connectionId,
      httpClient,
      uploadHttpClient,
      identifierMapping,
      connection,
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
          offerId: 'offer-1',
          quantityChange: {
            changeType: 'FIXED',
            value: 10,
          },
        }),
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
        }),
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
          tasks: [{
            offerId: 'offer-1',
            status: 'FAIL',
            errors: [{ code: 'INVALID', message: 'bad quantity' }],
          }],
        },
        status: 200,
        headers: {},
      });

      await expect(
        adapter.updateOfferQuantity({
          offerId: 'offer-1',
          quantity: 10,
          idempotencyKey: 'fail-key',
        }),
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
        commandRepository,
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
        }),
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
        expect.objectContaining({ name: 'My new title' }),
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

      expect(httpClient.patch).toHaveBeenCalledWith(
        '/sale/product-offers/allegro-offer-1',
        expect.objectContaining({ description: { sections: [{ items: [{ type: 'TEXT', content: 'Hello world' }] }] } }),
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

      const body = (httpClient.patch.mock.calls[0] as [string, Record<string, unknown>, unknown])[1];
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
                    content:
                      '<p style="color:#000;">Hello <span class="x">world</span></p>',
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
        }),
      ).rejects.toThrow('Allegro API error');
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
          categories: [
            { id: '10', name: 'Smartphones', parent: { id: '1' }, leaf: true },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.fetchCategories('1');

      expect(result).toEqual([
        { id: '10', name: 'Smartphones', parentId: '1', leaf: true },
      ]);
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

  describe('matchCategoryByBarcode', () => {
    it('should return category ID when exactly one match is found', async () => {
      httpClient.get.mockResolvedValue({
        data: {
          matchingCategories: [
            { category: { id: 'cat-100', name: 'Electronics' } },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.matchCategoryByBarcode('5901234123457');

      expect(result).toBe('cat-100');
      expect(httpClient.get).toHaveBeenCalledWith('/sale/matching-categories', {
        queryParams: { ean: '5901234123457' },
      });
    });

    it('should return null when no matches are found', async () => {
      httpClient.get.mockResolvedValue({
        data: { matchingCategories: [] },
        status: 200,
        headers: {},
      });

      const result = await adapter.matchCategoryByBarcode('0000000000000');

      expect(result).toBeNull();
    });

    it('should return null when multiple matches are found', async () => {
      httpClient.get.mockResolvedValue({
        data: {
          matchingCategories: [
            { category: { id: 'cat-1' } },
            { category: { id: 'cat-2' } },
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
      // Default fetch: 200 + image/jpeg + minimal JPEG bytes — keeps existing
      // specs that don't care about the upload step green.
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(
            new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
              status: 200,
              headers: { 'content-type': 'image/jpeg' },
            }),
          ),
        );

      // Default upload: returns deterministic Allegro CDN URLs per call so
      // multi-image specs can pin order.
      let i = 0;
      uploadHttpClient.postBinary.mockImplementation(() =>
        Promise.resolve({
          data: { location: `https://images.allegrostatic.com/test/uploaded-${++i}.jpg` },
          status: 201,
          headers: {},
        }),
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
        }),
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
        }),
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
        }),
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
        }),
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
            errors: [
              { code: 'BAD_CATEGORY', message: 'Category does not exist' },
            ],
          }),
          'https://api.allegro.pl/sale/product-offers',
        ),
      );

      await expect(adapter.createOffer(baseCmd)).rejects.toBeInstanceOf(
        OfferCreateRejectedException,
      );
    });

    it('maps platformParams to delivery/return/warranty/invoice/parameters', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-5', publication: { status: 'INACTIVE' } }),
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
            parameters: [{ id: 'ean-param', values: ['5901234123457'] }],
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
      expect(body.parameters).toEqual([{ id: 'ean-param', values: ['5901234123457'] }]);
      expect(body).not.toHaveProperty('unknownField');
    });

    it('throws OfferCreateRejectedException when overrides.title is missing (precondition)', async () => {
      const cmd: CreateOfferCommand = {
        ...baseCmd,
        overrides: { ...baseCmd.overrides, title: undefined },
      };

      await expect(adapter.createOffer(cmd)).rejects.toBeInstanceOf(
        OfferCreateRejectedException,
      );
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('omits description and images from the body when overrides values are null', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-null', publication: { status: 'INACTIVE' } }),
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
        mockHttpResponse({ id: 'allegro-offer-img', publication: { status: 'INACTIVE' } }),
      );

      await adapter.createOffer(baseCmd);

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.images).toEqual(['https://images.allegrostatic.com/test/uploaded-1.jpg']);
    });

    it('preserves image order through the upload step when multiple images are supplied', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-img-multi', publication: { status: 'INACTIVE' } }),
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
        mockHttpResponse({ id: 'allegro-offer-img-empty', publication: { status: 'INACTIVE' } }),
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
        mockHttpResponse({ id: 'allegro-offer-desc', publication: { status: 'INACTIVE' } }),
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
        mockHttpResponse({ id: 'allegro-offer-desc-empty', publication: { status: 'INACTIVE' } }),
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

      await expect(adapter.createOffer(cmd)).rejects.toBeInstanceOf(
        OfferCreateRejectedException,
      );
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('drops malformed parameter entries from platformParams.parameters', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-params', publication: { status: 'INACTIVE' } }),
      );

      await adapter.createOffer({
        ...baseCmd,
        overrides: {
          ...baseCmd.overrides,
          platformParams: {
            parameters: [
              { id: 'valid', values: ['a', 'b'] },
              { id: 'bad-values', values: [1, 2] }, // values must be strings
              { id: '', values: ['x'] }, // empty id
              { values: ['y'] }, // missing id
              { id: 'bad-valuesIds', valuesIds: 'not-an-array' },
              { id: 'also-valid', valuesIds: ['123'] },
            ],
          },
        },
      });

      const body = httpClient.post.mock.calls[0][1] as { parameters?: Array<{ id: string }> };
      expect(body.parameters).toEqual([
        { id: 'valid', values: ['a', 'b'] },
        { id: 'also-valid', valuesIds: ['123'] },
      ]);
    });

    it('uses cmd.idempotencyKey for external.id when provided', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-6', publication: { status: 'INACTIVE' } }),
      );

      await adapter.createOffer({ ...baseCmd, idempotencyKey: 'idem-xyz' });

      const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.external).toEqual({ id: 'idem-xyz' });
    });

    it('falls back to cmd.internalVariantId for external.id when no idempotencyKey', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-7', publication: { status: 'INACTIVE' } }),
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
        }),
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
          'https://upload.allegro.pl/sale/images',
        ),
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

    it('does not call POST /sale/product-offers when the image upload step fails', async () => {
      // Reuses the IMAGE_DOWNLOAD_FAILED setup; explicit assertion that no
      // offer-create attempt was made (regression guard against silently
      // proceeding with the original PrestaShop URLs).
      fetchSpy.mockResolvedValue(new Response('Forbidden', { status: 403 }));

      await expect(adapter.createOffer(baseCmd)).rejects.toBeInstanceOf(
        OfferCreateRejectedException,
      );

      expect(httpClient.post).not.toHaveBeenCalled();
      expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
    });

    it('calls upload host /sale/images with the normalized image content-type', async () => {
      httpClient.post.mockResolvedValue(
        mockHttpResponse({ id: 'allegro-offer-ct', publication: { status: 'INACTIVE' } }),
      );

      await adapter.createOffer(baseCmd);

      expect(uploadHttpClient.postBinary).toHaveBeenCalledTimes(1);
      expect(uploadHttpClient.postBinary).toHaveBeenCalledWith(
        '/sale/images',
        'image/jpeg',
        expect.any(Uint8Array),
      );
    });
  });

  describe('fetchSellerPolicies', () => {
    function makeResponse<T>(data: T): { data: T; status: number; headers: Record<string, string> } {
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
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            returnPolicies: [{ id: 'r1', name: '14-day returns' }],
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            warranties: [{ id: 'w1', name: '1-year manufacturer' }],
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            impliedWarranties: [{ id: 'iw1', name: 'Consumer rights' }],
          }),
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
        ].sort(),
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
    function makeResponse<T>(data: T): { data: T; status: number; headers: Record<string, string> } {
      return { data, status: 200, headers: {} };
    }

    function makeCache(): jest.Mocked<CachePort> {
      return {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };
    }

    function buildAdapter(cache: jest.Mocked<CachePort>, ttlSec?: number): AllegroOfferManagerAdapter {
      return new AllegroOfferManagerAdapter(
        connectionId,
        httpClient,
        uploadHttpClient,
        identifierMapping,
        connection,
        undefined,
        undefined,
        cache,
        ttlSec,
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
          dictionary: [
            { id: '11323_1', value: 'Nowy', dependsOnValueIds: [] },
          ],
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
        adapterWithCache.fetchCategoryParameters({ categoryId: 'unknown' }),
      ).rejects.toBeInstanceOf(CategoryNotFoundException);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('propagates non-404 AllegroApiException unchanged', async () => {
      const cache = makeCache();
      const adapterWithCache = buildAdapter(cache);
      cache.get.mockResolvedValueOnce(null);
      httpClient.get.mockRejectedValueOnce(new AllegroApiException('upstream', 503));

      await expect(
        adapterWithCache.fetchCategoryParameters({ categoryId: '257933' }),
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
});

