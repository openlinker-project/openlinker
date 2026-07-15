/**
 * PrestaShop Order Source Adapter Tests
 *
 * Unit tests for PrestashopOrderSourceAdapter post-#328 port reshape.
 * Covers cursor-based `listOrderFeed` and `getOrder({externalOrderId})`
 * against the neutral OrderSourcePort surface.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopOrderSourceAdapter } from '../prestashop-order-source.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopOrderMapper } from '../../mappers/prestashop-order.mapper';
import {
  PrestashopApiException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import type {
  PrestashopOrder,
  PrestashopOrderRow,
} from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopOrderSourceAdapter', () => {
  let adapter: PrestashopOrderSourceAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let connection: ReturnType<typeof createTestConnection>;
  let orderMapper: PrestashopOrderMapper;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    connection = createTestConnection();
    orderMapper = new PrestashopOrderMapper();
    adapter = new PrestashopOrderSourceAdapter(mockHttpClient, orderMapper, connection);
  });

  describe('listOrderFeed', () => {
    it('should return feed items with a monotonic cursor advance', async () => {
      const orders: PrestashopOrder[] = [
        {
          id: '1',
          reference: 'ORDER-1',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
        {
          id: '2',
          reference: 'ORDER-2',
          date_add: '2024-01-02 09:00:00',
          date_upd: '2024-01-02 11:00:00',
        },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        externalOrderId: '1',
        eventType: 'created',
        occurredAt: '2024-01-01 10:00:00',
      });
      expect(result.items[1]).toMatchObject({
        externalOrderId: '2',
        eventType: 'updated',
        occurredAt: '2024-01-02 11:00:00',
      });
      expect(result.nextCursor).toBe('2024-01-02 11:00:00');
    });

    it('should return input cursor unchanged when the feed is empty', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);
      const result = await adapter.listOrderFeed({ fromCursor: '2024-01-01 00:00:00', limit: 10 });
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('2024-01-01 00:00:00');
    });

    it('should filter items by requested eventTypes', async () => {
      const orders: PrestashopOrder[] = [
        { id: '1', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-01 10:00:00' },
        { id: '2', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-02 12:00:00' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      const result = await adapter.listOrderFeed({
        fromCursor: null,
        limit: 10,
        eventTypes: ['updated'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalOrderId).toBe('2');
    });

    it('should advance cursor past filtered-out items so a page of non-matching events is not re-fetched', async () => {
      const orders: PrestashopOrder[] = [
        { id: '1', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-01 10:00:00' },
        { id: '2', date_add: '2024-01-02 09:00:00', date_upd: '2024-01-02 12:00:00' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      // Filter excludes every order on the page, but the cursor must still
      // advance to the max observed `date_upd` so the next call does not loop.
      const result = await adapter.listOrderFeed({
        fromCursor: '2024-01-01 00:00:00',
        limit: 10,
        eventTypes: ['cancelled'],
      });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('2024-01-02 12:00:00');
    });

    describe('cancellation detection (#1161)', () => {
      it('should emit a cancelled event for an order in the canceled state (state 6)', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '7',
            current_state: '6',
            date_add: '2024-03-01 09:00:00',
            date_upd: '2024-03-02 14:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0]).toMatchObject({
          externalOrderId: '7',
          eventType: 'cancelled',
          occurredAt: '2024-03-02 14:00:00',
        });
        // eventKey carries the event type so a cancel is dedupe-distinct from a
        // prior created/updated at a different date_upd.
        expect(result.items[0].eventKey).toBe('7:2024-03-02 14:00:00:cancelled');
      });

      it('should take cancellation precedence even when date_add === date_upd', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '8',
            current_state: '6',
            date_add: '2024-03-03 10:00:00',
            date_upd: '2024-03-03 10:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0].eventType).toBe('cancelled');
      });

      it('should keep emitting cancelled for a re-touched order that stays canceled (no flip to updated)', async () => {
        // Regression guard: a still-cancelled order whose date_upd bumped again
        // must NOT read as `updated` (which would re-create it as active).
        const orders: PrestashopOrder[] = [
          {
            id: '9',
            current_state: '6',
            date_add: '2024-03-04 10:00:00',
            date_upd: '2024-03-05 11:30:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: '2024-03-05 00:00:00',
          limit: 10,
        });

        expect(result.items[0].eventType).toBe('cancelled');
      });

      it('should not treat a non-canceled updated order as cancelled', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '10',
            current_state: '2',
            date_add: '2024-03-06 09:00:00',
            date_upd: '2024-03-07 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0].eventType).toBe('updated');
      });

      it('should classify an order with no current_state as created/updated (undefined guard)', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '13',
            date_add: '2024-03-12 09:00:00',
            date_upd: '2024-03-13 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0].eventType).toBe('updated');
      });

      it('should retain a cancelled order when eventTypes filters for ["cancelled"]', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '11',
            current_state: '6',
            date_add: '2024-03-08 09:00:00',
            date_upd: '2024-03-09 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: null,
          limit: 10,
          eventTypes: ['cancelled'],
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].externalOrderId).toBe('11');
      });

      it('should filter out a cancelled order when eventTypes is ["created","updated"]', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '12',
            current_state: '6',
            date_add: '2024-03-10 09:00:00',
            date_upd: '2024-03-11 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: null,
          limit: 10,
          eventTypes: ['created', 'updated'],
        });

        expect(result.items).toHaveLength(0);
        // Cursor still advances past the filtered-out cancelled order.
        expect(result.nextCursor).toBe('2024-03-11 09:00:00');
      });
    });
  });

  describe('getOrder', () => {
    it('should hydrate a full IncomingOrder by external order id', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_incl: '99.99',
        total_paid_tax_excl: '99.99',
        total_shipping: '0',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const orderRows: PrestashopOrderRow[] = [
        {
          id: '100',
          product_id: '5',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '99.99',
          product_reference: 'SKU-5',
        },
      ];

      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.externalOrderId).toBe('42');
      expect(incoming.customerExternalId).toBe('7');
      expect(incoming.createdAt).toBe('2024-01-01 10:00:00');
      expect(incoming.updatedAt).toBe('2024-01-01 12:00:00');
      // Buyer-placed time (#926) is PrestaShop `date_add`.
      expect(incoming.placedAt).toBe('2024-01-01 10:00:00');
      expect(incoming.items).toHaveLength(1);
      expect(incoming.items[0].productRef).toEqual({ type: 'product', externalId: '5' });
    });

    it('should derive a genuine per-line taxRate from tax-incl/excl unit prices (#1586)', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '43',
        reference: 'ORDER-043',
        id_customer: '7',
        current_state: '2',
        total_paid: '231.00',
        total_paid_tax_incl: '231.00',
        total_paid_tax_excl: '200.00',
        total_shipping: '0',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const orderRows: PrestashopOrderRow[] = [
        {
          id: '100',
          product_id: '5',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '100.00',
          product_reference: 'SKU-5',
          unit_price_tax_incl: '123.00',
          unit_price_tax_excl: '100.00',
        },
        {
          id: '101',
          product_id: '6',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '100.00',
          product_reference: 'SKU-6',
          unit_price_tax_incl: '108.00',
          unit_price_tax_excl: '100.00',
        },
      ];

      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '43' });

      // Mixed-rate order: 23% and 8% derived per line from incl/excl.
      expect(incoming.items[0].taxRate).toBe('23');
      expect(incoming.items[1].taxRate).toBe('8');
    });

    it('should omit taxRate when the row lacks tax-incl/excl prices (#1586)', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '44',
        reference: 'ORDER-044',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_incl: '99.99',
        total_paid_tax_excl: '99.99',
        total_shipping: '0',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const orderRows: PrestashopOrderRow[] = [
        {
          id: '100',
          product_id: '5',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '99.99',
          product_reference: 'SKU-5',
        },
      ];

      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '44' });

      expect(incoming.items[0].taxRate).toBeUndefined();
      expect('taxRate' in incoming.items[0]).toBe(false);
    });

    it('should translate a 404 from the webservice client into PrestashopResourceNotFoundException', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValueOnce(new PrestashopApiException('Not Found', 404));
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });

    it('should propagate non-404 webservice errors unchanged (not mask them as not-found)', async () => {
      const serverError = new PrestashopApiException('Upstream 500', 500);
      mockHttpClient.getResource = jest.fn().mockRejectedValueOnce(serverError);
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBe(serverError);
    });

    it('should propagate transport errors (no status code) unchanged', async () => {
      const networkError = new Error('ECONNREFUSED');
      mockHttpClient.getResource = jest.fn().mockRejectedValueOnce(networkError);
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBe(networkError);
    });
  });

  describe('getOrder — pickupPoint resolution', () => {
    const baseOrder: PrestashopOrder = {
      id: '42',
      reference: 'ORDER-042',
      id_customer: '7',
      id_address_delivery: '5',
      current_state: '2',
      total_paid: '99.99',
      date_add: '2024-01-01 10:00:00',
      date_upd: '2024-01-01 12:00:00',
    };
    const baseOrderRows: PrestashopOrderRow[] = [];

    // Resource-keyed getResource mock. Since #<issue> the adapter also hydrates
    // the buyer address (and its country) inside getOrder, so the call sequence
    // is no longer "order then address" — these tests dispatch by (resource,id)
    // instead of relying on call order.
    const keyedGetResource = (address: Record<string, unknown> | Error): void => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(baseOrder);
        if (resource === 'addresses') {
          return address instanceof Error
            ? Promise.reject(address)
            : Promise.resolve({ id, ...address });
        }
        // Country value is irrelevant to pickup-point resolution; any ISO is fine here.
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
    };

    it('should populate pickupPoint when inpostPsModuleType is official_inpost and address2 is a paczkomat code', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      keyedGetResource({ address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'POZ08A' });
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('addresses', '5');
    });

    it('should leave pickupPoint undefined when inpostPsModuleType is none', async () => {
      const noneConnection = createTestConnection({
        config: { inpostPsModuleType: 'none' },
      });
      const noneAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        noneConnection
      );
      keyedGetResource({ address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await noneAdapter.getOrder({ externalOrderId: '42' });

      // pickupPoint stays undefined because the module type is not official_inpost,
      // even though the address itself is hydrated for the buyer profile.
      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when inpostPsModuleType is absent', async () => {
      keyedGetResource({ address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when address2 does not match paczkomat format', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      keyedGetResource({ address2: 'Piętro 2' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when address fetch fails', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      keyedGetResource(new PrestashopApiException('Not Found', 404));
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should normalise paczkomat code to uppercase', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      keyedGetResource({ address2: 'poz08a' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'POZ08A' });
    });

    it('should populate pickupPoint for a three-digit paczkomat code (WAW124)', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      keyedGetResource({ address2: 'WAW124' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'WAW124' });
    });

    it('should leave pickupPoint undefined when id_address_delivery is absent', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      const orderWithoutAddress: PrestashopOrder = { ...baseOrder, id_address_delivery: undefined };
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(orderWithoutAddress);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOrder — order line items (PS9 order_details rename)', () => {
    it('should fetch order rows from the order_details resource (renamed from order_rows in PS9)', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      await adapter.getOrder({ externalOrderId: '42' });

      expect(mockHttpClient.listResources).toHaveBeenCalledWith('order_details', {
        custom: { id_order: '42' },
      });
    });
  });

  describe('getOrder — buyer address hydration', () => {
    const orderWithAddresses: PrestashopOrder = {
      id: '42',
      reference: 'ORDER-042',
      id_customer: '7',
      id_address_invoice: '11',
      id_address_delivery: '11',
      current_state: '2',
      total_paid: '99.99',
      date_add: '2024-01-01 10:00:00',
      date_upd: '2024-01-01 12:00:00',
    };

    it('should hydrate billing/shipping address from the addresses resource and resolve country ISO-2', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({
            id,
            firstname: 'Jan',
            lastname: 'Kowalski',
            company: 'ACME Sp. z o.o.',
            address1: 'ul. Testowa 1',
            address2: 'm. 4',
            city: 'Poznań',
            postcode: '60-001',
            phone: '+48123456789',
            id_country: '14',
          });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'pl' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress).toEqual({
        firstName: 'Jan',
        lastName: 'Kowalski',
        company: 'ACME Sp. z o.o.',
        address1: 'ul. Testowa 1',
        address2: 'm. 4',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
        phone: '+48123456789',
      });
      // Delivery uses the same address id (11) → shipping equals billing.
      expect(incoming.shippingAddress).toEqual(incoming.billingAddress);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('addresses', '11');
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('countries', '14');
    });

    it('should leave country empty and still hydrate the address when the country fetch fails', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({ id, address1: 'ul. Testowa 1', city: 'Poznań', postcode: '60-001', id_country: '14' });
        }
        if (resource === 'countries') return Promise.reject(new Error('boom'));
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress?.country).toBe('');
      expect(incoming.billingAddress?.address1).toBe('ul. Testowa 1');
    });

    it('should leave addresses undefined when the order carries no address ids', async () => {
      const orderNoAddr: PrestashopOrder = { ...orderWithAddresses };
      delete orderNoAddr.id_address_invoice;
      delete orderNoAddr.id_address_delivery;
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(orderNoAddr);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress).toBeUndefined();
      expect(incoming.shippingAddress).toBeUndefined();
      // Only the order itself is fetched — no address/country round-trips.
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(1);
    });

    it('should fall back to billing address for shipping when delivery hydration fails', async () => {
      const order: PrestashopOrder = { ...orderWithAddresses, id_address_invoice: '11', id_address_delivery: '22' };
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(order);
        if (resource === 'addresses') {
          if (id === '22') return Promise.reject(new Error('delivery 404'));
          return Promise.resolve({ id, address1: 'Bill St 1', city: 'Warsaw', postcode: '00-001', id_country: '14' });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.shippingAddress).toEqual(incoming.billingAddress);
      expect(incoming.billingAddress?.address1).toBe('Bill St 1');
    });
  });
});
