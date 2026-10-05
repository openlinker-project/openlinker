import { SubiektOrderProcessorAdapter } from '../subiekt-order-processor.adapter';
import { SubiektOrdersBridgeClient } from '../../../bridge/subiekt-orders-bridge.client';
import { SubiektOrderProductMappingException } from '../../../domain/exceptions/subiekt-order-product-mapping.exception';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektOrderKeyMissingException } from '../../../domain/exceptions/subiekt-order-key-missing.exception';
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
  // A MODEL product's `Product` external id is `model:{id}` - a grouping, not a
  // catalogue item. Sending it reaches `d.Pozycje.Dodaj("model:5")`, which
  // Sfera rejects, so an order for exactly the products this integration's
  // model support exists to introduce could not reach Subiekt at all.
  describe('a model product resolves its towar symbol through the variant', () => {
    function buildAdapter(capture: { body?: unknown }): {
      adapter: SubiektOrderProcessorAdapter;
      idMapping: InMemoryIdentifierMappingAdapter;
    } {
      const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
        capture.body = JSON.parse(init!.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: true, data: { id: 9, numer: 'ZK 9/2026' }, error: null }),
            { status: 200 },
          ),
        );
      }) as unknown as typeof fetch;
      const idMapping = new InMemoryIdentifierMappingAdapter();
      return {
        adapter: new SubiektOrderProcessorAdapter(
          new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl }),
          idMapping,
          CONNECTION_ID,
          noopLogger,
        ),
        idMapping,
      };
    }

    function modelOrder(variantId?: string): OrderCreate {
      return {
        status: 'pending',
        internalOrderId: 'ol_order_model_fixture',
        items: [
          {
            id: '1',
            productId: 'ol_product_model',
            ...(variantId ? { variantId } : {}),
            quantity: 1,
            price: 100,
            sku: 'WOBLACK100',
          },
        ],
        totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
        billingAddress: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          address1: 'ul. Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'PL',
        },
      } as unknown as OrderCreate;
    }

    it('sends the towar symbol, not the model key', async () => {
      const capture: { body?: unknown } = {};
      const { adapter, idMapping } = buildAdapter(capture);
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'model:5',
        connectionId: CONNECTION_ID,
        internalId: 'ol_product_model',
      });
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100::variant',
        connectionId: CONNECTION_ID,
        internalId: 'ol_variant_1',
      });

      await adapter.createOrder(modelOrder('ol_variant_1'));

      const lines = (capture.body as { lines: { symbol: string }[] }).lines;
      expect(lines[0].symbol).toBe('WOBLACK100');
      expect(lines[0].symbol).not.toContain('model:');
    });

    // An install whose variants predate the identity fix carries the bare key.
    it('accepts a legacy bare variant key too', async () => {
      const capture: { body?: unknown } = {};
      const { adapter, idMapping } = buildAdapter(capture);
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'model:5',
        connectionId: CONNECTION_ID,
        internalId: 'ol_product_model',
      });
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100',
        connectionId: CONNECTION_ID,
        internalId: 'ol_variant_1',
      });

      await adapter.createOrder(modelOrder('ol_variant_1'));

      expect((capture.body as { lines: { symbol: string }[] }).lines[0].symbol).toBe(
        'WOBLACK100',
      );
    });

    // Refusing beats sending a symbol-less line: Subiekt would take it as a
    // one-off service position that no warehouse document can release.
    it('refuses when neither the product nor a variant names a towar', async () => {
      const capture: { body?: unknown } = {};
      const { adapter, idMapping } = buildAdapter(capture);
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'model:5',
        connectionId: CONNECTION_ID,
        internalId: 'ol_product_model',
      });

      await expect(adapter.createOrder(modelOrder())).rejects.toBeInstanceOf(
        SubiektOrderProductMappingException,
      );
      expect(capture.body).toBeUndefined();
    });
  });

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
      internalOrderId: 'ol_order_fixture',
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
      internalOrderId: 'ol_order_fixture',
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

  /**
   * The buyer's IDENTITY reaches the bridge (#3365).
   *
   * Subiekt identifies a customer card by a symbol the bridge derives from the
   * buyer's NAME, so two unrelated people called Jan Kowalski, neither carrying
   * a NIP, resolved to ONE kontrahent - and the second one's document was
   * billed to the first one's card, silently. `customerId` is the identity the
   * name never was, and it was already ON the command and simply not read.
   */
  describe('the OpenLinker customer id (kontrahent identity)', () => {
    const captureBuyer = async (
      customerId: string | undefined,
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
        customerId: customerId as string,
        items: [{ id: '1', productId: 'ol_product_x', quantity: 1, price: 10, sku: 'SKU-1' }],
        totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
        billingAddress: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          address1: 'Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
        },
        orderNumber: 'OL-101',
      } as OrderCreate);

      return captured!.buyer;
    };

    it('travels to the bridge, so two buyers of one name are two kontrahenci', async () => {
      expect(await captureBuyer('ol_customer_fce2df4d853f4499b955a6bb1a212bd1')).toMatchObject({
        olBuyerId: 'ol_customer_fce2df4d853f4499b955a6bb1a212bd1',
      });
    });

    it('is OMITTED, never blank, when the order carries none', async () => {
      // A source exposing neither a buyer id nor an e-mail yields no customer
      // id at all, and such an order must resolve by exactly the rule it did
      // before this field existed. An empty string is not an identity, and the
      // bridge has to be able to tell "no id" from "an id that is nothing".
      expect(await captureBuyer(undefined)).not.toHaveProperty('olBuyerId');
      expect(await captureBuyer('   ')).not.toHaveProperty('olBuyerId');
    });

    it('is trimmed rather than sent with whitespace that would never match back', async () => {
      // It is compared for exact equality bridge-side, so a padded value would
      // match nothing on the next order and mint a duplicate card every time.
      expect(await captureBuyer('  ol_customer_abc  ')).toMatchObject({
        olBuyerId: 'ol_customer_abc',
      });
    });
  });
});

