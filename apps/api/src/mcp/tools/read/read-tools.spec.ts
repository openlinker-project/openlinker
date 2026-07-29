/**
 * Read-Tool Unit Tests
 *
 * One suite per tool. The recurring theme is PROJECTION: a tool result is
 * handed to an external LLM provider, so each test asserts not just that the
 * right data comes back but that the wrong data does NOT.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IProductsService } from '@openlinker/core/products';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';

import type { IConnectionService } from '../../../integrations/application/interfaces/connection.service.interface';
import { createListConnectionsTool } from './list-connections.tool';
import { createSearchCatalogTool } from './search-catalog.tool';
import { createGetProductTool } from './get-product.tool';
import { createGetAvailabilityTool } from './get-availability.tool';
import { createGetOrderTool } from './get-order.tool';

function payloadOf(result: CallToolResult): unknown {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function textOf(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

describe('list_connections tool', () => {
  const connection = {
    id: 'conn-1',
    name: 'Main shop',
    platformType: 'prestashop',
    status: 'active',
    enabledCapabilities: ['ProductMaster'],
    credentialsRef: 'creds:super-secret-ref',
    config: { shopUrl: 'https://shop.example', apiToken: 'leaky' },
  } as unknown as Connection;

  const service = { list: () => Promise.resolve([connection]) } as unknown as IConnectionService;

  it('should return the operator-facing connection fields', async () => {
    const result = await createListConnectionsTool(service).handler({}, {} as never);

    expect(payloadOf(result)).toEqual([
      {
        id: 'conn-1',
        name: 'Main shop',
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['ProductMaster'],
      },
    ]);
  });

  it('should never expose credentialsRef or the raw config blob', async () => {
    const result = await createListConnectionsTool(service).handler({}, {} as never);

    const text = textOf(result);
    expect(text).not.toContain('credentialsRef');
    expect(text).not.toContain('super-secret-ref');
    expect(text).not.toContain('apiToken');
    expect(text).not.toContain('leaky');
  });

  it('should always be registered, since discovery must work with no connections', () => {
    expect(createListConnectionsTool(service).requiredCapability).toBeNull();
  });
});

describe('search_catalog tool', () => {
  function serviceReturning(items: unknown[]): {
    service: IProductsService;
    calls: unknown[][];
  } {
    const calls: unknown[][] = [];
    const service = {
      listProducts: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ items, total: items.length });
      },
    } as unknown as IProductsService;
    return { service, calls };
  }

  it('should map the query to the case-insensitive name/SKU filter', async () => {
    const { service, calls } = serviceReturning([]);

    await createSearchCatalogTool(service).handler({ query: 'widget' }, {} as never);

    expect(calls[0][0]).toEqual({ search: 'widget' });
  });

  it('should map connectionId to the provenance filter, not a listing filter', async () => {
    const { service, calls } = serviceReturning([]);

    await createSearchCatalogTool(service).handler({ connectionId: 'conn-1' }, {} as never);

    expect(calls[0][0]).toEqual({ sourceConnectionId: 'conn-1' });
  });

  it('should default the page size rather than returning an unbounded list', async () => {
    const { service, calls } = serviceReturning([]);

    await createSearchCatalogTool(service).handler({}, {} as never);

    expect(calls[0][1]).toEqual({ limit: 20, offset: 0 });
  });

  it('should reject a limit above the cap instead of honouring it', async () => {
    const { service } = serviceReturning([]);

    await expect(
      createSearchCatalogTool(service).handler({ limit: 5_000 }, {} as never)
    ).rejects.toThrow();
  });

  it('should project products rather than returning full entities', async () => {
    const { service } = serviceReturning([
      {
        id: 'ol_product_1',
        name: 'Widget',
        sku: 'W-1',
        price: 9.99,
        currency: 'PLN',
        description: 'a very long description that would bloat the context window',
        images: ['https://example/1.jpg'],
      },
    ]);

    const result = await createSearchCatalogTool(service).handler({}, {} as never);

    expect(payloadOf(result)).toEqual({
      total: 1,
      returned: 1,
      products: [{ id: 'ol_product_1', name: 'Widget', sku: 'W-1', price: 9.99, currency: 'PLN' }],
    });
  });
});

describe('get_product tool', () => {
  it('should return an actionable error when the product does not exist', async () => {
    const service = {
      getProduct: () => Promise.resolve(null),
    } as unknown as IProductsService;

    const result = await createGetProductTool(service).handler(
      { productId: 'ol_product_missing' },
      {} as never
    );

    expect(result.isError).toBe(true);
    // Agent-facing copy should name the recovery path.
    expect(textOf(result)).toContain('search_catalog');
  });

  it('should include variants with their barcode fields', async () => {
    const service = {
      getProduct: () =>
        Promise.resolve({ id: 'ol_product_1', name: 'W', sku: null, price: 1, currency: 'PLN', description: null }),
      getVariantsByProductId: () =>
        Promise.resolve([
          { id: 'ol_variant_1', sku: 'V-1', ean: '590123', gtin: null, price: 2, attributes: { size: 'M' } },
        ]),
    } as unknown as IProductsService;

    const result = await createGetProductTool(service).handler(
      { productId: 'ol_product_1' },
      {} as never
    );

    expect(payloadOf(result)).toEqual(
      expect.objectContaining({
        id: 'ol_product_1',
        variants: [
          {
            id: 'ol_variant_1',
            sku: 'V-1',
            ean: '590123',
            gtin: null,
            price: 2,
            attributes: { size: 'M' },
          },
        ],
      })
    );
  });
});

describe('get_availability tool', () => {
  const service = {
    getProductStockAggregates: (ids: readonly string[]) =>
      Promise.resolve(
        ids.map((productId) => ({
          productId,
          totalAvailable: 7,
          totalReserved: 2,
          stockUpdatedAt: new Date('2026-07-01T10:00:00.000Z'),
        }))
      ),
    getAvailabilityByVariantIds: (ids: readonly string[]) =>
      Promise.resolve(
        ids.map((productVariantId) => ({ productVariantId, totalAvailable: 3, locationCount: 1 }))
      ),
  } as unknown as IInventoryQueryService;

  it('should use the product-level aggregate when given product ids', async () => {
    const result = await createGetAvailabilityTool(service).handler(
      { productIds: ['ol_product_1'] },
      {} as never
    );

    expect(payloadOf(result)).toEqual({
      products: [
        {
          productId: 'ol_product_1',
          totalAvailable: 7,
          totalReserved: 2,
          stockUpdatedAt: '2026-07-01T10:00:00.000Z',
        },
      ],
    });
  });

  it('should use the variant-keyed read when given variant ids', async () => {
    const result = await createGetAvailabilityTool(service).handler(
      { variantIds: ['ol_variant_1'] },
      {} as never
    );

    expect(payloadOf(result)).toEqual({
      variants: [{ variantId: 'ol_variant_1', totalAvailable: 3, locationCount: 1 }],
    });
  });

  it('should refuse an ambiguous call that supplies both id kinds', async () => {
    const result = await createGetAvailabilityTool(service).handler(
      { productIds: ['p'], variantIds: ['v'] },
      {} as never
    );

    expect(result.isError).toBe(true);
  });

  it('should refuse a call that supplies neither id kind', async () => {
    const result = await createGetAvailabilityTool(service).handler({}, {} as never);

    expect(result.isError).toBe(true);
  });

  it('should not accept a connectionId, because the underlying reads are global', () => {
    const tool = createGetAvailabilityTool(service);
    const shape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;

    expect(Object.keys(shape).sort()).toEqual(['productIds', 'variantIds']);
  });
});

describe('get_order tool', () => {
  function recordWith(snapshot: Record<string, unknown>): OrderRecord {
    return {
      internalOrderId: 'ol_order_1',
      sourceConnectionId: 'conn-1',
      recordStatus: 'ready',
      syncStatus: [],
      fulfillmentState: null,
      paymentStatus: 'paid',
      dispatchByAt: null,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
      orderSnapshot: snapshot,
    } as unknown as OrderRecord;
  }

  const piiSnapshot = {
    orderNumber: 'A-1',
    status: 'NEW',
    totals: { grandTotal: 42 },
    items: [{ sku: 'W-1', name: 'Widget', quantity: 2, unitPrice: 21 }],
    customerEmail: 'buyer@example.com',
    shippingAddress: { street: '1 Buyer Way', city: 'Warsaw', firstName: 'Jan' },
    billingAddress: { street: '1 Buyer Way' },
  };

  function serviceReturning(record: OrderRecord | null): IOrderRecordService {
    return { getOrderRecord: () => Promise.resolve(record) } as unknown as IOrderRecordService;
  }

  it('should return the operational fields an agent asks about', async () => {
    const tool = createGetOrderTool(serviceReturning(recordWith(piiSnapshot)));

    const result = await tool.handler({ orderId: 'ol_order_1' }, {} as never);

    expect(payloadOf(result)).toEqual(
      expect.objectContaining({
        internalOrderId: 'ol_order_1',
        orderNumber: 'A-1',
        status: 'NEW',
        paymentStatus: 'paid',
        totals: { grandTotal: 42 },
      })
    );
  });

  it('should never forward buyer PII, even when the snapshot stores it', async () => {
    const tool = createGetOrderTool(serviceReturning(recordWith(piiSnapshot)));

    const text = textOf(await tool.handler({ orderId: 'ol_order_1' }, {} as never));

    expect(text).not.toContain('buyer@example.com');
    expect(text).not.toContain('1 Buyer Way');
    expect(text).not.toContain('Jan');
    expect(text).not.toContain('shippingAddress');
    expect(text).not.toContain('billingAddress');
  });

  it('should project line items field-by-field so new snapshot fields cannot leak', async () => {
    const tool = createGetOrderTool(
      serviceReturning(
        recordWith({
          items: [{ sku: 'W-1', quantity: 1, buyerNote: 'call me on 555-1234' }],
        })
      )
    );

    const text = textOf(await tool.handler({ orderId: 'ol_order_1' }, {} as never));

    expect(text).not.toContain('buyerNote');
    expect(text).not.toContain('555-1234');
  });

  it('should return an error when the order does not exist', async () => {
    const tool = createGetOrderTool(serviceReturning(null));

    const result = await tool.handler({ orderId: 'nope' }, {} as never);

    expect(result.isError).toBe(true);
  });
});
