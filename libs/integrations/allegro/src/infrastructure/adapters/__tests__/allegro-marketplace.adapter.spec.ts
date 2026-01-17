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
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import {
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommandResponse,
} from '../../../domain/types/allegro-api.types';
import { AllegroCheckoutForm } from '../../mappers/allegro-order.mapper';

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
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
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
  });
});



