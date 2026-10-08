import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { Address, OrderCreate } from '@openlinker/core/orders';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperDuplicateOrderException } from '../../../../domain/exceptions/shoper-duplicate-order.exception';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
import { ShoperOrderModifiedException } from '../../../../domain/exceptions/shoper-order-modified.exception';
import { ShoperNotMappedException } from '../../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperOrderUnbuildableException } from '../../../../domain/exceptions/shoper-order-unbuildable.exception';
import { ShoperPartialOrderException } from '../../../../domain/exceptions/shoper-partial-order.exception';
import type { ShoperTax } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperCustomerProvisioner } from '../../../provisioners/shoper-customer.provisioner';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT } from '../../../__tests__/shoper-test-data';
import type { ShoperOrderOptionsProvider } from '../../../shop-context/shoper-order-options.provider';
import type { ShoperTaxTableProvider } from '../../../shop-context/shoper-tax-table.provider';
import { ShoperOrderProcessorAdapter } from '../shoper-order-processor.adapter';

const TAXES = new Map<string, ShoperTax>([
  ['1', { tax_id: '1', value: '23', name: '23%' }],
  ['2', { tax_id: '2', value: '8', name: '8%' }],
]);

function address(firstName = 'Jan', lastName = 'Kowalski'): Address {
  return {
    firstName,
    lastName,
    address1: 'Prosta 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'pl',
    phone: '600100200',
  };
}

function order(overrides: Record<string, unknown> = {}): OrderCreate {
  return {
    internalOrderId: 'ol_order_1',
    status: 'pending',
    customerId: 'ol_customer_1',
    items: [
      { id: 'l1', productId: 'ol_p1', variantId: 'ol_v1', quantity: 2, price: 50, sku: 'SKU1', name: 'Misa', taxRate: '23' },
      { id: 'l2', productId: 'ol_p2', variantId: 'ol_v2', quantity: 1, price: 10, sku: 'SKU2', taxRate: '8' },
    ],
    totals: { subtotal: 110, tax: 0, shipping: 12, total: 122, currency: 'PLN', taxTreatment: 'inclusive' },
    billingAddress: address(),
    shippingAddress: address('Anna', 'Nowak'),
    shipping: { methodId: 'allegro-m1' },
    source: { connectionId: 'allegro-conn' },
    metadata: { buyerEmail: ' jan@example.com ' },
    ...overrides,
  } as unknown as OrderCreate;
}

function setup(
  config: Record<string, unknown> = { defaults: { shippingId: 8, paymentId: 1, statusId: 1 } },
  shopDecrements = true,
  shopContextFails = false,
): Harness {
  const post = jest.fn().mockImplementation((path: string) =>
    Promise.resolve({ status: 200, data: path === '/orders' ? 10 : 16 }),
  );
  const del = jest.fn().mockResolvedValue({ status: 200, data: 1 });
  const put = jest.fn().mockResolvedValue({ status: 200, data: 1 });
  const get = jest.fn().mockResolvedValue({ status: 200, data: { count: '0', list: [] } });
  const mapping = {
    getExternalIds: jest.fn().mockImplementation((type: string, id: string) =>
      Promise.resolve([{ connectionId: 'conn-1', externalId: `${type}:${id}`.replace(/\D+/g, '') || '1' }]),
    ),
  };
  const resolveOrCreateCustomer = jest.fn().mockResolvedValue('91');
  const options = {
    getShippingTaxId: jest.fn().mockResolvedValue('1'),
    getCurrencyId: jest.fn().mockResolvedValue('1'),
  };
  const mappingConfig = {
    resolveCarrierMapping: jest.fn().mockResolvedValue(null),
    resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
  };
  const adapter = new ShoperOrderProcessorAdapter(
    { post, put, delete: del, get } as unknown as ShoperHttpClient,
    mapping as unknown as IdentifierMappingPort,
    { resolveOrCreateCustomer } as unknown as ShoperCustomerProvisioner,
    { get: () => Promise.resolve(TAXES) } as unknown as ShoperTaxTableProvider,
    options as unknown as ShoperOrderOptionsProvider,
    {
      get: () =>
        shopContextFails
          ? Promise.reject(new Error('shop context unavailable'))
          : Promise.resolve({ ...MAP_CONTEXT, decrementsStockOnOrder: shopDecrements }),
    } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', config } as unknown as Connection,
    mappingConfig as unknown as IMappingConfigService,
  );
  return { adapter, post, put, del, get, options, mappingConfig, resolveOrCreateCustomer };
}

