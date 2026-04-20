/**
 * Allegro Marketplace Adapter Tests
 *
 * Unit tests for AllegroMarketplaceAdapter. Tests order fetching,
 * order mapping, and offer quantity updates.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroMarketplaceAdapter } from '../allegro-marketplace.adapter';
import { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { AllegroQuantityCommandRepositoryPort } from '../../../domain/ports/allegro-quantity-command-repository.port';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import {
  AllegroCheckoutForm,
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommandResponse,
  AllegroProductOfferCreateResponse,
} from '../../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { AllegroOfferCreateException } from '../../../domain/exceptions/allegro-offer-create.exception';
import type { CreateOfferCommand } from '@openlinker/core/integrations';

describe('AllegroMarketplaceAdapter', () => {
  let adapter: AllegroMarketplaceAdapter;
  let httpClient: jest.Mocked<IAllegroHttpClient>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: Connection;

  const connectionId = 'connection-123';

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
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
      ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
    );

    adapter = new AllegroMarketplaceAdapter(connectionId, httpClient, identifierMapping, connection);
  });

  describe('listOrderFeed', () => {
    it('should fetch orders with cursor and return feed items', async () => {
      const mockEventsResponse: AllegroOrderEventsResponse = {
        events: [
          {
            id: 'event-1',
            order: {
              id: 'order-1',
              checkoutForm: {
                id: 'checkout-form-1',
              },
            },
            occurredAt: '2024-01-01T00:00:00Z',
            type: 'ORDER_CREATED',
          },
          {
            id: 'event-2',
            order: {
              id: 'order-2',
              checkoutForm: {
                id: 'checkout-form-2',
              },
            },
            occurredAt: '2024-01-01T01:00:00Z',
            type: 'ORDER_CREATED',
          },
        ],
        lastEventId: 'event-2',
      };

      httpClient.get.mockResolvedValueOnce({
        data: mockEventsResponse,
        status: 200,
        headers: {},
      });

      const result = await adapter.listOrderFeed({
        fromCursor: 'event-0',
        limit: 10,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        externalOrderId: 'checkout-form-1',
        eventType: 'updated',
        occurredAt: '2024-01-01T00:00:00Z',
        eventKey: 'event-1',
        eventId: 'event-1',
        raw: { type: 'ORDER_CREATED' },
      });
      expect(result.items[1]).toEqual({
        externalOrderId: 'checkout-form-2',
        eventType: 'updated',
        occurredAt: '2024-01-01T01:00:00Z',
        eventKey: 'event-2',
        eventId: 'event-2',
        raw: { type: 'ORDER_CREATED' },
      });
      expect(result.nextCursor).toBe('event-2');
      expect(httpClient.get).toHaveBeenCalledWith('/order/events', {
        queryParams: { from: 'event-0', limit: 10 },
      });
    });

    it('should handle empty events response', async () => {
      const mockEventsResponse: AllegroOrderEventsResponse = {
        events: [],
        lastEventId: 'event-0',
      };

      httpClient.get.mockResolvedValueOnce({
        data: mockEventsResponse,
        status: 200,
        headers: {},
      });

      const result = await adapter.listOrderFeed({
        fromCursor: 'event-0',
        limit: 100,
      });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('event-0');
    });

    it('should use last event ID as nextCursor when lastEventId is not provided', async () => {
      const mockEventsResponse: AllegroOrderEventsResponse = {
        events: [
          {
            id: 'event-1',
            order: {
              id: 'order-1',
              checkoutForm: {
                id: 'checkout-form-1',
              },
            },
            occurredAt: '2024-01-01T00:00:00Z',
            type: 'ORDER_CREATED',
          },
        ],
      };

      httpClient.get.mockResolvedValueOnce({
        data: mockEventsResponse,
        status: 200,
        headers: {},
      });

      const result = await adapter.listOrderFeed({
        fromCursor: null,
        limit: 100,
      });

      expect(result.nextCursor).toBe('event-1');
    });

    it('should handle HTTP errors', async () => {
      httpClient.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        adapter.listOrderFeed({
          fromCursor: null,
          limit: 100,
        }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('getOrder', () => {
    it('should fetch order and map to IncomingOrder with external-only refs', async () => {
      const mockCheckoutForm: AllegroCheckoutForm = {
        id: 'checkout-form-1',
        buyer: {
          id: 'buyer-1',
          email: 'buyer@example.com',
          login: 'buyer-login',
          firstName: 'John',
          lastName: 'Doe',
          address: {
            street: '123 Main St',
            city: 'Warsaw',
            zipCode: '00-001',
            countryCode: 'PL',
          },
        },
        payment: {
          type: 'ONLINE',
          finishedAt: '2024-01-01T00:00:00Z',
        },
        lineItems: [
          {
            id: 'line-item-1',
            offer: {
              id: 'offer-1',
              name: 'Test Product',
            },
            quantity: 2,
            price: {
              amount: '100.00',
              currency: 'PLN',
            },
          },
        ],
        summary: {
          totalToPay: {
            amount: '200.00',
            currency: 'PLN',
          },
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      httpClient.get.mockResolvedValueOnce({
        data: mockCheckoutForm,
        status: 200,
        headers: {},
      });

      const result = await adapter.getOrder({ externalOrderId: 'checkout-form-1' });

      expect(result.externalOrderId).toBe('checkout-form-1');
      expect(result.orderNumber).toBe('checkout-form-1');
      expect(result.customerExternalId).toBe('buyer-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].productRef).toEqual({ type: 'offer', externalId: 'offer-1' });
      expect(result.items[0].quantity).toBe(2);
      expect(result.items[0].price).toBe(100.0);
      expect(result.totals.total).toBe(200.0);
      expect(result.totals.currency).toBe('PLN');
      expect(result.status).toBe('processing');
      expect(result.metadata).toEqual({
        buyer: {
          email: 'buyer@example.com',
          login: 'buyer-login',
        },
      });
      expect(httpClient.get).toHaveBeenCalledWith('/order/checkout-forms/checkout-form-1');
    });

    it('should handle HTTP errors', async () => {
      httpClient.get.mockRejectedValueOnce(new Error('Order not found'));

      await expect(adapter.getOrder({ externalOrderId: 'checkout-form-1' })).rejects.toThrow(
        'Order not found',
      );
    });
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

      const adapterWithRepo = new AllegroMarketplaceAdapter(
        connectionId,
        httpClient,
        identifierMapping,
        connection,
        undefined,
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

    it('throws AllegroOfferCreateException on 422 with structured errors', async () => {
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
        AllegroOfferCreateException,
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
  });
});

