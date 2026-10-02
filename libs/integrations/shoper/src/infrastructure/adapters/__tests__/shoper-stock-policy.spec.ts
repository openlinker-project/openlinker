/**
 * Stock policy (#3695): Shoper removes stock itself when an order line is
 * created, so OpenLinker must never remove it a second time.
 *
 * One stateful fake shop emulates what the trial shop was observed to do
 * (SPIKE-3638 O6; #3693 smoke: 74 -> 72 for a quantity-2 line, 74 again after
 * `DELETE /orders/:id`) and is wired to the REAL order and inventory adapters,
 * so "no double decrement" is asserted on the number a sync would then read
 * back, not on a mock call count.
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { OrderCreate } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { MAP_CONTEXT, buildProduct } from '../../__tests__/shoper-test-data';
import type { ShoperTax } from '../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import type { ShoperCustomerProvisioner } from '../../provisioners/shoper-customer.provisioner';
import { ShoperProductReader } from '../../readers/shoper-product.reader';
import type { ShoperOrderOptionsProvider } from '../../shop-context/shoper-order-options.provider';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';
import type { ShoperTaxTableProvider } from '../../shop-context/shoper-tax-table.provider';
import { ShoperInventoryMasterAdapter } from '../inventory-master/shoper-inventory-master.adapter';
import { ShoperOrderProcessorAdapter } from '../order-processor/shoper-order-processor.adapter';

const CONNECTION = { id: 'conn-1', config: { defaults: { shippingId: 8, paymentId: 1, statusId: 1 } } } as unknown as Connection;
const MARKER = 'OpenLinker order ol_order_1';

interface Request {
  readonly method: string;
  readonly path: string;
}

/** A shop with one product (93) holding one stock row (181). */
class FakeShop {
  stock = 74;
  readonly requests: Request[] = [];
  readonly orders = new Map<number, { notes: string; lines: Array<{ quantity: number }> }>();
  private nextOrderId = 10;
  failLineNumber: number | null = null;

  constructor(readonly decrementsOnBuy: boolean) {}

  readonly client = {
    get: (path: string, query?: Record<string, string>) => this.handle('GET', path, undefined, query),
    post: (path: string, body: unknown) => this.handle('POST', path, body),
    put: (path: string, body: unknown) => this.handle('PUT', path, body),
    delete: (path: string) => this.handle('DELETE', path),
  } as unknown as ShoperHttpClient;

