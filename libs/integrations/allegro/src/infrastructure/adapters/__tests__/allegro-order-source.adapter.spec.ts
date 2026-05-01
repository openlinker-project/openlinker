/**
 * Allegro Order Source Adapter Tests
 *
 * Unit tests for AllegroOrderSourceAdapter (split out of the legacy
 * AllegroMarketplaceAdapter as part of #328). Covers the two OrderSourcePort
 * methods: `listOrderFeed` (event-journal cursor) and
 * `getOrder({ externalOrderId })` (checkout-form hydration).
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroOrderSourceAdapter } from '../allegro-order-source.adapter';
import { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import {
  AllegroCheckoutForm,
  AllegroOrderEventsResponse,
} from '../../../domain/types/allegro-api.types';

describe('AllegroOrderSourceAdapter', () => {
  let adapter: AllegroOrderSourceAdapter;
  let httpClient: jest.Mocked<IAllegroHttpClient>;
  let connection: Connection;

  const connectionId = 'connection-123';

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    connection = new Connection(
      connectionId,
      'allegro',
      'Test Allegro',
      'active',
      { environment: 'sandbox' },
      'credentials-ref',
      new Date(),
      new Date(),
      undefined,
      ['OrderSource', 'OfferManager'],
    );

    adapter = new AllegroOrderSourceAdapter(connectionId, httpClient, connection);
  });

  describe('listOrderFeed', () => {
    it('should deduplicate events by checkoutFormId, map Allegro event types, and surface lastEventId as nextCursor', async () => {
      const mockResponse: AllegroOrderEventsResponse = {
        events: [
          {
            id: 'event-1',
            order: { id: 'order-1', checkoutForm: { id: 'checkout-1' } },
            occurredAt: '2024-01-01T00:00:00Z',
            type: 'BOUGHT',
          },
          {
            id: 'event-2',
            order: { id: 'order-2', checkoutForm: { id: 'checkout-1' } },
            occurredAt: '2024-01-01T01:00:00Z',
            type: 'FILLED_IN',
          },
        ],
        lastEventId: 'event-2',
      };
      httpClient.get.mockResolvedValueOnce({ data: mockResponse, status: 200, headers: {} });

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(httpClient.get).toHaveBeenCalledWith('/order/events', {
        queryParams: { limit: 10 },
      });
      expect(result.items).toHaveLength(1);
      // The latest event for checkout-1 is event-2 (FILLED_IN) — maps to 'updated'
      // because the Allegro type does not contain BOUGHT/PAID/CANCEL.
      expect(result.items[0]).toMatchObject({
        externalOrderId: 'checkout-1',
        eventKey: 'event-2',
        eventType: 'updated',
      });
      expect(result.nextCursor).toBe('event-2');
    });

    it('should map Allegro event types to the neutral OrderFeedEventType union', async () => {
      const mockResponse: AllegroOrderEventsResponse = {
        events: [
          {
            id: 'e-bought',
            order: { id: 'o-1', checkoutForm: { id: 'c-bought' } },
            occurredAt: '2024-01-01T00:00:00Z',
            type: 'BOUGHT',
          },
          {
            id: 'e-paid',
            order: { id: 'o-2', checkoutForm: { id: 'c-paid' } },
            occurredAt: '2024-01-01T00:01:00Z',
            type: 'PAID',
          },
          {
            id: 'e-cancel',
            order: { id: 'o-3', checkoutForm: { id: 'c-cancel' } },
            occurredAt: '2024-01-01T00:02:00Z',
            type: 'BUYER_CANCELLED',
          },
          {
            id: 'e-other',
            order: { id: 'o-4', checkoutForm: { id: 'c-other' } },
            occurredAt: '2024-01-01T00:03:00Z',
            type: 'READY_FOR_PROCESSING',
          },
        ],
        lastEventId: 'e-other',
      };
      httpClient.get.mockResolvedValueOnce({ data: mockResponse, status: 200, headers: {} });

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      const byExternalOrderId = new Map(result.items.map((i) => [i.externalOrderId, i.eventType]));
      expect(byExternalOrderId.get('c-bought')).toBe('created');
      expect(byExternalOrderId.get('c-paid')).toBe('paid');
      expect(byExternalOrderId.get('c-cancel')).toBe('cancelled');
      expect(byExternalOrderId.get('c-other')).toBe('updated');
    });

    it('should keep the input cursor when the event journal returns no events', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: { events: [] },
        status: 200,
        headers: {},
      });

      const result = await adapter.listOrderFeed({ fromCursor: 'event-99', limit: 5 });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('event-99');
    });

    it('should filter items by requested eventTypes', async () => {
      const mockResponse: AllegroOrderEventsResponse = {
        events: [
          {
            id: 'e1',
            order: { id: 'o1', checkoutForm: { id: 'c1' } },
            occurredAt: '2024-01-01T00:00:00Z',
            type: 'BUYER_CANCELLED',
          },
          {
            id: 'e2',
            order: { id: 'o2', checkoutForm: { id: 'c2' } },
            occurredAt: '2024-01-01T01:00:00Z',
            type: 'FILLED_IN',
          },
        ],
      };
      httpClient.get.mockResolvedValueOnce({ data: mockResponse, status: 200, headers: {} });

      const result = await adapter.listOrderFeed({
        fromCursor: null,
        limit: 10,
        eventTypes: ['cancelled'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalOrderId).toBe('c1');
    });

    it('should pass fromCursor through as the Allegro `from` query param', async () => {
      httpClient.get.mockResolvedValueOnce({
        data: { events: [], lastEventId: 'event-42' },
        status: 200,
        headers: {},
      });

      await adapter.listOrderFeed({ fromCursor: 'event-10', limit: 20 });

      expect(httpClient.get).toHaveBeenCalledWith('/order/events', {
        queryParams: { from: 'event-10', limit: 20 },
      });
    });
  });

  describe('getOrder', () => {
    it('should hydrate a full IncomingOrder from the checkout-form endpoint', async () => {
      const checkoutForm: AllegroCheckoutForm = {
        id: 'checkout-form-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T01:00:00Z',
        buyer: {
          id: 'buyer-1',
          email: 'buyer@example.com',
          login: 'buyer1',
          firstName: 'Jan',
          lastName: 'Kowalski',
          phoneNumber: '+48123456789',
          address: {
            street: 'ul. Testowa 1',
            city: 'Warsaw',
            zipCode: '00-001',
            countryCode: 'PL',
          },
        },
        lineItems: [
          {
            id: 'line-1',
            offer: { id: 'offer-1', name: 'Offer 1' },
            quantity: 2,
            price: { amount: '19.99', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '39.98', currency: 'PLN' } },
        payment: { type: 'ONLINE', finishedAt: '2024-01-01T01:00:00Z' },
      };
      httpClient.get.mockResolvedValueOnce({ data: checkoutForm, status: 200, headers: {} });

      const incoming = await adapter.getOrder({ externalOrderId: 'checkout-form-1' });

      expect(httpClient.get).toHaveBeenCalledWith('/order/checkout-forms/checkout-form-1');
      expect(incoming.externalOrderId).toBe('checkout-form-1');
      expect(incoming.status).toBe('processing');
      expect(incoming.customerExternalId).toBe('buyer-1');
      expect(incoming.customerEmail).toBe('buyer@example.com');
      expect(incoming.items).toHaveLength(1);
      expect(incoming.items[0]).toMatchObject({
        productRef: { type: 'offer', externalId: 'offer-1' },
        quantity: 2,
        price: 19.99,
        name: 'Offer 1',
      });
      // No `delivery` block — totals split with shipping=0, subtotal == total.
      expect(incoming.totals).toEqual({
        subtotal: 39.98,
        tax: 0,
        shipping: 0,
        total: 39.98,
        currency: 'PLN',
      });
      expect(incoming.shippingAddress?.city).toBe('Warsaw');
    });

    it('should report pending status when the buyer has not yet completed payment', async () => {
      const checkoutForm: AllegroCheckoutForm = {
        id: 'checkout-2',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        buyer: { id: 'b2', email: 'b2@example.com', login: 'b2' },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'CASH_ON_DELIVERY' },
      };
      httpClient.get.mockResolvedValueOnce({ data: checkoutForm, status: 200, headers: {} });

      const incoming = await adapter.getOrder({ externalOrderId: 'checkout-2' });

      expect(incoming.status).toBe('pending');
    });

    describe('totals — shipping cost (#454)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        buyer: { id: 'b', email: 'b@e.com', login: 'b' },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '22.49', currency: 'PLN' } },
        payment: { type: 'ONLINE' },
      });

      it('should compute subtotal and shipping correctly when delivery.cost is present', async () => {
        const form = baseForm();
        form.delivery = { cost: { amount: '12.49', currency: 'PLN' } };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.totals).toEqual({
          subtotal: 10,
          tax: 0,
          shipping: 12.49,
          total: 22.49,
          currency: 'PLN',
        });
      });

      it('should fall back to total - subtotal when delivery.cost is absent', async () => {
        const form = baseForm();
        // No `delivery` block — fallback path.
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.totals.shipping).toBe(12.49);
      });

      it('should clamp shipping to 0 when subtotal exceeds total (defensive)', async () => {
        const form = baseForm();
        form.lineItems = [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 5,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ];
        form.summary = { totalToPay: { amount: '30.00', currency: 'PLN' } };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.totals.subtotal).toBe(50);
        expect(incoming.totals.shipping).toBe(0);
        expect(incoming.totals.total).toBe(30);
      });

      it('should report shipping=0 when delivery.cost is explicitly 0.00 (free delivery)', async () => {
        // Locks in the right code path: a `||` regression would pass this test
        // accidentally because subtotal == total, but the assertion that
        // `delivery.cost` was the source still belongs in the suite — future
        // edits that diverge the two paths (e.g. tax handling) will catch it.
        const form = baseForm();
        form.delivery = { cost: { amount: '0.00', currency: 'PLN' } };
        form.summary = { totalToPay: { amount: '10.00', currency: 'PLN' } };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.totals).toEqual({
          subtotal: 10,
          tax: 0,
          shipping: 0,
          total: 10,
          currency: 'PLN',
        });
      });
    });

    describe('shippingAddress — delivery.address preference (#457)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        buyer: {
          id: 'b',
          email: 'b@e.com',
          login: 'b',
          firstName: 'Buyer',
          lastName: 'Profile',
          phoneNumber: '+48000000000',
          address: {
            street: 'Profile Street 1',
            city: 'BuyerCity',
            zipCode: '00-001',
            countryCode: 'PL',
          },
        },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE' },
      });

      it('should prefer delivery.address over buyer.address for shippingAddress', async () => {
        const form = baseForm();
        form.delivery = {
          address: {
            firstName: 'Recipient',
            lastName: 'Different',
            companyName: 'Acme Sp. z o.o.',
            street: 'Delivery Street 99',
            city: 'DeliveryCity',
            zipCode: '99-999',
            countryCode: 'PL',
            phoneNumber: '+48999999999',
          },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.shippingAddress).toEqual({
          firstName: 'Recipient',
          lastName: 'Different',
          company: 'Acme Sp. z o.o.',
          address1: 'Delivery Street 99',
          city: 'DeliveryCity',
          postalCode: '99-999',
          country: 'PL',
          phone: '+48999999999',
        });
      });

      it('should fall back to buyer.address when delivery.address is undefined', async () => {
        const form = baseForm();
        // No `delivery` block at all.
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.shippingAddress).toMatchObject({
          firstName: 'Buyer',
          lastName: 'Profile',
          address1: 'Profile Street 1',
          city: 'BuyerCity',
          postalCode: '00-001',
          country: 'PL',
          phone: '+48000000000',
        });
      });

      it('should fall back to buyer.address when delivery.address is an empty object', async () => {
        // Pickup-point order: parcel goes to delivery.pickupPoint (#458 scope),
        // delivery.address is empty {}. Without the empty-guard, we'd emit
        // empty strings — worse than today's buyer.address fallback.
        const form = baseForm();
        form.delivery = { address: {} };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.shippingAddress?.city).toBe('BuyerCity');
        expect(incoming.shippingAddress?.address1).toBe('Profile Street 1');
      });

      it('should fall back to buyer.address when delivery.address has only name fields (no geography)', async () => {
        // Defensive: a delivery.address with firstName/lastName but no
        // street/city/zipCode is geographically meaningless — the empty-guard
        // pushes it to the buyer.address fallback rather than emitting empty
        // strings. This case is exotic but cheap to lock in.
        const form = baseForm();
        form.delivery = {
          address: {
            firstName: 'Recipient',
            lastName: 'NoGeography',
          },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.shippingAddress?.firstName).toBe('Buyer'); // from buyer.address
        expect(incoming.shippingAddress?.address1).toBe('Profile Street 1');
      });
    });

    describe('shipping (#455)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        buyer: {
          id: 'b',
          email: 'b@e.com',
          login: 'b',
        },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE' },
      });

      it('should populate shipping.methodId and methodName from delivery.method', async () => {
        const form = baseForm();
        form.delivery = {
          method: { id: '1fa56f79-aaa', name: 'InPost Paczkomat' },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.shipping).toEqual({
          methodId: '1fa56f79-aaa',
          methodName: 'InPost Paczkomat',
        });
      });

      it('should leave shipping undefined when delivery.method.id is absent', async () => {
        const form = baseForm();
        form.delivery = { cost: { amount: '12.49', currency: 'PLN' } };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.shipping).toBeUndefined();
      });
    });

    describe('pickupPoint (#458)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        buyer: {
          id: 'b',
          email: 'b@e.com',
          login: 'b',
          firstName: 'Buyer',
          lastName: 'Profile',
          phoneNumber: '+48000000000',
          address: {
            street: 'Profile Street 1',
            city: 'BuyerCity',
            zipCode: '00-001',
            countryCode: 'PL',
          },
        },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE' },
      });

      it('should populate pickupPoint and synthesize shippingAddress from pickupPoint.address', async () => {
        const form = baseForm();
        // Allegro returns delivery.address as `{}` for pickup-point orders.
        form.delivery = {
          address: {},
          pickupPoint: {
            id: 'POZ08A',
            name: 'Paczkomat POZ08A',
            description: 'Stacja paliw BP',
            address: {
              street: 'ul. Lockerowa 1',
              city: 'Poznań',
              zipCode: '60-001',
              countryCode: 'PL',
            },
          },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.pickupPoint).toEqual({
          id: 'POZ08A',
          name: 'Paczkomat POZ08A',
          description: 'Stacja paliw BP',
        });
        // shippingAddress geography comes from the locker; recipient name+phone
        // remain the buyer's (the parcel is collected by the buyer).
        expect(incoming.shippingAddress).toEqual({
          firstName: 'Buyer',
          lastName: 'Profile',
          address1: 'ul. Lockerowa 1',
          city: 'Poznań',
          postalCode: '60-001',
          country: 'PL',
          phone: '+48000000000',
        });
      });

      it('should leave pickupPoint undefined when delivery.pickupPoint is absent', async () => {
        const form = baseForm();
        form.delivery = { cost: { amount: '12.49', currency: 'PLN' } };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.pickupPoint).toBeUndefined();
      });

      it('should fall back to buyer.address when pickupPoint.address has no geography', async () => {
        const form = baseForm();
        form.delivery = {
          address: {},
          pickupPoint: {
            id: 'POZ08A',
            name: 'Paczkomat POZ08A',
            // No geography on the locker — defensive fallback.
          },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.pickupPoint).toEqual({
          id: 'POZ08A',
          name: 'Paczkomat POZ08A',
          description: undefined,
        });
        // Falls back to buyer.address since neither delivery.address nor
        // pickupPoint.address has geography.
        expect(incoming.shippingAddress?.address1).toBe('Profile Street 1');
        expect(incoming.shippingAddress?.city).toBe('BuyerCity');
      });
    });
  });

  describe('SourceOptionsReader (#472 / #474)', () => {
    describe('listOrderStatuses', () => {
      it('returns the documented Allegro order-status enum', async () => {
        const result = await adapter.listOrderStatuses();
        expect(result).toEqual(
          expect.arrayContaining([
            { value: 'BOUGHT', label: 'Bought (awaiting payment)' },
            { value: 'READY_FOR_PROCESSING', label: 'Ready for processing (paid)' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]),
        );
        expect(result).toHaveLength(4);
      });

      it('does not call the Allegro HTTP client', async () => {
        await adapter.listOrderStatuses();
        expect(httpClient.get).not.toHaveBeenCalled();
      });
    });

    describe('listPaymentMethods', () => {
      it('returns the documented Allegro payment-type enum', async () => {
        const result = await adapter.listPaymentMethods();
        expect(result).toEqual(
          expect.arrayContaining([
            { value: 'ONLINE', label: 'Online payment (Allegro Pay / card / instant transfer)' },
            { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery' },
            { value: 'BANK_TRANSFER', label: 'Bank transfer' },
          ]),
        );
        expect(result.length).toBeGreaterThanOrEqual(6);
      });

      it('does not call the Allegro HTTP client', async () => {
        await adapter.listPaymentMethods();
        expect(httpClient.get).not.toHaveBeenCalled();
      });
    });

    describe('listDeliveryMethods', () => {
      const PACZKOMAT_ID = '1fa56f79-aaa1-aaaa-aaaa-aaaaaaaaaaaa';
      const KURIER_ID = '2bc67g80-bbb2-bbbb-bbbb-bbbbbbbbbbbb';
      const DPD_ID = '3cd78h91-ccc3-cccc-cccc-cccccccccccc';

      it('flattens carrier methods across rate-tables, deduped by methodId', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: {
            shippingRates: [
              { id: 'rate-set-1', name: 'Cennik główny' },
              { id: 'rate-set-2', name: 'Cennik premium' },
            ],
          },
          status: 200,
          headers: {},
        });
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik główny',
            rates: [
              { method: { id: PACZKOMAT_ID, name: 'Allegro Paczkomaty InPost' } },
              { method: { id: KURIER_ID, name: 'Allegro Kurier24 InPost' } },
            ],
          },
          status: 200,
          headers: {},
        });
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-2',
            name: 'Cennik premium',
            rates: [
              { method: { id: PACZKOMAT_ID, name: 'Allegro Paczkomaty InPost' } }, // dup
              { method: { id: DPD_ID, name: 'DPD' } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();

        expect(httpClient.get).toHaveBeenNthCalledWith(1, '/sale/shipping-rates');
        expect(httpClient.get).toHaveBeenNthCalledWith(2, '/sale/shipping-rates/rate-set-1');
        expect(httpClient.get).toHaveBeenNthCalledWith(3, '/sale/shipping-rates/rate-set-2');
        expect(result).toEqual([
          { value: PACZKOMAT_ID, label: 'Allegro Paczkomaty InPost' },
          { value: KURIER_ID, label: 'Allegro Kurier24 InPost' },
          { value: DPD_ID, label: 'DPD' },
        ]);
      });

      it('returns empty list when seller has no rate-tables', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [] },
          status: 200,
          headers: {},
        });
        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([]);
        expect(httpClient.get).toHaveBeenCalledTimes(1);
      });

      it('falls back to method.id as label when name is missing', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik główny' }] },
          status: 200,
          headers: {},
        });
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik główny',
            rates: [{ method: { id: PACZKOMAT_ID } }],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([{ value: PACZKOMAT_ID, label: PACZKOMAT_ID }]);
      });

      it('skips rate entries without method.id', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik główny' }] },
          status: 200,
          headers: {},
        });
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik główny',
            rates: [
              { method: { id: PACZKOMAT_ID, name: 'Paczkomat' } },
              {}, // malformed entry
              { method: { name: 'No id' } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([{ value: PACZKOMAT_ID, label: 'Paczkomat' }]);
      });
    });
  });
});
