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
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { Connection } from '@openlinker/core/identifier-mapping';
import type {
  AllegroCheckoutForm,
  AllegroOrderEventsResponse,
} from '../../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';

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
      ['OrderSource', 'OfferManager']
    );

    adapter = new AllegroOrderSourceAdapter(connectionId, httpClient, connection);
  });

  describe('write — OrderStatusWriteback (#1159 / #1168)', () => {
    it('dispatched: marks sent + attaches the waybill and returns applied', async () => {
      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: 'cf-1',
        trackingNumber: '680',
        carrier: { platformType: 'inpost' },
      });
      expect(httpClient.put).toHaveBeenCalledWith('/order/checkout-forms/cf-1/fulfillment', {
        status: 'SENT',
      });
      expect(httpClient.post).toHaveBeenCalledWith('/order/checkout-forms/cf-1/shipments', {
        carrierId: 'INPOST',
        waybill: '680',
      });
      expect(result).toEqual({ outcome: 'applied' });
    });

    it('dispatched: marks sent only (no waybill) for the source-brokered branch', async () => {
      const result = await adapter.write({ type: 'dispatched', externalOrderId: 'cf-1' });
      expect(httpClient.put).toHaveBeenCalledWith('/order/checkout-forms/cf-1/fulfillment', {
        status: 'SENT',
      });
      expect(httpClient.post).not.toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'applied' });
    });

    it('dispatched: falls back to OTHER + carrierName for an unmapped carrier', async () => {
      await adapter.write({
        type: 'dispatched',
        externalOrderId: 'cf-1',
        trackingNumber: '680',
        carrier: { platformType: 'wackycarrier' },
      });
      expect(httpClient.post).toHaveBeenCalledWith('/order/checkout-forms/cf-1/shipments', {
        carrierId: 'OTHER',
        waybill: '680',
        carrierName: 'wackycarrier',
      });
    });

    it('dispatched: treats a 409 on fulfillment as already-sent (applied) and still attaches the waybill', async () => {
      httpClient.put.mockRejectedValueOnce(new AllegroApiException('conflict', 409));
      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: 'cf-1',
        trackingNumber: '680',
        carrier: { platformType: 'inpost' },
      });
      expect(httpClient.post).toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'applied' });
    });

    it('dispatched: returns rejected (never throws) when the waybill POST fails', async () => {
      httpClient.post.mockRejectedValueOnce(new AllegroApiException('bad carrier', 400));
      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: 'cf-1',
        trackingNumber: '680',
        carrier: { platformType: 'inpost' },
      });
      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('bad carrier');
    });

    it('cancelled: sets the Allegro fulfillment status to CANCELLED and returns applied', async () => {
      const result = await adapter.write({ type: 'cancelled', externalOrderId: 'cf-1' });
      expect(httpClient.put).toHaveBeenCalledWith('/order/checkout-forms/cf-1/fulfillment', {
        status: 'CANCELLED',
      });
      expect(result).toEqual({ outcome: 'applied' });
    });

    it('cancelled: returns rejected on a 4xx (e.g. forbidden transition)', async () => {
      httpClient.put.mockRejectedValueOnce(new AllegroApiException('not allowed', 422));
      const result = await adapter.write({ type: 'cancelled', externalOrderId: 'cf-1' });
      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('not allowed');
    });

    it('cancelled: a 409 is rejected, NOT swallowed as applied (cancel ≠ mark-sent idempotency)', async () => {
      httpClient.put.mockRejectedValueOnce(new AllegroApiException('conflict: already sent', 409));
      const result = await adapter.write({ type: 'cancelled', externalOrderId: 'cf-1' });
      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('conflict');
    });
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
        taxTreatment: 'inclusive',
      });
      expect(incoming.shippingAddress?.city).toBe('Warsaw');
      // #928 — prepaid ONLINE order with finishedAt → paid (dispatch permitted).
      expect(incoming.paymentStatus).toBe('paid');
      // #1435 — a prepaid (non-COD) order carries no sourced COD amount.
      expect(incoming.codToCollect).toBeUndefined();
    });

    it('should report pending status when the buyer has not yet completed payment', async () => {
      const checkoutForm: AllegroCheckoutForm = {
        id: 'checkout-2',
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
      // #928 — CASH_ON_DELIVERY → cod regardless of order-lifecycle status
      // (dispatch is permitted for COD; the order ships and is paid on receipt).
      expect(incoming.paymentStatus).toBe('cod');
      // #1435 — a COD order carries the sourced collect amount (the full
      // order total the buyer pays on delivery) from summary.totalToPay.
      expect(incoming.codToCollect).toEqual({ amount: '10.00', currency: 'PLN' });
    });

    it('should report cancelled status when the checkout-form transaction was voided on Allegro (#1322 manual E2E)', async () => {
      // Even though payment.finishedAt is set (the order WAS paid before the
      // buyer/seller cancelled it), status must be 'cancelled', not
      // 'processing' — this is exactly the live bug: a cancelled-but-paid
      // order silently kept reporting 'processing' forever.
      const checkoutForm: AllegroCheckoutForm = {
        id: 'checkout-3',
        status: 'CANCELLED',
        updatedAt: '2024-01-03T00:00:00Z',
        buyer: { id: 'b3', email: 'b3@example.com', login: 'b3' },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE', finishedAt: '2024-01-03T00:00:00Z' },
      };
      httpClient.get.mockResolvedValueOnce({ data: checkoutForm, status: 200, headers: {} });

      const incoming = await adapter.getOrder({ externalOrderId: 'checkout-3' });

      expect(incoming.status).toBe('cancelled');
    });

    it('should report cancelled status when the seller cancelled via the panel dropdown (fulfillment.status, #1322 manual E2E)', async () => {
      // The real live bug the manual test hit: the seller used the "Status
      // zamówienia" dropdown's ANULOWANE option, which sets
      // fulfillment.status — NOT the transaction-level `status` field.
      const checkoutForm: AllegroCheckoutForm = {
        id: 'checkout-4',
        fulfillment: { status: 'CANCELLED' },
        updatedAt: '2024-01-04T00:00:00Z',
        buyer: { id: 'b4', email: 'b4@example.com', login: 'b4' },
        lineItems: [
          {
            id: 'l1',
            offer: { id: 'o1', name: 'O1' },
            quantity: 1,
            price: { amount: '10.00', currency: 'PLN' },
          },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE', finishedAt: '2024-01-04T00:00:00Z' },
      };
      httpClient.get.mockResolvedValueOnce({ data: checkoutForm, status: 200, headers: {} });

      const incoming = await adapter.getOrder({ externalOrderId: 'checkout-4' });

      expect(incoming.status).toBe('cancelled');
    });

    describe('dispatch time / ship-by (#927)', () => {
      const formWithDelivery = (
        delivery: NonNullable<AllegroCheckoutForm['delivery']>
      ): AllegroCheckoutForm => ({
        id: 'cf',
        updatedAt: '2024-01-01T00:00:00Z',
        buyer: { id: 'b', email: 'b@e.com', login: 'b' },
        lineItems: [
          { id: 'l1', offer: { id: 'o1', name: 'O1' }, quantity: 1, price: { amount: '10.00', currency: 'PLN' } },
        ],
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE', finishedAt: '2024-01-01T01:00:00Z' },
        delivery,
      });

      it('maps delivery.time.dispatch to the neutral dispatchTime window', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithDelivery({
            time: {
              from: '2024-01-03T10:00:00Z',
              to: '2024-01-03T12:00:00Z',
              dispatch: { from: '2024-01-02T08:00:00Z', to: '2024-01-02T16:00:00Z' },
            },
          }),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.dispatchTime).toEqual({
          from: '2024-01-02T08:00:00Z',
          to: '2024-01-02T16:00:00Z',
        });
      });

      it('ignores the deprecated guaranteed window and leaves dispatchTime undefined when no dispatch', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithDelivery({
            time: { guaranteed: { from: '2024-01-03T10:00:00Z', to: '2024-01-03T12:00:00Z' } },
          }),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.dispatchTime).toBeUndefined();
      });

      it('leaves dispatchTime undefined when the delivery block has no time', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithDelivery({ method: { id: 'm1', name: 'Courier' } }),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.dispatchTime).toBeUndefined();
      });
    });

    describe('totals — shipping cost (#454)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
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
          taxTreatment: 'inclusive',
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
          taxTreatment: 'inclusive',
        });
      });
    });

    describe('placedAt — buyer-placed time from lineItems[].boughtAt (#926)', () => {
      const formWithBoughtAt = (boughtAts: Array<string | undefined>): AllegroCheckoutForm => ({
        id: 'cf',
        updatedAt: '2024-01-01T00:00:00Z',
        buyer: { id: 'b', email: 'b@e.com', login: 'b' },
        lineItems: boughtAts.map((boughtAt, i) => ({
          id: `l${i}`,
          offer: { id: `o${i}`, name: `O${i}` },
          quantity: 1,
          price: { amount: '10.00', currency: 'PLN' },
          ...(boughtAt !== undefined && { boughtAt }),
        })),
        summary: { totalToPay: { amount: '10.00', currency: 'PLN' } },
        payment: { type: 'ONLINE' },
      });

      it('should surface a single boughtAt as placedAt', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithBoughtAt(['2026-05-31T16:00:00.000Z']),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.placedAt).toBe('2026-05-31T16:00:00.000Z');
      });

      it('should pick the earliest boughtAt across line items', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithBoughtAt([
            '2026-05-31T18:00:00.000Z',
            '2026-05-31T16:00:00.000Z',
            '2026-05-31T17:00:00.000Z',
          ]),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.placedAt).toBe('2026-05-31T16:00:00.000Z');
      });

      it('should leave placedAt undefined when no line item carries boughtAt', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithBoughtAt([undefined, undefined]),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.placedAt).toBeUndefined();
      });

      it('should skip an unparseable boughtAt and use the earliest valid one', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithBoughtAt(['not-a-date', '2026-05-31T16:00:00.000Z']),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.placedAt).toBe('2026-05-31T16:00:00.000Z');
      });

      it('should leave placedAt undefined when every boughtAt is unparseable (no ingestion throw)', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: formWithBoughtAt(['not-a-date', 'also-bad']),
          status: 200,
          headers: {},
        });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.placedAt).toBeUndefined();
      });
    });

    describe('shippingAddress — delivery.address preference (#457)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
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
          // No POP signal in id/name — Allegro exposes no apm discriminator,
          // so the classifier stays truthfully undefined (#1433).
          pointType: undefined,
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
          pointType: undefined,
        });
        // Falls back to buyer.address since neither delivery.address nor
        // pickupPoint.address has geography.
        expect(incoming.shippingAddress?.address1).toBe('Profile Street 1');
        expect(incoming.shippingAddress?.city).toBe('BuyerCity');
      });

      it('should infer pointType pop for a POP- prefixed pickup-point id (#1433)', async () => {
        const form = baseForm();
        form.delivery = {
          address: {},
          pickupPoint: { id: 'POP-OLS19', name: 'PaczkoPunkt POP-OLS19' },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.pickupPoint?.pointType).toBe('pop');
      });

      it('should infer pointType pop from a PaczkoPunkt name without a POP- id (#1433)', async () => {
        const form = baseForm();
        form.delivery = {
          address: {},
          pickupPoint: { id: 'OLS19X', name: 'InPost PaczkoPunkt at OLS19X' },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.pickupPoint?.pointType).toBe('pop');
      });

      it('should leave pointType undefined for a plain locker id with no POP signal (#1433)', async () => {
        const form = baseForm();
        form.delivery = {
          address: {},
          pickupPoint: { id: 'OLS06A', name: 'InPost Paczkomat OLS06A' },
        };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.pickupPoint?.pointType).toBeUndefined();
      });
    });

    describe('deliverySmart (#738)', () => {
      const baseForm = (): AllegroCheckoutForm => ({
        id: 'cf',
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

      it('should populate deliverySmart=true when delivery.smart is true', async () => {
        const form = baseForm();
        form.delivery = { smart: true };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.deliverySmart).toBe(true);
      });

      it('should populate deliverySmart=false when delivery.smart is false', async () => {
        const form = baseForm();
        form.delivery = { smart: false };
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.deliverySmart).toBe(false);
      });

      it('should leave deliverySmart undefined when delivery block is absent', async () => {
        const form = baseForm();
        // No `delivery` block at all — covers `delivery === undefined`.
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.deliverySmart).toBeUndefined();
      });

      it('should leave deliverySmart undefined when delivery block is present but smart key is missing', async () => {
        const form = baseForm();
        // `delivery` present but no `smart` — guards the `?.smart` optional
        // chain's "present-but-missing-key" branch explicitly.
        form.delivery = {};
        httpClient.get.mockResolvedValueOnce({ data: form, status: 200, headers: {} });

        const incoming = await adapter.getOrder({ externalOrderId: 'cf' });

        expect(incoming.deliverySmart).toBeUndefined();
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
          ])
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
          ])
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

      // Helper: queue the canonical method-catalogue mocks. The adapter
      // queries `/sale/delivery-methods` once per seller-marketplace
      // (allegro-pl, allegro-cz, allegro-sk, allegro-hu) in parallel, so we
      // queue four responses. The default behavior — same content for every
      // marketplace — is fine for tests that don't care about cross-marketplace
      // overlap; tests that DO care pass `perMarketplace` to vary by index.
      // Dispatched in Promise.all order with `/sale/shipping-rates`.
      function mockDeliveryMethodsCatalogue(
        entries: Array<{ id: string; name: string }>,
        perMarketplace?: {
          [K in 'allegro-pl' | 'allegro-cz' | 'allegro-sk' | 'allegro-hu']?: Array<{
            id: string;
            name: string;
          }>;
        }
      ): void {
        const marketplaces = ['allegro-pl', 'allegro-cz', 'allegro-sk', 'allegro-hu'] as const;
        for (const marketplace of marketplaces) {
          const methods = perMarketplace?.[marketplace] ?? entries;
          httpClient.get.mockResolvedValueOnce({
            data: {
              deliveryMethods: methods.map((e) => ({
                id: e.id,
                name: e.name,
                marketplaces: [marketplace],
                dispatchCountry: 'PL',
                destinationCountry:
                  marketplace === 'allegro-pl' ? 'PL' : marketplace.split('-')[1].toUpperCase(),
              })),
            },
            status: 200,
            headers: {},
          });
        }
      }

      it('flattens carrier methods across rate-tables, deduped by methodId, with names resolved from the catalogue', async () => {
        // Step 1 fires `/sale/shipping-rates` and `/sale/delivery-methods` in
        // parallel; jest's mockResolvedValueOnce queue dequeues in call order.
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
        mockDeliveryMethodsCatalogue([
          { id: PACZKOMAT_ID, name: 'Allegro Paczkomaty InPost' },
          { id: KURIER_ID, name: 'Allegro Kurier24 InPost' },
          { id: DPD_ID, name: 'DPD' },
        ]);
        // Rate-table response carries only `id` on each rate's deliveryMethod
        // — names live on the catalogue. Mirrors the live API shape (#496).
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik główny',
            rates: [
              { deliveryMethod: { id: PACZKOMAT_ID } },
              { deliveryMethod: { id: KURIER_ID } },
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
              { deliveryMethod: { id: PACZKOMAT_ID } }, // dup
              { deliveryMethod: { id: DPD_ID } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();

        expect(httpClient.get).toHaveBeenNthCalledWith(1, '/sale/shipping-rates');
        // Catalogue is fanned out across PL + CZ + SK + HU because PL-seller
        // cenniki carry method ids belonging to destination marketplaces too
        // (the buyer-side "do Czech / do Słowacji / do Węgier" variants live
        // under their own marketplace catalogue, not allegro-pl).
        expect(httpClient.get).toHaveBeenNthCalledWith(2, '/sale/delivery-methods', {
          queryParams: { marketplace: 'allegro-pl' },
        });
        expect(httpClient.get).toHaveBeenNthCalledWith(3, '/sale/delivery-methods', {
          queryParams: { marketplace: 'allegro-cz' },
        });
        expect(httpClient.get).toHaveBeenNthCalledWith(4, '/sale/delivery-methods', {
          queryParams: { marketplace: 'allegro-sk' },
        });
        expect(httpClient.get).toHaveBeenNthCalledWith(5, '/sale/delivery-methods', {
          queryParams: { marketplace: 'allegro-hu' },
        });
        expect(httpClient.get).toHaveBeenNthCalledWith(6, '/sale/shipping-rates/rate-set-1');
        expect(httpClient.get).toHaveBeenNthCalledWith(7, '/sale/shipping-rates/rate-set-2');
        expect(result).toEqual([
          { value: PACZKOMAT_ID, label: 'Allegro Paczkomaty InPost' },
          { value: KURIER_ID, label: 'Allegro Kurier24 InPost' },
          { value: DPD_ID, label: 'DPD' },
        ]);
      });

      it('falls back to the id as label when a method is absent from the catalogue (#496 defensive)', async () => {
        const ORPHAN_ID = '99999999-aaaa-bbbb-cccc-dddddddddddd';
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik' }] },
          status: 200,
          headers: {},
        });
        // Catalogue only knows about PACZKOMAT — the rate-table also references
        // ORPHAN_ID, which should fall through to id-as-label.
        mockDeliveryMethodsCatalogue([{ id: PACZKOMAT_ID, name: 'Allegro Paczkomaty InPost' }]);
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik',
            rates: [
              { deliveryMethod: { id: PACZKOMAT_ID } },
              { deliveryMethod: { id: ORPHAN_ID } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([
          { value: PACZKOMAT_ID, label: 'Allegro Paczkomaty InPost' },
          { value: ORPHAN_ID, label: ORPHAN_ID },
        ]);
      });

      it('prefers the catalogue name over a name carried on the rate itself', async () => {
        // Edge case: if Allegro ever does inline a name on the rate (legacy
        // shape, or a future-shape change), the canonical catalogue still
        // wins — single source of truth.
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik' }] },
          status: 200,
          headers: {},
        });
        mockDeliveryMethodsCatalogue([{ id: PACZKOMAT_ID, name: 'Allegro Paczkomaty InPost' }]);
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik',
            rates: [{ deliveryMethod: { id: PACZKOMAT_ID, name: 'Stale name from rate' } }],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([{ value: PACZKOMAT_ID, label: 'Allegro Paczkomaty InPost' }]);
      });

      it('unions catalogues across PL/CZ/SK/HU marketplaces so cross-border ids resolve', async () => {
        // PL-seller cennik referencing one PL-side method (Paczkomat) and
        // one CZ-side method (the buyer-facing Czech variant) — if we only
        // queried allegro-pl the CZ id would fall back to a UUID label.
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik' }] },
          status: 200,
          headers: {},
        });
        mockDeliveryMethodsCatalogue(
          [], // unused fallback
          {
            'allegro-pl': [{ id: PACZKOMAT_ID, name: 'Allegro Paczkomaty InPost' }],
            'allegro-cz': [{ id: KURIER_ID, name: 'Allegro International Kurier Czechy, InPost' }],
            'allegro-sk': [],
            'allegro-hu': [],
          }
        );
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik',
            rates: [
              { deliveryMethod: { id: PACZKOMAT_ID } },
              { deliveryMethod: { id: KURIER_ID } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([
          { value: PACZKOMAT_ID, label: 'Allegro Paczkomaty InPost' },
          { value: KURIER_ID, label: 'Allegro International Kurier Czechy, InPost' },
        ]);
      });

      it('returns empty list when seller has no rate-tables', async () => {
        // Step 1 still fires the shipping-rates call AND the four
        // catalogue calls (PL + CZ + SK + HU) in parallel; the catalogue
        // loads are wasted work in this branch but the early-return on
        // empty rate-set ids prevents any per-id detail fetches.
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [] },
          status: 200,
          headers: {},
        });
        mockDeliveryMethodsCatalogue([]);

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([]);
        expect(httpClient.get).toHaveBeenCalledTimes(5);
      });

      it('falls back to deliveryMethod.id as label when name is missing from both catalogue and rate', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik główny' }] },
          status: 200,
          headers: {},
        });
        // Catalogue empty — forces the chain to fall through to the
        // rate-inline name (also missing here), then to the id.
        mockDeliveryMethodsCatalogue([]);
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik główny',
            rates: [{ deliveryMethod: { id: PACZKOMAT_ID } }],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([{ value: PACZKOMAT_ID, label: PACZKOMAT_ID }]);
      });

      it('skips rate entries without deliveryMethod.id', async () => {
        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik główny' }] },
          status: 200,
          headers: {},
        });
        // Catalogue empty here so the rate-inline 'Paczkomat' name is the one
        // that lands as the label — covers the legacy fallback path.
        mockDeliveryMethodsCatalogue([]);
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik główny',
            rates: [
              { deliveryMethod: { id: PACZKOMAT_ID, name: 'Paczkomat' } },
              {}, // malformed entry
              { deliveryMethod: { name: 'No id' } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();
        expect(result).toEqual([{ value: PACZKOMAT_ID, label: 'Paczkomat' }]);
      });

      // Defensive coverage for the #494 failure mode: rate-tables exist and
      // contain rates, but the parser recognises zero of them. Asserts the
      // operator-visible warn fires so the next API-shape regression is loud,
      // not silent.
      it('warns when rate-tables have rates but parser yields zero methods', async () => {
        const warnSpy = jest
          .spyOn((adapter as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
          .mockImplementation(() => {});

        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik' }] },
          status: 200,
          headers: {},
        });
        mockDeliveryMethodsCatalogue([]);
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik',
            // Two rates, neither has a recognised `deliveryMethod.id` — mirrors
            // the live shape we'd see if Allegro renamed the field again.
            rates: [{}, { deliveryMethod: { name: 'No id' } }],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();

        expect(result).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/produced 0 delivery methods.*possible API shape regression/i)
        );

        warnSpy.mockRestore();
      });

      // Diagnostic for the bug surfaced live on #496/PR #497: if the
      // catalogue is empty (or scoped to the wrong marketplace), every
      // method id misses the lookup and the dropdown shows UUIDs. Asserts
      // the operator-visible warn fires so the cause is loud, not silent.
      it('warns when method ids cannot be resolved from the catalogue', async () => {
        const warnSpy = jest
          .spyOn((adapter as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
          .mockImplementation(() => {});

        httpClient.get.mockResolvedValueOnce({
          data: { shippingRates: [{ id: 'rate-set-1', name: 'Cennik' }] },
          status: 200,
          headers: {},
        });
        // Catalogue empty — simulates a scope mismatch (wrong marketplace,
        // pagination cut, namespace drift, etc).
        mockDeliveryMethodsCatalogue([]);
        httpClient.get.mockResolvedValueOnce({
          data: {
            id: 'rate-set-1',
            name: 'Cennik',
            rates: [
              { deliveryMethod: { id: PACZKOMAT_ID } },
              { deliveryMethod: { id: KURIER_ID } },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await adapter.listDeliveryMethods();

        // Result is non-empty (parser worked), but every label is the id
        // — the unresolved diagnostic must fire.
        expect(result).toEqual([
          { value: PACZKOMAT_ID, label: PACZKOMAT_ID },
          { value: KURIER_ID, label: KURIER_ID },
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/2\/2 method ids could not be resolved.*falling back to UUIDs/i)
        );

        warnSpy.mockRestore();
      });
    });
  });
});