  private handle(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<{ status: number; data: unknown }> {
    this.requests.push({ method, path });
    const ok = (data: unknown): Promise<{ status: number; data: unknown }> => Promise.resolve({ status: 200, data });

    if (method === 'GET' && path === '/product-stocks') {
      return ok({
        count: '1',
        pages: 1,
        page: 1,
        list: [{ stock_id: '181', product_id: '93', stock: String(this.stock) }],
      });
    }
    if (method === 'GET' && path === '/orders') {
      const list = [...this.orders].filter(([, o]) => o.notes === query?.['filters[notes_priv]']);
      return ok({ list: list.map(([id, o]) => ({ order_id: String(id), notes_priv: o.notes })) });
    }
    if (method === 'GET' && path === '/order-products') {
      const id = Number(query?.['filters[order_id]']);
      return ok({ count: String(this.orders.get(id)?.lines.length ?? 0) });
    }
    if (method === 'POST' && path === '/orders') {
      const id = this.nextOrderId++;
      this.orders.set(id, { notes: (body as { notes_priv: string }).notes_priv, lines: [] });
      return ok(id);
    }
    if (method === 'POST' && path === '/order-products') {
      const line = body as { order_id: number; quantity: number };
      const order = this.orders.get(line.order_id);
      if (order === undefined) {
        return Promise.reject(new Error('unknown order'));
      }
      if (this.failLineNumber !== null && order.lines.length + 1 === this.failLineNumber) {
        return Promise.reject(new Error('shop refused the line'));
      }
      order.lines.push({ quantity: line.quantity });
      if (this.decrementsOnBuy) {
        this.stock -= line.quantity;
      }
      return ok(16);
    }
    const deleteOrder = /^\/orders\/(\d+)$/.exec(path);
    if (method === 'DELETE' && deleteOrder !== null) {
      const id = Number(deleteOrder[1]);
      const order = this.orders.get(id);
      if (order !== undefined && this.decrementsOnBuy) {
        this.stock += order.lines.reduce((sum, l) => sum + l.quantity, 0);
      }
      this.orders.delete(id);
      return ok(1);
    }
    if (method === 'GET' && path === '/products/93') {
      return ok(buildProduct());
    }
    return Promise.reject(new Error(`FakeShop: unexpected ${method} ${path}`));
  }

  stockWrites(): Request[] {
    return this.requests.filter((r) => r.path.startsWith('/product-stocks') && r.method !== 'GET');
  }
}

function build(shop: FakeShop): {
  orders: ShoperOrderProcessorAdapter;
  inventory: ShoperInventoryMasterAdapter;
} {
  const externalIds: Record<string, string> = { ol_p1: '93', ol_v1: '181' };
  const mapping = {
    getExternalIds: jest.fn((_type: string, id: string) =>
      Promise.resolve(externalIds[id] === undefined ? [] : [{ connectionId: 'conn-1', externalId: externalIds[id] }]),
    ),
    batchGetOrCreateInternalIds: jest.fn((reqs: Array<{ externalId: string; connectionId: string }>) =>
      Promise.resolve(new Map(reqs.map((r) => [`${r.externalId}:${r.connectionId}`, `ol_${r.externalId}`]))),
    ),
  } as unknown as IdentifierMappingPort;
  const shopContext = {
    get: () => Promise.resolve({ ...MAP_CONTEXT, decrementsStockOnOrder: shop.decrementsOnBuy }),
  } as unknown as ShoperShopContextProvider;
  const taxes = new Map<string, ShoperTax>([['1', { tax_id: '1', value: '23', name: '23%' }]]);

  return {
    orders: new ShoperOrderProcessorAdapter(
      shop.client,
      mapping,
      { resolveOrCreateCustomer: () => Promise.resolve('91') } as unknown as ShoperCustomerProvisioner,
      { get: () => Promise.resolve(taxes) } as unknown as ShoperTaxTableProvider,
      {
        getShippingTaxId: () => Promise.resolve('1'),
        getCurrencyId: () => Promise.resolve('1'),
      } as unknown as ShoperOrderOptionsProvider,
      shopContext,
      CONNECTION,
    ),
    inventory: new ShoperInventoryMasterAdapter(
      shop.client,
      mapping,
      shopContext,
      new ShoperProductReader(shop.client, 'conn-1'),
      CONNECTION,
    ),
  };
}

function order(items: number): OrderCreate {
  return {
    internalOrderId: 'ol_order_1',
    status: 'pending',
    customerId: 'ol_customer_1',
    items: Array.from({ length: items }, (_unused, i) => ({
      id: `l${i}`,
      productId: 'ol_p1',
      variantId: 'ol_v1',
      quantity: 2,
      price: 50,
      taxRate: '23',
    })),
    totals: { subtotal: 100, tax: 0, shipping: 0, total: 100 * items, currency: 'PLN', taxTreatment: 'inclusive' },
    billingAddress: { firstName: 'Jan', address1: 'a', city: 'c', postalCode: 'p', country: 'PL', phone: '600' },
    metadata: { buyerEmail: 'jan@example.com' },
  } as unknown as OrderCreate;
}

async function readBack(inventory: ShoperInventoryMasterAdapter): Promise<number> {
  const [row] = await inventory.listInventory('ol_p1');
  return row.available;
}

describe('Shoper stock policy: OpenLinker never removes stock a second time', () => {
  afterEach(() => jest.restoreAllMocks());

  it('should leave exactly one decrement, and read it back, after an order is created', async () => {
    const shop = new FakeShop(true);
    const { orders, inventory } = build(shop);

    await orders.createOrder(order(1));

    expect(shop.stock).toBe(72);
    await expect(readBack(inventory)).resolves.toBe(72);
    expect(shop.stockWrites()).toEqual([]);
  });

  it('should not decrement again when the same order is retried (mapping lost)', async () => {
    const shop = new FakeShop(true);
    const { orders, inventory } = build(shop);

    const first = await orders.createOrder(order(1));
    const retry = await orders.createOrder(order(1));

    expect(retry).toEqual(first);
    expect(shop.orders.size).toBe(1);
    await expect(readBack(inventory)).resolves.toBe(72);
    expect(shop.stockWrites()).toEqual([]);
  });

  it('should leave the stock where it started when a later line fails and the order is rolled back', async () => {
    const shop = new FakeShop(true);
    shop.failLineNumber = 2;
    const { orders, inventory } = build(shop);

    await expect(orders.createOrder(order(2))).rejects.toThrow('shop refused the line');

    expect(shop.stock).toBe(74);
    expect(shop.orders.size).toBe(0);
    await expect(readBack(inventory)).resolves.toBe(74);
  });

  it('should not compensate, and should warn, when the shop does not decrement stock itself', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const shop = new FakeShop(false);
    const { orders, inventory } = build(shop);

    await orders.createOrder(order(1));

    expect(shop.stock).toBe(74);
    await expect(readBack(inventory)).resolves.toBe(74);
    expect(shop.stockWrites()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('shopping_update_stock_on_buy off'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(MARKER.replace('OpenLinker order ', '')));
  });

  it('should not warn when the shop decrements stock itself', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const shop = new FakeShop(true);

    await build(shop).orders.createOrder(order(1));

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('shopping_update_stock_on_buy'));
  });

  it('should only ever touch the order, user, tax, shipping, currency and read-only stock endpoints', async () => {
    const shop = new FakeShop(true);

    await build(shop).orders.createOrder(order(1));

    const forbidden = shop.requests.filter(
      (r) => r.method === 'PUT' || (r.path.startsWith('/product-stocks') && r.method !== 'GET'),
    );
    expect(forbidden).toEqual([]);
  });
});