/**
 * An order-level discount reaching the ZK (#3365 audit).
 *
 * Allegro moves `summary.totalToPay` and leaves every line price untouched, so
 * OpenLinker infers `discountTotal` as the residual - and this adapter ignored
 * it entirely. The ZK was written at the UNDISCOUNTED sum: a coupon sale
 * recorded in the ERP for more money than changed hands, with the order reading
 * `synced` and the document looking normal.
 */
describe('SubiektOrderProcessorAdapter — an order-level discount', () => {
  interface SentLine {
    wartoscBrutto: number;
    wartoscBruttoPoRabacie?: number;
  }

  async function sendOrder(
    totals: OrderCreate['totals'],
    items: OrderCreate['items'],
    logger = noopLogger,
  ): Promise<SentLine[]> {
    let captured: { lines: SentLine[] } | undefined;
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string) as { lines: SentLine[] };
      return Promise.resolve(
        new Response(
          JSON.stringify({ success: true, data: { id: 9, numer: 'ZK 9/2026' }, error: null }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const identifierMapping = new InMemoryIdentifierMappingAdapter();
    for (const item of items) {
      identifierMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: `SYM-${item.productId}`,
        connectionId: CONNECTION_ID,
        internalId: item.productId,
      });
    }
    const adapter = new SubiektOrderProcessorAdapter(
      client,
      identifierMapping,
      CONNECTION_ID,
      logger,
    );
    await adapter.createOrder({
      status: 'pending',
      // Required since #3365: a create with no order key is refused, because
      // the bridge cannot serialize or dedupe it. `OrderSyncService` always
      // populates this, so a fixture without it is not a shape the product
      // produces.
      internalOrderId: 'ol_order_fixture',
      items,
      totals,
      billingAddress: {
        address1: 'Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
        firstName: 'Jan',
        lastName: 'Kowalski',
      },
    } as OrderCreate);
    return captured!.lines;
  }

  it('bills each line at what the buyer paid, summing to the order total', async () => {
    const lines = await sendOrder(
      {
        subtotal: 150,
        tax: 0,
        shipping: 0,
        total: 130,
        currency: 'PLN',
        taxTreatment: 'inclusive',
        discountTotal: 20,
      },
      [
        { id: 'l1', productId: 'ol_product_1', quantity: 1, price: 100, unitPriceGross: 100 },
        { id: 'l2', productId: 'ol_product_2', quantity: 1, price: 50, unitPriceGross: 50 },
      ] as OrderCreate['items'],
    );

    const paid = lines.reduce(
      (sum, line) => sum + (line.wartoscBruttoPoRabacie ?? line.wartoscBrutto),
      0,
    );
    expect(Math.round(paid * 100)).toBe(Math.round(130 * 100));
    // The listed amounts survive untouched - Subiekt records both halves.
    expect(lines.map((l) => l.wartoscBrutto)).toEqual([100, 50]);
  });

  // No discount must be byte-identical to the pre-#3365 request: the field is
  // absent, and the bridge writes one number into both Subiekt amounts.
  it('sends no after-discount amount when the order carries no discount', async () => {
    const lines = await sendOrder(
      { subtotal: 200, tax: 0, shipping: 0, total: 200, currency: 'PLN', taxTreatment: 'inclusive' },
      [
        { id: 'l1', productId: 'ol_product_1', quantity: 2, price: 100, unitPriceGross: 100 },
      ] as OrderCreate['items'],
    );
    expect(lines[0].wartoscBruttoPoRabacie).toBeUndefined();
    expect(lines[0].wartoscBrutto).toBe(200);
  });

  // A discount the split refuses - here as large as the whole order - bills the
  // lines as listed, the pre-existing behaviour, and says so, because that is
  // the case where the ZK is about to be wrong.
  it('warns rather than passing over an undistributable discount', async () => {
    const logger = { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const lines = await sendOrder(
      {
        subtotal: 100,
        tax: 0,
        shipping: 0,
        total: 0,
        currency: 'PLN',
        taxTreatment: 'inclusive',
        discountTotal: 100,
      },
      [
        { id: 'l1', productId: 'ol_product_1', quantity: 1, price: 100, unitPriceGross: 100 },
      ] as OrderCreate['items'],
      logger,
    );
    expect(lines[0].wartoscBruttoPoRabacie).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('subiekt_order_discount_not_distributable'),
    );
  });

  // The bridge serializes its check-then-create on `orderRef` AND looks up an
  // already-created ZK by it - an exact match on `dok_NrPelnyOryg` with no
  // scoping of any kind. So the key has to be GLOBALLY unique, and it has to
  // exist.
  //
  // It used to be the source's own order number, which is unique only within
  // one shop, and before that it fell back to `''` when the source reported
  // none at all. Erli sets no `orderNumber` anywhere in its package, so both
  // failures were reachable from a shipped marketplace.
  describe('the order key the bridge dedupes on (#3365)', () => {
    function keylessAdapterOrder(overrides: Partial<OrderCreate>): OrderCreate {
      return {
        status: 'pending',
        items: [{ id: '1', productId: 'ol_product_x', quantity: 1, price: 10, sku: 'SKU-1' }],
        totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
        billingAddress: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          address1: 'ul. Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'PL',
        },
        ...overrides,
      };
    }

    function build(capture: { body?: unknown }): SubiektOrderProcessorAdapter {
      const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
        capture.body = JSON.parse(init!.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: true, data: { id: 3, numer: 'ZK 3/2026' }, error: null }),
            { status: 200 },
          ),
        );
      }) as unknown as typeof fetch;
      const idMapping = new InMemoryIdentifierMappingAdapter();
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'SYM-1',
        connectionId: CONNECTION_ID,
        internalId: 'ol_product_x',
      });
      return new SubiektOrderProcessorAdapter(
        new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl }),
        idMapping,
        CONNECTION_ID,
        noopLogger,
      );
    }

    it('keys on the INTERNAL order id even when the source reported a number', async () => {
      // A source order number is per-shop sequential everywhere but Allegro, so
      // two shops' order 1001 reaching one Subiekt made the second sale receive
      // the first one's ZK - and OpenLinker recorded that as a success.
      const capture: { body?: unknown } = {};
      await build(capture).createOrder(
        keylessAdapterOrder({ orderNumber: '1001', internalOrderId: 'ol_order_abc123' }),
      );
      expect(capture.body).toMatchObject({ orderRef: 'ol_order_abc123' });
    });

    it('carries the source number as the legacy key, for a create mid-retry across the deploy', async () => {
      const capture: { body?: unknown } = {};
      await build(capture).createOrder(
        keylessAdapterOrder({ orderNumber: '1001', internalOrderId: 'ol_order_abc123' }),
      );
      expect(capture.body).toMatchObject({ legacyOrderRef: '1001' });
    });

    it('omits the legacy key when there is no separate source number to probe', async () => {
      // Sending one equal to `orderRef` would make the bridge run its verified
      // probe against the key it just missed on - work that cannot succeed.
      const capture: { body?: unknown } = {};
      await build(capture).createOrder(
        keylessAdapterOrder({ internalOrderId: 'ol_order_abc123' }),
      );
      expect(capture.body).toMatchObject({ orderRef: 'ol_order_abc123' });
      expect(capture.body as Record<string, unknown>).not.toHaveProperty('legacyOrderRef');
    });

    it('shows the operator their own order number, since the key no longer does', async () => {
      // `dok_NrPelnyOryg` now holds an internal id, so the source's number has
      // to be somewhere an operator looks - and it LEADS, rather than trailing
      // an explanation.
      const capture: { body?: unknown } = {};
      await build(capture).createOrder(
        keylessAdapterOrder({ orderNumber: '1001', internalOrderId: 'ol_order_abc123' }),
      );
      expect((capture.body as { uwagi?: string }).uwagi).toBe('1001 (OpenLinker ol_order_abc123)');
    });

    it('REFUSES rather than creating when neither is present', async () => {
      // A missing document is recoverable by the operator; two sales orders for
      // one sale are two real documents in somebody's books.
      const capture: { body?: unknown } = {};
      await expect(build(capture).createOrder(keylessAdapterOrder({}))).rejects.toBeInstanceOf(
        SubiektOrderKeyMissingException,
      );
      expect(capture.body).toBeUndefined();
    });
  });
});
