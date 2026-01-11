/**
 * Allegro Order Mapper Tests
 *
 * Unit tests for AllegroOrderMapper. Tests mapping of Allegro checkout forms
 * to unified Order schema and order events to marketplace feed items.
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers/__tests__
 */
import { AllegroOrderMapper } from '../allegro-order.mapper';
import { AllegroCheckoutForm, AllegroOrderEvent } from '../allegro-order.mapper';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

describe('AllegroOrderMapper', () => {
  let mapper: AllegroOrderMapper;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let logger: Logger;
  const connectionId = 'connection-123';

  beforeEach(() => {
    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingPort>;

    logger = new Logger('AllegroOrderMapperTest');

    mapper = new AllegroOrderMapper(connectionId, identifierMapping, logger);
  });

  describe('toUnifiedOrder', () => {
    const mockCheckoutForm: AllegroCheckoutForm = {
      id: 'checkout-form-1',
      buyer: {
        id: 'buyer-1',
        email: 'buyer@example.com',
        login: 'buyer-login',
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '+48123456789',
        address: {
          street: '123 Main St',
          city: 'Warsaw',
          zipCode: '00-001',
          countryCode: 'PL',
        },
      },
      payment: {
        type: 'ONLINE',
        provider: 'PAYU',
        finishedAt: '2024-01-01T00:00:00Z',
        paidAmount: {
          amount: '200.00',
          currency: 'PLN',
        },
      },
      lineItems: [
        {
          id: 'line-item-1',
          offer: {
            id: 'offer-1',
            name: 'Test Product 1',
          },
          quantity: 2,
          price: {
            amount: '100.00',
            currency: 'PLN',
          },
          boughtAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'line-item-2',
          offer: {
            id: 'offer-2',
            name: 'Test Product 2',
          },
          quantity: 1,
          price: {
            amount: '50.00',
            currency: 'PLN',
          },
        },
      ],
      summary: {
        totalToPay: {
          amount: '250.00',
          currency: 'PLN',
        },
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T01:00:00Z',
    };

    it('should map checkout form to unified Order with internal IDs', async () => {
      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol_customer_123')
        .mockResolvedValueOnce('ol_product_456')
        .mockResolvedValueOnce('ol_product_789')
        .mockResolvedValueOnce('ol_order_101');

      const result = await mapper.toUnifiedOrder(mockCheckoutForm);

      expect(result.id).toBe('ol_order_101');
      expect(result.orderNumber).toBe('checkout-form-1');
      expect(result.customerId).toBe('ol_customer_123');
      expect(result.status).toBe('processing');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].productId).toBe('ol_product_456');
      expect(result.items[0].quantity).toBe(2);
      expect(result.items[0].price).toBe(100.0);
      expect(result.items[0].sku).toBe('offer-1');
      expect(result.items[1].productId).toBe('ol_product_789');
      expect(result.items[1].quantity).toBe(1);
      expect(result.items[1].price).toBe(50.0);
      expect(result.totals.total).toBe(250.0);
      expect(result.totals.currency).toBe('PLN');
      expect(result.shippingAddress?.firstName).toBe('John');
      expect(result.shippingAddress?.lastName).toBe('Doe');
      expect(result.shippingAddress?.address1).toBe('123 Main St');
      expect(result.shippingAddress?.city).toBe('Warsaw');
      expect(result.shippingAddress?.postalCode).toBe('00-001');
      expect(result.shippingAddress?.country).toBe('PL');
      expect(result.shippingAddress?.phone).toBe('+48123456789');
      expect(result.billingAddress).toEqual(result.shippingAddress);
      expect(result.createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(result.updatedAt).toEqual(new Date('2024-01-01T01:00:00Z'));

      // Verify ID mapping calls
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Customer',
        'buyer-1',
        connectionId,
        {
          metadata: {
            email: 'buyer@example.com',
            login: 'buyer-login',
          },
        },
      );
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        'offer-1',
        connectionId,
        {
          metadata: {
            name: 'Test Product 1',
          },
        },
      );
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        'offer-2',
        connectionId,
        {
          metadata: {
            name: 'Test Product 2',
          },
        },
      );
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Order',
        'checkout-form-1',
        connectionId,
        {
          metadata: {
            buyerId: 'buyer-1',
            createdAt: '2024-01-01T00:00:00Z',
          },
        },
      );
    });

    it('should map order status to pending when payment not finished', async () => {
      const checkoutFormWithoutPayment: AllegroCheckoutForm = {
        ...mockCheckoutForm,
        payment: {
          type: 'ONLINE',
        },
      };

      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol_customer_123')
        .mockResolvedValueOnce('ol_product_456')
        .mockResolvedValueOnce('ol_order_101');

      const result = await mapper.toUnifiedOrder(checkoutFormWithoutPayment);

      expect(result.status).toBe('pending');
    });

    it('should handle missing address', async () => {
      const checkoutFormWithoutAddress: AllegroCheckoutForm = {
        ...mockCheckoutForm,
        buyer: {
          ...mockCheckoutForm.buyer,
          address: undefined,
        },
      };

      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol_customer_123')
        .mockResolvedValueOnce('ol_product_456')
        .mockResolvedValueOnce('ol_order_101');

      const result = await mapper.toUnifiedOrder(checkoutFormWithoutAddress);

      expect(result.shippingAddress).toBeUndefined();
      expect(result.billingAddress).toBeUndefined();
    });

    it('should handle missing optional fields', async () => {
      const minimalCheckoutForm: AllegroCheckoutForm = {
        id: 'checkout-form-1',
        buyer: {
          id: 'buyer-1',
        },
        payment: {
          type: 'ONLINE',
        },
        lineItems: [],
        summary: {
          totalToPay: {
            amount: '0.00',
            currency: 'PLN',
          },
        },
      };

      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol_customer_123')
        .mockResolvedValueOnce('ol_order_101');

      const result = await mapper.toUnifiedOrder(minimalCheckoutForm);

      expect(result.items).toHaveLength(0);
      expect(result.totals.total).toBe(0);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw error with context when customer ID mapping fails', async () => {
      identifierMapping.getOrCreateInternalId.mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      await expect(mapper.toUnifiedOrder(mockCheckoutForm)).rejects.toThrow(
        'Failed to map customer ID for Allegro buyer buyer-1 (checkout form: checkout-form-1): Database connection failed',
      );
    });

    it('should throw error with context when product ID mapping fails', async () => {
      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol_customer_123')
        .mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(mapper.toUnifiedOrder(mockCheckoutForm)).rejects.toThrow(
        'Failed to map product ID for Allegro offer offer-1 (checkout form: checkout-form-1): Database connection failed',
      );
    });

    it('should throw error with context when order ID mapping fails', async () => {
      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol_customer_123')
        .mockResolvedValueOnce('ol_product_456')
        .mockResolvedValueOnce('ol_product_789')
        .mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(mapper.toUnifiedOrder(mockCheckoutForm)).rejects.toThrow(
        'Failed to map order ID for Allegro checkout form checkout-form-1: Database connection failed',
      );
    });
  });

  describe('toMarketplaceFeedItems', () => {
    it('should map order events to marketplace feed items', () => {
      const events: AllegroOrderEvent[] = [
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
          type: 'ORDER_UPDATED',
        },
      ];

      const result = mapper.toMarketplaceFeedItems(events);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        eventId: 'event-1',
        checkoutFormId: 'checkout-form-1',
      });
      expect(result[1]).toEqual({
        eventId: 'event-2',
        checkoutFormId: 'checkout-form-2',
      });
    });

    it('should handle empty events array', () => {
      const result = mapper.toMarketplaceFeedItems([]);

      expect(result).toHaveLength(0);
    });
  });
});