interface Harness {
  adapter: ShoperOrderProcessorAdapter;
  post: jest.Mock;
  put: jest.Mock;
  del: jest.Mock;
  get: jest.Mock;
  options: { getShippingTaxId: jest.Mock; getCurrencyId: jest.Mock };
  mappingConfig: { resolveCarrierMapping: jest.Mock; resolveOrderStateMapping: jest.Mock };
  resolveOrCreateCustomer: jest.Mock;
}

describe('ShoperOrderProcessorAdapter', () => {
  describe('createOrder', () => {
    it('should create the header, then one line per item, at the buyer-paid gross price', async () => {
      const { adapter, post } = setup();

      await expect(adapter.createOrder(order())).resolves.toEqual({ orderId: '10' });

      const [headerPath, header] = post.mock.calls[0] as [string, Record<string, unknown>];
      expect(headerPath).toBe('/orders');
      expect(header).toMatchObject({
        user_id: 91,
        email: 'jan@example.com',
        status_id: 1,
        payment_id: 1,
        shipping_id: 8,
        shipping_tax_id: 1,
        shipping_cost: 12,
        currency_id: 1,
        notes_priv: 'OpenLinker order ol_order_1',
        billing_address: expect.objectContaining({ firstname: 'Jan', country_code: 'PL' }),
        delivery_address: expect.objectContaining({ firstname: 'Anna', lastname: 'Nowak' }),
      });
      expect(post).toHaveBeenCalledTimes(3);
      expect(post.mock.calls[1]).toEqual([
        '/order-products',
        expect.objectContaining({ order_id: 10, price: 50, quantity: 2, name: 'Misa', tax: '23%', tax_value: 23 }),
      ]);
      expect(post.mock.calls[2]).toEqual([
        '/order-products',
        expect.objectContaining({ order_id: 10, price: 10, quantity: 1, name: 'SKU2', tax: '8%', tax_value: 8 }),
      ]);
    });

    it('should still return the order when the post-create stock check fails', async () => {
      const { adapter, del } = setup(undefined, true, true);

      await expect(adapter.createOrder(order())).resolves.toEqual({ orderId: '10' });

      expect(del).not.toHaveBeenCalled();
    });

    it('should fill a missing phone from the other address', async () => {
      const { adapter, post } = setup();

      await adapter.createOrder(order({ billingAddress: { ...address(), phone: undefined } }));

      expect(post.mock.calls[0]).toEqual([
        '/orders',
        expect.objectContaining({
          billing_address: expect.objectContaining({ phone: '600100200' }),
        }),
      ]);
    });

    it('should prefer an operator mapping to the connection default', async () => {
      const { adapter, post, mappingConfig } = setup();
      mappingConfig.resolveCarrierMapping.mockResolvedValue('3');
      mappingConfig.resolveOrderStateMapping.mockResolvedValue('2');

      await adapter.createOrder(order());

      expect(mappingConfig.resolveCarrierMapping).toHaveBeenCalledWith('allegro-conn', 'allegro-m1');
      expect((post.mock.calls[0] as [string, unknown])[1]).toMatchObject({ shipping_id: 3, status_id: 2 });
    });

    it('should use the source gross price for a net-priced line', async () => {
      const { adapter, post } = setup();
      const o = order({
        totals: { subtotal: 100, tax: 23, shipping: 0, total: 123, currency: 'PLN', taxTreatment: 'exclusive' },
        items: [{ id: 'l1', productId: 'p', variantId: 'v', quantity: 1, price: 100, unitPriceGross: 123, taxRate: '23' }],
      });

      await adapter.createOrder(o);

      expect((post.mock.calls[1] as [string, unknown])[1]).toMatchObject({ price: 123 });
    });

    it('should refuse net-priced shipping the source gave no gross figure for, before any write', async () => {
      const { adapter, post, resolveOrCreateCustomer } = setup();
      const o = order({
        totals: { subtotal: 100, tax: 23, shipping: 10, total: 133, currency: 'PLN', taxTreatment: 'exclusive' },
        items: [{ id: 'l1', productId: 'p', variantId: 'v', quantity: 1, price: 100, unitPriceGross: 123, taxRate: '23' }],
      });

      await expect(adapter.createOrder(o)).rejects.toThrow(/shipping is net-priced/);
      expect(post).not.toHaveBeenCalled();
      expect(resolveOrCreateCustomer).not.toHaveBeenCalled();
    });

    it('should accept zero net shipping, and use the source gross shipping when it is reported', async () => {
      const free = setup();
      await free.adapter.createOrder(
        order({
          totals: { subtotal: 100, tax: 23, shipping: 0, total: 123, currency: 'PLN', taxTreatment: 'exclusive' },
          items: [{ id: 'l1', productId: 'p', variantId: 'v', quantity: 1, price: 100, unitPriceGross: 123, taxRate: '23' }],
        }),
      );
      expect((free.post.mock.calls[0] as [string, unknown])[1]).toMatchObject({ shipping_cost: 0 });

      const gross = setup();
      await gross.adapter.createOrder(
        order({
          totals: { subtotal: 100, tax: 23, shipping: 10, shippingGross: 12.3, total: 135.3, currency: 'PLN', taxTreatment: 'exclusive' },
          items: [{ id: 'l1', productId: 'p', variantId: 'v', quantity: 1, price: 100, unitPriceGross: 123, taxRate: '23' }],
        }),
      );
      expect((gross.post.mock.calls[0] as [string, unknown])[1]).toMatchObject({ shipping_cost: 12.3 });
    });

    it('should mark the order paid for exactly its sum when the source says it is paid', async () => {
      const { adapter, post } = setup();

      await adapter.createOrder(order({ paymentStatus: 'paid' }));

      // 2 x 50 + 1 x 10 + 12 shipping
      expect((post.mock.calls[0] as [string, unknown])[1]).toMatchObject({ paid: 122 });
    });

    it.each([['cod'], ['awaiting'], ['refunded'], [undefined]])(
      'should send no paid amount for payment status %p',
      async (paymentStatus) => {
        const { adapter, post } = setup();

        await adapter.createOrder(order({ paymentStatus }));

        expect((post.mock.calls[0] as [string, Record<string, unknown>])[1]).not.toHaveProperty('paid');
      },
    );

    it('should refuse a net-priced line the source gave no gross price for, before any write', async () => {
      const { adapter, post, resolveOrCreateCustomer } = setup();
      const o = order({
        totals: { subtotal: 100, tax: 23, shipping: 0, total: 123, currency: 'PLN', taxTreatment: 'exclusive' },
        items: [{ id: 'l1', productId: 'p', variantId: 'v', quantity: 1, price: 100, taxRate: '23' }],
      });

      await expect(adapter.createOrder(o)).rejects.toBeInstanceOf(ShoperOrderUnbuildableException);
      expect(post).not.toHaveBeenCalled();
      expect(resolveOrCreateCustomer).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing buyer email', { metadata: {} }],
      ['no lines', { items: [] }],
      ['no phone on either address', { billingAddress: { ...address(), phone: undefined }, shippingAddress: { ...address(), phone: ' ' } }],
      ['no address', { billingAddress: undefined, shippingAddress: undefined }],
      ['a line without a tax rate', { items: [{ id: 'l', productId: 'p', variantId: 'v', quantity: 1, price: 1 }] }],
      ['a tax rate the shop does not have', { items: [{ id: 'l', productId: 'p', variantId: 'v', quantity: 1, price: 1, taxRate: '5' }] }],
    ])('should refuse %s before any write', async (_label, overrides) => {
      const { adapter, post, resolveOrCreateCustomer } = setup();

      await expect(adapter.createOrder(order(overrides))).rejects.toBeInstanceOf(
        ShoperOrderUnbuildableException,
      );
      expect(post).not.toHaveBeenCalled();
      expect(resolveOrCreateCustomer).not.toHaveBeenCalled();
    });

    it('should name the config key to set when no payment method is configured', async () => {
      const { adapter, post } = setup({ defaults: { shippingId: 8, statusId: 1 } });

      await expect(adapter.createOrder(order())).rejects.toThrow(/defaults\.paymentId/);
      expect(post).not.toHaveBeenCalled();
    });

    it('should refuse a currency the shop does not have', async () => {
      const { adapter, post, options } = setup();
      options.getCurrencyId.mockResolvedValue(null);

      await expect(adapter.createOrder(order())).rejects.toThrow(/no currency "PLN"/);
      expect(post).not.toHaveBeenCalled();
    });

    it('should refuse an unknown shipping method as unbuildable', async () => {
      const { adapter, post, options } = setup();
      options.getShippingTaxId.mockRejectedValue(new ShoperApiError(404, 'invalid_request'));

      await expect(adapter.createOrder(order())).rejects.toBeInstanceOf(ShoperOrderUnbuildableException);
      expect(post).not.toHaveBeenCalled();
    });

    it('should refuse a line with no variant', async () => {
      const { adapter, post } = setup();
      const o = order({ items: [{ id: 'l', productId: 'p', quantity: 1, price: 1, taxRate: '23' }] });

      await expect(adapter.createOrder(o)).rejects.toBeInstanceOf(ShoperNotMappedException);
      expect(post).not.toHaveBeenCalled();
    });

    it('should delete the header and rethrow the cause when a line fails', async () => {
      const { adapter, post, del } = setup();
      const failure = new ShoperApiError(400, 'invalid_request', 'bad stock');
      post.mockImplementation((path: string) =>
        path === '/orders' ? Promise.resolve({ status: 200, data: 10 }) : Promise.reject(failure),
      );

      await expect(adapter.createOrder(order())).rejects.toBe(failure);
      expect(del).toHaveBeenCalledWith('/orders/10');
    });

    it('should report a partial order, terminally, when the cleanup delete fails too', async () => {
      const { adapter, post, del } = setup();
      post.mockImplementation((path: string) =>
        path === '/orders' ? Promise.resolve({ status: 200, data: 10 }) : Promise.reject(new Error('boom')),
      );
      del.mockRejectedValue(new Error('delete failed'));

      const error = await adapter.createOrder(order()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ShoperPartialOrderException);
      expect(error).toMatchObject({ externalOrderId: '10', linesCreated: 0, linesTotal: 2 });
    });

    it('should refuse a header answer with no order id', async () => {
      const { adapter, post } = setup();
      post.mockResolvedValue({ status: 200, data: {} });

      await expect(adapter.createOrder(order())).rejects.toBeInstanceOf(ShoperOrderUnbuildableException);
    });
  });

  describe('duplicate recovery', () => {
    const MARKER = 'OpenLinker order ol_order_1';

    function shopWith(
      get: jest.Mock,
      existing: Array<{ id: string; lines: number; statusId?: number }>,
    ): void {
      get.mockImplementation((path: string, query?: Record<string, string>) => {
        if (path === '/orders') {
          return Promise.resolve({
            status: 200,
            data: {
              list: existing.map((o) => ({ order_id: o.id, notes_priv: MARKER, status_id: String(o.statusId ?? 1) })),
            },
          });
        }
        const found = existing.find((o) => o.id === query?.['filters[order_id]']);
        return Promise.resolve({ status: 200, data: { count: String(found?.lines ?? 0) } });
      });
    }

    it('should look the order up by its marker before writing anything', async () => {
      const { adapter, get, post } = setup();

      await adapter.createOrder(order());

      expect(get).toHaveBeenCalledWith('/orders', { 'filters[notes_priv]': MARKER });
      expect(get.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
    });

    it('should return the existing complete order and write nothing (retry after a lost mapping)', async () => {
      const { adapter, get, post, del, resolveOrCreateCustomer } = setup();
      shopWith(get, [{ id: '42', lines: 2 }]);

      await expect(adapter.createOrder(order())).resolves.toEqual({ orderId: '42' });

      expect(post).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(resolveOrCreateCustomer).not.toHaveBeenCalled();
    });

    it('should delete an incomplete order and recreate it', async () => {
      const { adapter, get, post, del } = setup();
      shopWith(get, [{ id: '42', lines: 1 }]);

      await expect(adapter.createOrder(order())).resolves.toEqual({ orderId: '10' });

      expect(del).toHaveBeenCalledWith('/orders/42');
      expect(del.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('should NOT delete a mismatching order that has left its creation status (edited in the shop)', async () => {
      const { adapter, get, post, del } = setup();
      shopWith(get, [{ id: '42', lines: 1, statusId: 3 }]);

      const error = await adapter.createOrder(order()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ShoperOrderModifiedException);
      expect(error).toMatchObject({ externalOrderId: '42' });
      expect(del).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], ['n/a']])(
      'should fail closed, deleting nothing, when the line count is unreadable (%p)',
      async (count) => {
        const { adapter, get, post, del } = setup();
        get.mockImplementation((path: string) =>
          Promise.resolve({
            status: 200,
            data:
              path === '/orders'
                ? { list: [{ order_id: '42', notes_priv: MARKER, status_id: '1' }] }
                : { count },
          }),
        );

        await expect(adapter.createOrder(order())).rejects.toBeInstanceOf(ShoperNetworkError);
        expect(del).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
      },
    );

    it('should refuse, naming the ids, when several orders carry the marker', async () => {
      const { adapter, get, post, del } = setup();
      shopWith(get, [{ id: '42', lines: 2 }, { id: '43', lines: 2 }]);

      const error = await adapter.createOrder(order()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ShoperDuplicateOrderException);
      expect(error).toMatchObject({ externalOrderIds: ['42', '43'] });
      expect(post).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('should ignore a row whose marker is not an exact match', async () => {
      const { adapter, get, post } = setup();
      get.mockResolvedValue({
        status: 200,
        data: { list: [{ order_id: '42', notes_priv: `${MARKER}0` }] },
      });

      await adapter.createOrder(order());

      expect(post).toHaveBeenCalledTimes(3);
    });

    it('should refuse an order with no internalOrderId, before any request', async () => {
      const { adapter, get, post } = setup();

      await expect(adapter.createOrder(order({ internalOrderId: undefined }))).rejects.toThrow(
        /internalOrderId/,
      );
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });

    it('should converge on ONE order across a crash-and-retry (create succeeds, mapping never recorded)', async () => {
      const { adapter, get, post } = setup();
      const shop: Array<{ id: string; lines: number }> = [];
      get.mockImplementation((path: string, query?: Record<string, string>) =>
        Promise.resolve({
          status: 200,
          data:
            path === '/orders'
              ? { list: shop.map((o) => ({ order_id: o.id, notes_priv: MARKER })) }
              : { count: String(shop.find((o) => o.id === query?.['filters[order_id]'])?.lines ?? 0) },
        }),
      );
      post.mockImplementation((path: string, body: { order_id?: number }) => {
        if (path === '/orders') {
          shop.push({ id: '10', lines: 0 });
          return Promise.resolve({ status: 200, data: 10 });
        }
        shop.find((o) => o.id === String(body.order_id))!.lines += 1;
        return Promise.resolve({ status: 200, data: 16 });
      });

      const first = await adapter.createOrder(order());
      const retry = await adapter.createOrder(order());

      expect(retry).toEqual(first);
      expect(shop).toHaveLength(1);
    });
  });

  describe('DestinationOptionsReader', () => {
    function pages(rows: unknown[]): jest.Mock {
      return jest.fn().mockResolvedValue({ status: 200, data: { count: String(rows.length), pages: 1, page: 1, list: rows } });
    }

    it('should list shipping methods by id, labelled from the row or its first translation', async () => {
      const h = setup();
      h.get.mockImplementation(
        pages([
          { shipping_id: '8', name: 'InPost Kurier' },
          { shipping_id: '9', translations: { pl_PL: { name: 'Odbior osobisty' } } },
          { shipping_id: '10' },
        ]),
      );

      await expect(h.adapter.listCarriers()).resolves.toEqual([
        { value: '8', label: 'InPost Kurier' },
        { value: '9', label: 'Odbior osobisty' },
        { value: '10', label: '10' },
      ]);
      expect(h.get).toHaveBeenCalledWith('/shippings', expect.objectContaining({ order: 'shipping_id ASC' }));
    });

    it('should list order statuses and payment methods from their own collections', async () => {
      const h = setup();
      h.get.mockImplementation((path: string) => {
        const list =
          path === '/statuses'
            ? [{ status_id: '1', translations: { pl_PL: { name: 'zlozone' }, en_US: { name: 'placed' } } }]
            : [{ payment_id: '1', name: 'cash', translations: { pl_PL: { title: 'Gotowka' } } }];
        return Promise.resolve({ status: 200, data: { count: '1', pages: 1, page: 1, list } });
      });

      await expect(h.adapter.listOrderStatuses()).resolves.toEqual([{ value: '1', label: 'zlozone' }]);
      await expect(h.adapter.listPaymentMethods()).resolves.toEqual([{ value: '1', label: 'cash' }]);
    });

    it('should read every page', async () => {
      const h = setup();
      h.get
        .mockResolvedValueOnce({ status: 200, data: { count: '2', pages: 2, page: 1, list: [{ shipping_id: '1', name: 'A' }] } })
        .mockResolvedValueOnce({ status: 200, data: { count: '2', pages: 2, page: 2, list: [{ shipping_id: '2', name: 'B' }] } });

      await expect(h.adapter.listCarriers()).resolves.toHaveLength(2);
    });
  });

  describe('customer resolution', () => {
    it('should resolve the customer from the metadata email and the billing name', async () => {
      const { adapter, post, resolveOrCreateCustomer } = setup();

      await adapter.createOrder(order());

      expect(resolveOrCreateCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          internalCustomerId: 'ol_customer_1',
          buyerEmail: 'jan@example.com',
          firstName: 'Jan',
          lastName: 'Kowalski',
          connectionId: 'conn-1',
        }),
      );
      expect((post.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ user_id: 91 });
    });

    it('should fall back to the shipping name and pass no email when it is not valid', async () => {
      const { adapter, resolveOrCreateCustomer } = setup();

      // An invalid email is refused before any write, so the provisioner is
      // never reached; the fallback name is exercised with a valid one.
      await adapter.createOrder(order({ billingAddress: undefined }));

      expect(resolveOrCreateCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Anna', lastName: 'Nowak' }),
      );
    });
  });

  describe('write (OrderStatusWriteback, #3643)', () => {
    function shopWith(parcels: readonly Record<string, unknown>[], shippingId: unknown = '8'): Harness {
      const h = setup();
      h.get.mockImplementation((path: string) => {
        if (path === '/parcels') return Promise.resolve({ status: 200, data: { list: parcels } });
        if (path === '/orders/10') {
          return Promise.resolve({ status: 200, data: { order_id: '10', shipping_id: shippingId } });
        }
        return Promise.resolve({ status: 200, data: {} });
      });
      return h;
    }

    it("should create a parcel with the tracking number and the order's own shipping method", async () => {
      const h = shopWith([]);

      await expect(
        h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: ' 6200000000001 ' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(h.get).toHaveBeenCalledWith('/parcels', { 'filters[order_id]': '10', limit: 50 });
      expect(h.post).toHaveBeenCalledWith('/parcels', {
        order_id: 10,
        shipping_id: 8,
        shipping_code: '6200000000001',
        sent: true,
      });
    });

    it('should not send products, so Shoper ships the whole remainder', async () => {
      const h = shopWith([]);

      await h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      const body = (h.post.mock.calls[0] as [string, Record<string, unknown>])[1];
      expect(body).not.toHaveProperty('products');
    });

    it('should create a parcel without a tracking number when none is known yet', async () => {
      const h = shopWith([]);

      await expect(h.adapter.write({ type: 'dispatched', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });

      expect(h.post).toHaveBeenCalledWith('/parcels', { order_id: 10, shipping_id: 8, sent: true });
    });

    it('should write nothing when a parcel already carries the same tracking number', async () => {
      const h = shopWith([{ parcel_id: '5', order_id: '10', shipping_code: 'T1' }]);

      await expect(
        h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(h.post).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should attach a late tracking number to the untracked parcel instead of creating another', async () => {
      const h = shopWith([{ parcel_id: '5', order_id: '10', shipping_code: '' }]);

      await expect(
        h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T2' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(h.put).toHaveBeenCalledWith('/parcels/5', { shipping_code: 'T2', sent: true });
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should reject, writing nothing, when a parcel exists under a different tracking number', async () => {
      const h = shopWith([{ parcel_id: '5', order_id: '10', shipping_code: 'T1' }]);

      const result = await h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T2' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('different tracking number');
      expect(h.post).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should write nothing on a re-delivered dispatch without tracking when a parcel exists', async () => {
      const h = shopWith([{ parcel_id: '5', order_id: '10', shipping_code: null }]);

      await expect(h.adapter.write({ type: 'dispatched', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });

      expect(h.post).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should reject, and write nothing, when the parcels filter returned another order', async () => {
      const h = shopWith([{ parcel_id: '9', order_id: '11', shipping_code: 'T1' }]);

      const result = await h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result).toEqual({
        outcome: 'rejected',
        detail: expect.stringContaining('was not honoured'),
      });
      expect(h.post).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should reject, and write nothing, when the order has more than one page of parcels', async () => {
      const h = setup();
      h.get.mockImplementation((path: string) =>
        path === '/parcels'
          ? Promise.resolve({ status: 200, data: { list: [], pages: 2 } })
          : Promise.resolve({ status: 200, data: {} }),
      );

      const result = await h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result).toEqual({ outcome: 'rejected', detail: expect.stringContaining('more than 50 parcels') });
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should reject when the Shoper order does not exist', async () => {
      const h = setup();
      h.get.mockImplementation((path: string) =>
        path === '/parcels'
          ? Promise.resolve({ status: 200, data: { list: [] } })
          : Promise.reject(new ShoperApiError(404, 'invalid_request', 'not found')),
      );

      await expect(
        h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'rejected', detail: 'Shoper order 10 not found' });
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should reject when the order has no shipping method', async () => {
      const h = shopWith([], null);

      const result = await h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result.outcome).toBe('rejected');
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should report a failed parcel write as rejected with the reason', async () => {
      const h = shopWith([]);
      h.post.mockRejectedValue(new ShoperApiError(400, 'invalid_request', 'shipping_id invalid'));

      const result = await h.adapter.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('shipping_id invalid');
    });

    it('should reject a non-numeric order id without calling the shop', async () => {
      const h = setup();

      const result = await h.adapter.write({ type: 'dispatched', externalOrderId: '../users', trackingNumber: 'T1' });

      expect(result.outcome).toBe('rejected');
      expect(h.get).not.toHaveBeenCalled();
    });

    it('should report cancellation as unsupported and write nothing', async () => {
      const h = setup();

      const result = await h.adapter.write({ type: 'cancelled', externalOrderId: '10' });

      expect(result.outcome).toBe('unsupported');
      expect(result.detail).toBeDefined();
      expect(h.get).not.toHaveBeenCalled();
      expect(h.post).not.toHaveBeenCalled();
    });
  });
});
