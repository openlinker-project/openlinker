import { SubiektOrderProcessorAdapter } from '../subiekt-order-processor.adapter';
import { SubiektOrdersBridgeClient } from '../../../bridge/subiekt-orders-bridge.client';
import { SubiektOrderProductMappingException } from '../../../domain/exceptions/subiekt-order-product-mapping.exception';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { OrderCreate } from '@openlinker/core/orders';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';

const noopLogger: LoggerPort = {
  log: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const CONNECTION_ID = 'conn-subiekt-1';

describe('SubiektOrderProcessorAdapter', () => {
  it('creates a ZK priced at the buyer-paid source total, never a catalogue lookup', async () => {
    let capturedBody: unknown;
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({ success: true, data: { id: 7, numer: 'ZK 7/2026' }, error: null }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const identifierMapping = new InMemoryIdentifierMappingAdapter();
    identifierMapping.seed({
      entityType: CORE_ENTITY_TYPE.Product,
      externalId: 'SYM-1',
      connectionId: CONNECTION_ID,
      internalId: 'ol_product_x',
    });
    const adapter = new SubiektOrderProcessorAdapter(client, identifierMapping, CONNECTION_ID, noopLogger);

    const order: OrderCreate = {
      status: 'pending',
      items: [
        { id: '1', productId: 'ol_product_x', quantity: 2, price: 19.99, sku: 'SKU-1' },
      ],
      totals: { subtotal: 39.98, tax: 0, shipping: 0, total: 39.98, currency: 'PLN' },
      billingAddress: {
        company: 'Acme Sp. z o.o.',
        taxId: '1234567890',
        address1: 'Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      orderNumber: 'OL-100',
    };

    const ref = await adapter.createOrder(order);

    expect(ref).toEqual({ orderId: '7', orderNumber: 'ZK 7/2026' });
    expect(capturedBody).toMatchObject({
      buyer: { nazwa: 'Acme Sp. z o.o.', nip: '1234567890', countryCode: 'PL' },
      // The Subiekt symbol comes from the identifier_mappings row (SYM-1),
      // NEVER from the raw order-item sku (SKU-1) — see the class docblock.
      lines: [{ symbol: 'SYM-1', ilosc: 2, wartoscBrutto: 39.98 }],
      orderRef: 'OL-100',
    });
  });

  describe('an order from a net-priced shop (#3365)', () => {
    // The shape a real PrestaShop order arrives in: line prices net, and the
    // shop's own gross figures beside them. Before this, every such order was
    // refused outright and never reached Subiekt at all.
    const netPricedOrder = (overrides: Partial<OrderCreate> = {}): OrderCreate => ({
      status: 'pending',
      items: [
        {
          id: '1',
          productId: 'ol_product_x',
          quantity: 1,
          price: 1499,
          unitPriceGross: 1843.77,
          sku: 'SKU-1',
        },
      ],
      totals: {
        subtotal: 1499,
        tax: 344.77,
        shipping: 10,
        shippingGross: 12.3,
        total: 1843.77,
        currency: 'PLN',
        taxTreatment: 'exclusive',
        totalTaxTreatment: 'inclusive',
      },
      billingAddress: {
        company: 'Acme Sp. z o.o.',
        address1: 'Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      orderNumber: 'OL-PS-1',
      ...overrides,
    });

    const buildAdapter = (
      capture: (body: unknown) => void,
    ): SubiektOrderProcessorAdapter => {
      const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
        capture(JSON.parse(init!.body as string));
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: true, data: { id: 9, numer: 'ZK 9/2026' }, error: null }),
            { status: 200 },
          ),
        );
      }) as unknown as typeof fetch;
      const identifierMapping = new InMemoryIdentifierMappingAdapter();
      identifierMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'SYM-1',
        connectionId: CONNECTION_ID,
        internalId: 'ol_product_x',
      });
      return new SubiektOrderProcessorAdapter(
        new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl }),
        identifierMapping,
        CONNECTION_ID,
        noopLogger,
      );
    };

    it('books the line and the shipping at the GROSS figures the shop reported', async () => {
      let body: unknown;
      const adapter = buildAdapter((b) => (body = b));

      await adapter.createOrder(netPricedOrder());

      expect(body).toMatchObject({
        lines: [
          // 1843.77, not 1499 - a net figure written to a gross-priced document
          // would under-record the order by one VAT rate, silently.
          { symbol: 'SYM-1', ilosc: 1, wartoscBrutto: 1843.77 },
          { symbol: '', ilosc: 1, wartoscBrutto: 12.3, nazwa: 'Dostawa' },
        ],
      });
    });

    it('still REFUSES when the shop reported no gross line price', async () => {
      const adapter = buildAdapter(() => undefined);
      const order = netPricedOrder();
      delete order.items[0].unitPriceGross;

      await expect(adapter.createOrder(order)).rejects.toThrow(/gross \(tax-inclusive\)/);
    });

    it('still REFUSES when shipping is charged with no gross shipping figure', async () => {
      const adapter = buildAdapter(() => undefined);
      const order = netPricedOrder();
      delete order.totals.shippingGross;

      await expect(adapter.createOrder(order)).rejects.toThrow(/shipping/);
    });

    it('carries core\'s own sentence rather than a second copy of the rule', async () => {
      const adapter = buildAdapter(() => undefined);
      const order = netPricedOrder();
      delete order.items[0].unitPriceGross;

      // The neutral third action value, composed in `libs/core` - proof the
      // adapter delegates instead of restating the test locally.
      await expect(adapter.createOrder(order)).rejects.toThrow(
        /cannot be recorded in the destination system/,
      );
    });
  });

  it('falls back to first/last name when no company is present', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { id: 1, numer: 'ZK 1/2026' }, error: null }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;
    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const identifierMapping = new InMemoryIdentifierMappingAdapter();
    identifierMapping.seed({
      entityType: CORE_ENTITY_TYPE.Product,
      externalId: 'SYM-2',
      connectionId: CONNECTION_ID,
      internalId: 'ol_product_x',
    });
    const adapter = new SubiektOrderProcessorAdapter(client, identifierMapping, CONNECTION_ID, noopLogger);

    const order: OrderCreate = {
      status: 'pending',
      items: [{ id: '1', productId: 'ol_product_x', quantity: 1, price: 10 }],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      shippingAddress: {
        firstName: 'Jan',
        lastName: 'Kowalski',
        address1: 'Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    };

    const ref = await adapter.createOrder(order);
    expect(ref.orderId).toBe('1');
  });

  it('throws SubiektOrderProductMappingException when a line has no mapping for this connection', async () => {
    const fetchImpl = (() => {
      throw new Error('bridge must not be called when product resolution fails');
    }) as unknown as typeof fetch;
    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const identifierMapping = new InMemoryIdentifierMappingAdapter();
    const adapter = new SubiektOrderProcessorAdapter(client, identifierMapping, CONNECTION_ID, noopLogger);

    const order: OrderCreate = {
      status: 'pending',
      items: [{ id: '1', productId: 'ol_product_unmapped', quantity: 1, price: 10 }],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    };

    await expect(adapter.createOrder(order)).rejects.toThrow(SubiektOrderProductMappingException);
  });

  it('classifies a transport failure into SubiektBridgeTransportError, not a raw unreachable error (#3369/#3373)', async () => {
    // Real fetch throw shape — code lives on `error.cause.code`, matching the
    // shared retryability classifier's read path.
    const fetchImpl = (() =>
      Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }))) as unknown as typeof fetch;
    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const identifierMapping = new InMemoryIdentifierMappingAdapter();
    identifierMapping.seed({
      entityType: CORE_ENTITY_TYPE.Product,
      externalId: 'SYM-3',
      connectionId: CONNECTION_ID,
      internalId: 'ol_product_x',
    });
    const adapter = new SubiektOrderProcessorAdapter(client, identifierMapping, CONNECTION_ID, noopLogger);

    const order: OrderCreate = {
      status: 'pending',
      items: [{ id: '1', productId: 'ol_product_x', quantity: 1, price: 10 }],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    };

    const rejection = adapter.createOrder(order);
    await expect(rejection).rejects.toBeInstanceOf(SubiektBridgeTransportError);
    // The classifier `SubiektRetryClassifierAdapter` only recognizes THIS type
    // — before the #3369 fix, the raw SubiektBridgeUnreachableWithPhaseError
    // propagated unclassified and the retry ladder's unclassified default
    // applied to an ambiguous createOrder timeout, risking a duplicate ZK.
    await rejection.catch((error: SubiektBridgeTransportError) => {
      expect(error.retryability).toBe('indeterminate');
    });
  });
  describe('status writeback carries the carrier (#3365)', () => {
    // The bridge composes a `Przewoznik:` line from this, and since the same
    // change the remarks write MERGES rather than overwrites - so a field sent
    // once survives every later status-only write instead of being erased by
    // it. Before this the adapter sent 2 of the 7 fields the bridge accepts.
    const buildAdapter = (capture: (url: string, body: unknown) => void): SubiektOrderProcessorAdapter => {
      const fetchImpl = ((url: RequestInfo | URL, init?: RequestInit) => {
        capture(String(url), init?.body ? JSON.parse(init.body as string) : undefined);
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { numer: 'ZK 7/2026' }, error: null }), {
            status: 200,
          }),
        );
      }) as unknown as typeof fetch;
      return new SubiektOrderProcessorAdapter(
        new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl }),
        new InMemoryIdentifierMappingAdapter(),
        CONNECTION_ID,
        noopLogger,
      );
    };

    it('sends the carrier alongside the status and the waybill on a dispatch', async () => {
      let body: unknown;
      const adapter = buildAdapter((_u, b) => (body = b));

      await adapter.write({
        type: 'dispatched',
        externalOrderId: '7',
        trackingNumber: '6800000001',
        carrier: { platformType: 'inpost' },
      });

      expect(body).toMatchObject({ status: 'Wysłane', trackingNumber: '6800000001', carrier: 'inpost' });
    });

    it('omits the carrier entirely when the event carries none', async () => {
      let body: Record<string, unknown> | undefined;
      const adapter = buildAdapter((_u, b) => (body = b as Record<string, unknown>));

      await adapter.write({ type: 'cancelled', externalOrderId: '7' });

      // Absent, not empty: the bridge merges blanks from what the document
      // already holds, so sending '' would be indistinguishable from "unset"
      // only by luck - and an explicit key invites a future writer to trust it.
      expect(body && 'carrier' in body).toBe(false);
    });
  });

  describe('buyer country (adr__Ewid.adr_IdPanstwo)', () => {
    const captureBuyer = async (
      country: string | undefined,
    ): Promise<Record<string, unknown>> => {
      let captured: { buyer: Record<string, unknown> } | undefined;
      const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
        captured = JSON.parse(init!.body as string) as { buyer: Record<string, unknown> };
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: true, data: { id: 9, numer: 'ZK 9/2026' }, error: null }),
            { status: 200 },
          ),
        );
      }) as unknown as typeof fetch;

      const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
      const identifierMapping = new InMemoryIdentifierMappingAdapter();
      identifierMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'SYM-1',
        connectionId: CONNECTION_ID,
        internalId: 'ol_product_x',
      });
      const adapter = new SubiektOrderProcessorAdapter(
        client,
        identifierMapping,
        CONNECTION_ID,
        noopLogger,
      );

      await adapter.createOrder({
        status: 'pending',
        items: [{ id: '1', productId: 'ol_product_x', quantity: 1, price: 10, sku: 'SKU-1' }],
        totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
        billingAddress: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          address1: 'Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: country as string,
        },
        orderNumber: 'OL-101',
      } as OrderCreate);

      return captured!.buyer;
    };

    it('sends the address country so Subiekt can tell a domestic sale from an intra-EU one', async () => {
      // Carried verbatim: the bridge resolves it against sl_Panstwo and
      // Subiekt decides what the country MEANS for VAT. OL supplies the fact,
      // never the conclusion.
      expect(await captureBuyer('DE')).toMatchObject({ countryCode: 'DE' });
    });

    it('trims surrounding whitespace rather than sending a code that resolves to nothing', async () => {
      expect(await captureBuyer('  PL  ')).toMatchObject({ countryCode: 'PL' });
    });

    it('omits the field entirely for a blank country', async () => {
      // Omitted leaves adr_IdPanstwo NULL, which is what every kontrahent OL
      // created carried before this field existed. Sending "" would make the
      // bridge run a lookup that can only fail.
      expect(await captureBuyer('   ')).not.toHaveProperty('countryCode');
    });
  });
});
