/**
 * Erli Order Source Adapter — unit tests (#993)
 *
 * Locks the inbox-poll feed + getOrder behaviour against a mocked
 * `IErliHttpClient`: cursor advance (over ALL consumed types), the
 * ack-up-to-prior-cursor order-loss guarantee (NO ack of the current wave),
 * never-stuck empty inbox, malformed-item skip + non-array reject, per-order
 * dedupe, and getOrder composition with the #994 mapper plus its wire guard.
 *
 * Fixtures are authored from the #992-verified contract: `GET /inbox` returns a
 * top-level array of `{ id, created, type, payload }` (order id in `payload.id`),
 * ack is `POST /inbox/mark-read { lastMessageId }`, ids are lexicographically
 * sortable. The order resource uses `user`/`items`/`delivery.cod`/`totalPrice`.
 * PII is obviously-fake test data.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { isOrderStatusWriteback, type OrderFeedInput } from '@openlinker/core/orders';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import type { OfferManagerPort, OfferStockRestorer } from '@openlinker/core/listings';
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import type { IErliHttpClient } from '../../http/erli-http-client.interface';
import type { ErliHttpResponse } from '../../http/erli-http-client.types';
import type { ErliOrder } from '../erli-order.types';
import { ErliOrderSourceAdapter } from '../erli-order-source.adapter';

function ok<T>(data: T, status = 200): ErliHttpResponse<T> {
  return { status, data };
}

function makeClient(): jest.Mocked<IErliHttpClient> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
  };
}

function feedInput(overrides: Partial<OrderFeedInput> = {}): OrderFeedInput {
  return { fromCursor: null, limit: 200, ...overrides };
}

/**
 * Build a raw inbox WIRE item `{ id, created, type, payload: { id } }`. Ids are
 * fixed-width strings so lexicographic order matches chronological order (real
 * Erli ids are 24-char ObjectIds with the same property).
 */
function inboxWire(opts: { id: string; orderId: string; type?: string; created?: string }): unknown {
  return {
    id: opts.id,
    shopId: 99990,
    created: opts.created ?? '2026-06-16T10:00:00.000Z',
    read: false,
    type: opts.type ?? 'orderCreated',
    payload: { id: opts.orderId, externalOrderId: `ext-${opts.orderId}` },
  };
}

function buildErliOrder(overrides: Partial<ErliOrder> = {}): ErliOrder {
  return {
    id: 'erli-order-1',
    externalOrderId: 'ERL-1',
    status: 'purchased',
    user: { email: 'buyer-1@example.test' },
    items: [
      {
        id: 1,
        externalId: 'erli-prod-aaa',
        quantity: 2,
        unitPrice: 5000,
        name: 'Test Widget',
        sku: 'SKU-AAA',
      },
    ],
    delivery: { cod: true, price: 1000 },
    totalPrice: 11000,
    ...overrides,
  };
}

const CONNECTION_ID = 'conn-erli-1';

describe('ErliOrderSourceAdapter', () => {
  let client: jest.Mocked<IErliHttpClient>;
  let adapter: ErliOrderSourceAdapter;

  beforeEach(() => {
    client = makeClient();
    adapter = new ErliOrderSourceAdapter(CONNECTION_ID, client);
  });

  describe('listOrderFeed', () => {
    it('should map unread order events (from the top-level array) to OrderFeedItems', async () => {
      client.get.mockResolvedValue(
        ok([
          inboxWire({ id: '00000100', orderId: 'order-a', type: 'orderCreated' }),
          inboxWire({ id: '00000101', orderId: 'order-b', type: 'orderStatusChanged' }),
        ]),
      );

      const { items } = await adapter.listOrderFeed(feedInput());

      expect(items).toEqual([
        {
          externalOrderId: 'order-a',
          eventType: 'created',
          occurredAt: '2026-06-16T10:00:00.000Z',
          eventKey: '00000100',
          eventId: '00000100',
          raw: { type: 'orderCreated' },
        },
        {
          externalOrderId: 'order-b',
          eventType: 'updated',
          occurredAt: '2026-06-16T10:00:00.000Z',
          eventKey: '00000101',
          eventId: '00000101',
          raw: { type: 'orderStatusChanged' },
        },
      ]);
    });

    it('should GET /inbox with no query params (server-fixed unread cap)', async () => {
      client.get.mockResolvedValue(ok([]));

      await adapter.listOrderFeed(feedInput({ limit: 9999 }));

      expect(client.get).toHaveBeenCalledWith('/inbox');
    });

    it('should advance nextCursor to the newest new-wave message id (plain string)', async () => {
      client.get.mockResolvedValue(
        ok([
          inboxWire({ id: '00000100', orderId: 'order-a' }),
          inboxWire({ id: '00000105', orderId: 'order-b' }),
        ]),
      );

      const { nextCursor } = await adapter.listOrderFeed(feedInput());

      expect(nextCursor).toBe('00000105');
    });

    it('should NOT ack anything when fromCursor is null (no ack before enqueue)', async () => {
      client.get.mockResolvedValue(
        ok([
          inboxWire({ id: '00000100', orderId: 'order-a' }),
          inboxWire({ id: '00000101', orderId: 'order-b' }),
        ]),
      );

      await adapter.listOrderFeed(feedInput({ fromCursor: null }));

      expect(client.post).not.toHaveBeenCalled();
    });

    it('should ack the prior wave in ONE mark-read call (lastMessageId = fromCursor)', async () => {
      client.get.mockResolvedValue(
        ok([
          inboxWire({ id: '00000090', orderId: 'order-old-a' }),
          inboxWire({ id: '00000100', orderId: 'order-old-b' }),
          inboxWire({ id: '00000110', orderId: 'order-new' }),
        ]),
      );
      client.post.mockResolvedValue(ok({}, 200));

      const { items } = await adapter.listOrderFeed(feedInput({ fromCursor: '00000100' }));

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith(
        '/inbox/mark-read',
        { lastMessageId: '00000100' },
        { idempotent: true },
      );
      // Returned exactly the new-wave order event.
      expect(items.map((i) => i.externalOrderId)).toEqual(['order-new']);
    });

    it('should warn (not throw) when the mark-read ack fails', async () => {
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      client.get.mockResolvedValue(ok([inboxWire({ id: '00000090', orderId: 'order-old' })]));
      client.post.mockRejectedValue(new Error('boom'));

      await expect(
        adapter.listOrderFeed(feedInput({ fromCursor: '00000100' })),
      ).resolves.toBeDefined();

      expect(warnSpy).toHaveBeenCalled();
      // No payload/PII leaked.
      expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('order-old');
    });

    it('should keep fromCursor unchanged on an empty inbox (never stuck) and ack nothing', async () => {
      client.get.mockResolvedValue(ok([]));

      const { items, nextCursor } = await adapter.listOrderFeed(
        feedInput({ fromCursor: '00000100' }),
      );

      expect(items).toEqual([]);
      expect(nextCursor).toBe('00000100');
    });

    it('should advance the cursor past consumed non-order events (no starvation)', async () => {
      client.get.mockResolvedValue(
        ok([inboxWire({ id: '00000200', orderId: 'order-x', type: 'productsNeedSync' })]),
      );

      const { items, nextCursor } = await adapter.listOrderFeed(
        feedInput({ fromCursor: '00000100' }),
      );

      // Non-order event → no feed item, but the cursor MUST advance over it.
      expect(items).toEqual([]);
      expect(nextCursor).toBe('00000200');
    });

    it('should respect the input.eventTypes filter', async () => {
      client.get.mockResolvedValue(
        ok([
          inboxWire({ id: '00000100', orderId: 'order-a', type: 'orderCreated' }),
          inboxWire({ id: '00000101', orderId: 'order-b', type: 'orderStatusChanged' }),
        ]),
      );

      const { items } = await adapter.listOrderFeed(feedInput({ eventTypes: ['created'] }));

      expect(items.map((i) => i.externalOrderId)).toEqual(['order-a']);
    });

    it('should dedupe two messages for the same orderId, keeping the newest', async () => {
      client.get.mockResolvedValue(
        ok([
          inboxWire({ id: '00000100', orderId: 'order-a', type: 'orderCreated' }),
          inboxWire({ id: '00000105', orderId: 'order-a', type: 'orderStatusChanged' }),
        ]),
      );

      const { items, nextCursor } = await adapter.listOrderFeed(feedInput());

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        externalOrderId: 'order-a',
        eventType: 'updated',
        eventKey: '00000105',
      });
      expect(nextCursor).toBe('00000105');
    });

    it('should advance the cursor past a productsNeedSync event that carries no payload.id at all (real wire shape, #1322 manual E2E)', async () => {
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      client.get.mockResolvedValue(
        ok([{ id: '00000200', shopId: 99990, created: 'x', read: false, type: 'productsNeedSync' }]),
      );

      const { items, nextCursor } = await adapter.listOrderFeed(
        feedInput({ fromCursor: '00000100' }),
      );

      // No feed item (not an order event), but the cursor must still advance
      // over it — it must not be dropped as "malformed" just for lacking an
      // order id it was never going to carry.
      expect(items).toEqual([]);
      expect(nextCursor).toBe('00000200');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should skip a malformed inbox item (missing payload.id) and process the rest', async () => {
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      client.get.mockResolvedValue(
        ok([
          { id: '00000100', type: 'orderCreated', created: 'x', payload: {} },
          inboxWire({ id: '00000101', orderId: 'order-good', type: 'orderCreated' }),
        ]),
      );

      const { items } = await adapter.listOrderFeed(feedInput());

      expect(items.map((i) => i.externalOrderId)).toEqual(['order-good']);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('00000100'));
    });

    it('should throw ErliApiException (no PII) when the inbox body is not an array', async () => {
      client.get.mockResolvedValue(ok({ messages: [] } as unknown as unknown[]));

      await expect(adapter.listOrderFeed(feedInput())).rejects.toMatchObject({
        name: 'ErliApiException',
      });
      await expect(adapter.listOrderFeed(feedInput())).rejects.toThrow(/not an array/);
    });
  });

  describe('SourceOptionsReader (#1738)', () => {
    const DICT_PATH = 'dictionaries/deliveryMethods';
    const DETAILS_PATH = 'delivery/priceListsDetails';

    function mockDeliveryEndpoints(details: unknown, dictionary: unknown): void {
      client.get.mockImplementation((path: string) => {
        if (path === DETAILS_PATH) return Promise.resolve(ok(details));
        if (path === DICT_PATH) return Promise.resolve(ok(dictionary));
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });
    }

    it('should list the four documented Erli order statuses', async () => {
      const statuses = await adapter.listOrderStatuses();
      expect(statuses.map((s) => s.value)).toEqual([
        'pending',
        'purchased',
        'cancelled',
        'returned',
      ]);
    });

    it('should list the two derivable payment methods (online + cod)', async () => {
      const methods = await adapter.listPaymentMethods();
      expect(methods.map((m) => m.value)).toEqual(['online', 'cod']);
    });

    it('should return active price-list methods labelled from the dictionary when both endpoints respond', async () => {
      mockDeliveryEndpoints(
        [
          {
            id: 298891,
            name: 'Demo cennik',
            prices: [
              { deliveryMethod: { id: 'erliPaczkomat' } },
              { deliveryMethod: { id: 'dpd' } },
              // Duplicate across price rows — must dedupe by value.
              { deliveryMethod: { id: 'erliPaczkomat' } },
            ],
          },
        ],
        [
          { id: 'erliPaczkomat', name: 'ERLI InPost Paczkomaty 24/7', cod: false, vendor: 'inpost' },
          { id: 'dpd', name: 'Kurier DPD', cod: false, vendor: 'dpd' },
          { id: 'ups', name: 'Kurier UPS', cod: false, vendor: 'ups' },
        ],
      );

      await expect(adapter.listDeliveryMethods()).resolves.toEqual([
        { value: 'erliPaczkomat', label: 'ERLI InPost Paczkomaty 24/7' },
        { value: 'dpd', label: 'Kurier DPD' },
      ]);
    });

    it('should fall back to the raw method id when the dictionary misses it', async () => {
      mockDeliveryEndpoints(
        [{ id: 1, prices: [{ deliveryMethod: { id: 'someNewMethod' } }] }],
        [],
      );

      await expect(adapter.listDeliveryMethods()).resolves.toEqual([
        { value: 'someNewMethod', label: 'someNewMethod' },
      ]);
    });

    it('should return empty when the shop has no price lists', async () => {
      mockDeliveryEndpoints([], [{ id: 'dpd', name: 'Kurier DPD' }]);

      await expect(adapter.listDeliveryMethods()).resolves.toEqual([]);
    });

    it('should throw ErliApiException when either delivery endpoint returns a non-array body', async () => {
      mockDeliveryEndpoints({ message: 'No route' }, []);
      await expect(adapter.listDeliveryMethods()).rejects.toThrow(ErliApiException);

      mockDeliveryEndpoints([], { message: 'No route' });
      await expect(adapter.listDeliveryMethods()).rejects.toThrow(ErliApiException);
    });
  });

  describe('getOrder', () => {
    it('should fetch the order and return mapErliOrderToIncomingOrder output (#994 composition)', async () => {
      client.get.mockResolvedValue(ok(buildErliOrder()));

      const incoming = await adapter.getOrder({ externalOrderId: 'erli-order-1' });

      expect(client.get).toHaveBeenCalledWith('/orders/erli-order-1');
      expect(incoming.externalOrderId).toBe('erli-order-1');
      // Email-only identity — no buyer id (#995).
      expect(incoming.customerExternalId).toBeUndefined();
      expect(incoming.customerEmail).toBe('buyer-1@example.test');
      expect(incoming.items[0].productRef).toEqual({
        type: 'offer',
        externalId: 'erli-prod-aaa',
      });
      expect(incoming.items[0].price).toBe(50);
      expect(incoming.totals.total).toBe(110);
      expect(incoming.totals.currency).toBe('PLN');
      // Identity resolution is downstream in core (#995) — never internal ol_ ids.
      expect(JSON.stringify(incoming)).not.toMatch(/ol_[a-z]+_/);
    });

    it('should reject a malformed wire order (missing items) with a field-level ErliApiException and no PII body', async () => {
      const malformed = buildErliOrder();
      delete (malformed as { items?: unknown }).items;
      client.get.mockResolvedValue(ok(malformed));

      let caught: unknown;
      try {
        await adapter.getOrder({ externalOrderId: 'erli-order-1' });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ErliApiException);
      expect((caught as ErliApiException).message).toContain('items missing');
      expect((caught as ErliApiException).responseBody).toBeUndefined();
    });

    it('should reject when user.email is not a string', async () => {
      const malformed = buildErliOrder({ user: { email: 123 as unknown as string } });
      client.get.mockResolvedValue(ok(malformed));

      await expect(adapter.getOrder({ externalOrderId: 'erli-order-1' })).rejects.toThrow(
        /user\.email not a string/,
      );
    });

    it('should reject when delivery.cod is not a boolean', async () => {
      const malformed = buildErliOrder({ delivery: { cod: 'yes' as unknown as boolean } });
      client.get.mockResolvedValue(ok(malformed));

      await expect(adapter.getOrder({ externalOrderId: 'erli-order-1' })).rejects.toThrow(
        /delivery\.cod not a boolean/,
      );
    });

    it('should reject when a timestamp is present but not a string', async () => {
      const malformed = buildErliOrder({ purchasedAt: 123 as unknown as string });
      client.get.mockResolvedValue(ok(malformed));

      await expect(adapter.getOrder({ externalOrderId: 'erli-order-1' })).rejects.toThrow(
        /purchasedAt present but not a string/,
      );
    });

    it('should accept the returned status (added #992) and map it to refunded', async () => {
      client.get.mockResolvedValue(ok(buildErliOrder({ status: 'returned' })));

      const incoming = await adapter.getOrder({ externalOrderId: 'erli-order-1' });

      expect(incoming.status).toBe('refunded');
    });

    it('should reject when status is invalid', async () => {
      const malformed = buildErliOrder({ status: 'shipped' as unknown as ErliOrder['status'] });
      client.get.mockResolvedValue(ok(malformed));

      await expect(adapter.getOrder({ externalOrderId: 'erli-order-1' })).rejects.toThrow(
        /status invalid/,
      );
    });

    it('should propagate a 404 ErliApiException unchanged (classifier handles non-retryable)', async () => {
      const notFound = new ErliApiException('Erli order not found', 404, undefined, '/orders/missing');
      client.get.mockRejectedValue(notFound);

      await expect(adapter.getOrder({ externalOrderId: 'missing' })).rejects.toBe(notFound);
    });
  });

  describe('getOrder — derived ship-by (#1776)', () => {
    // OL-managed offer ids (match ERLI_PRODUCT_ID_PATTERN so per-offer GETs fire).
    const OFFER_A = `ol_variant_${'a'.repeat(32)}`;
    const OFFER_B = `ol_variant_${'b'.repeat(32)}`;
    const PURCHASED_AT = '2026-06-16T09:59:00.000Z'; // Tuesday

    /** Route `/orders/*` → order, `products/*` → per-offer product resource. */
    function routeGet(
      order: ErliOrder,
      productsByPath: Record<string, { dispatchTime?: { period: number; unit?: string } } | Error>,
    ): void {
      client.get.mockImplementation((url: string) => {
        if (url.startsWith('/orders')) {
          return Promise.resolve(ok(order));
        }
        // productPath is `products/<encoded id>`.
        const entry = productsByPath[url];
        if (entry instanceof Error) {
          return Promise.reject(entry);
        }
        return Promise.resolve(ok(entry ?? {}));
      });
    }

    function orderWith(items: ErliOrder['items']): ErliOrder {
      return buildErliOrder({ items, purchasedAt: PURCHASED_AT });
    }

    function line(externalId: string): ErliOrder['items'][number] {
      return { id: 1, externalId, quantity: 1, unitPrice: 5000, name: 'X', sku: 'S' };
    }

    it('should prefer the per-offer dispatchTime over the connection default and mark the window estimated', async () => {
      const adapterWithDefault = new ErliOrderSourceAdapter(
        CONNECTION_ID,
        client,
        undefined,
        undefined,
        { period: 5, unit: 'day' }, // connection default (should be overridden)
      );
      routeGet(orderWith([line(OFFER_A)]), {
        [`products/${OFFER_A}`]: { dispatchTime: { period: 2, unit: 'day' } },
      });

      const incoming = await adapterWithDefault.getOrder({ externalOrderId: 'erli-order-1' });

      // Tue 2026-06-16 + 2 working days → Thu 2026-06-18 (per-offer wins).
      expect(incoming.dispatchTime).toEqual({
        from: PURCHASED_AT,
        to: '2026-06-18T09:59:00.000Z',
        estimated: true,
      });
    });

    it('should fall back to the connection default when the per-offer read carries no dispatchTime', async () => {
      const adapterWithDefault = new ErliOrderSourceAdapter(CONNECTION_ID, client, undefined, undefined, {
        period: 2,
        unit: 'day',
      });
      routeGet(orderWith([line(OFFER_A)]), { [`products/${OFFER_A}`]: {} });

      const incoming = await adapterWithDefault.getOrder({ externalOrderId: 'erli-order-1' });

      expect(incoming.dispatchTime?.to).toBe('2026-06-18T09:59:00.000Z');
      expect(incoming.dispatchTime?.estimated).toBe(true);
    });

    it('should take the MIN (soonest) deadline across multiple lines', async () => {
      const adapterWithDefault = new ErliOrderSourceAdapter(CONNECTION_ID, client, undefined, undefined, {
        period: 5,
        unit: 'day',
      });
      routeGet(orderWith([line(OFFER_A), line(OFFER_B)]), {
        [`products/${OFFER_A}`]: { dispatchTime: { period: 4, unit: 'day' } },
        [`products/${OFFER_B}`]: { dispatchTime: { period: 1, unit: 'day' } }, // soonest
      });

      const incoming = await adapterWithDefault.getOrder({ externalOrderId: 'erli-order-1' });

      // Tue + 1 working day → Wed 2026-06-17 (the soonest line wins).
      expect(incoming.dispatchTime?.to).toBe('2026-06-17T09:59:00.000Z');
    });

    it('should degrade to the connection default when a per-offer GET fails (never fail ingestion)', async () => {
      const adapterWithDefault = new ErliOrderSourceAdapter(CONNECTION_ID, client, undefined, undefined, {
        period: 2,
        unit: 'day',
      });
      routeGet(orderWith([line(OFFER_A)]), {
        [`products/${OFFER_A}`]: new ErliApiException('boom', 500),
      });

      const incoming = await adapterWithDefault.getOrder({ externalOrderId: 'erli-order-1' });

      // GET failed → connection default (2 working days) → Thu 2026-06-18.
      expect(incoming.dispatchTime?.to).toBe('2026-06-18T09:59:00.000Z');
    });

    it('should leave dispatchTime unset when a line has no resolvable handling time (no default, no per-offer)', async () => {
      const adapterNoDefault = new ErliOrderSourceAdapter(CONNECTION_ID, client); // no default
      routeGet(orderWith([line(OFFER_A)]), { [`products/${OFFER_A}`]: {} });

      const incoming = await adapterNoDefault.getOrder({ externalOrderId: 'erli-order-1' });

      expect(incoming.dispatchTime).toBeUndefined();
    });

    it('should leave dispatchTime unset when purchasedAt is missing', async () => {
      const adapterWithDefault = new ErliOrderSourceAdapter(CONNECTION_ID, client, undefined, undefined, {
        period: 2,
        unit: 'day',
      });
      client.get.mockResolvedValue(ok(buildErliOrder({ items: [line(OFFER_A)], purchasedAt: undefined })));

      const incoming = await adapterWithDefault.getOrder({ externalOrderId: 'erli-order-1' });

      expect(incoming.dispatchTime).toBeUndefined();
    });

    it('should not fetch per-offer products for non-OL offer ids (uses connection default)', async () => {
      const adapterWithDefault = new ErliOrderSourceAdapter(CONNECTION_ID, client, undefined, undefined, {
        period: 2,
        unit: 'day',
      });
      // 'erli-prod-aaa' does not match ERLI_PRODUCT_ID_PATTERN → no product GET.
      client.get.mockResolvedValue(ok(orderWith([line('erli-prod-aaa')])));

      const incoming = await adapterWithDefault.getOrder({ externalOrderId: 'erli-order-1' });

      expect(incoming.dispatchTime?.to).toBe('2026-06-18T09:59:00.000Z');
      // Only the order path was fetched — never a products/ path.
      const productCalls = client.get.mock.calls.filter(([url]) =>
        String(url).startsWith('products/'),
      );
      expect(productCalls).toHaveLength(0);
    });
  });

  describe('write — OrderStatusWriteback (#997 Half A / #1168)', () => {
    const ORDER_ID = 'erli-order-xyz';

    // #992 release gate (#1086 review): dispatch writeback is opt-in / default OFF.
    // Enable it for the `dispatched` assertions below; restore the env after each.
    let prevGate: string | undefined;
    beforeEach(() => {
      prevGate = process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;
      process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED = 'true';
    });
    afterEach(() => {
      if (prevGate === undefined) delete process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;
      else process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED = prevGate;
    });

    it('is narrowed by isOrderStatusWriteback', () => {
      expect(isOrderStatusWriteback(adapter)).toBe(true);
    });

    // #1198: `cancelled` now triggers stock-restore instead of unconditional
    // `unsupported`. The nested describe below covers the full test matrix.
    describe('cancelled — stock-restore (#1198)', () => {
      // A valid OL internal variant id (32 lower-hex chars after the prefix).
      const OFFER_ID = 'ol_variant_aabbccdd11223344aabbccdd11223344';

      let offerManager: { restoreStockOnCancellation: jest.Mock; updateOfferQuantity: jest.Mock };
      let inventoryQuery: { getAvailabilityByVariantIds: jest.Mock };
      let wiredAdapter: ErliOrderSourceAdapter;

      beforeEach(() => {
        offerManager = {
          restoreStockOnCancellation: jest.fn().mockResolvedValue(undefined),
          updateOfferQuantity: jest.fn(),
        };
        inventoryQuery = {
          getAvailabilityByVariantIds: jest.fn().mockResolvedValue([
            { productVariantId: OFFER_ID, totalAvailable: 5, locationCount: 1 },
          ]),
        };
        wiredAdapter = new ErliOrderSourceAdapter(
          CONNECTION_ID,
          client,
          offerManager as unknown as OfferManagerPort & OfferStockRestorer,
          inventoryQuery as unknown as IInventoryQueryService,
        );
        // Happy-path order: one item whose externalId doubles as the variant id.
        client.get.mockResolvedValue(
          ok(
            buildErliOrder({
              items: [
                { id: 1, externalId: OFFER_ID, quantity: 2, unitPrice: 5000, name: 'Widget', sku: 'SKU-A' },
              ],
            }),
          ),
        );
      });

      it('should return applied and restore stock using master-authoritative quantity', async () => {
        const result = await wiredAdapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });

        expect(result.outcome).toBe('applied');
        expect(inventoryQuery.getAvailabilityByVariantIds).toHaveBeenCalledWith([OFFER_ID]);
        expect(offerManager.restoreStockOnCancellation).toHaveBeenCalledWith([
          { externalOfferId: OFFER_ID, quantity: 5 },
        ]);
      });

      it('should restore to zero when master-inventory reports zero stock', async () => {
        inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
          { productVariantId: OFFER_ID, totalAvailable: 0, locationCount: 1 },
        ]);

        await wiredAdapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });

        expect(offerManager.restoreStockOnCancellation).toHaveBeenCalledWith([
          { externalOfferId: OFFER_ID, quantity: 0 },
        ]);
      });

      it('should report rejected when the order fetch fails', async () => {
        client.get.mockRejectedValue(new ErliApiException('upstream error', 503));

        const result = await wiredAdapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });

        expect(result.outcome).toBe('rejected');
        expect(result.detail).toContain('Failed to fetch Erli order');
        expect(offerManager.restoreStockOnCancellation).not.toHaveBeenCalled();
      });

      it('should report rejected when restoreStockOnCancellation throws', async () => {
        offerManager.restoreStockOnCancellation.mockRejectedValue(new Error('write failed'));

        const result = await wiredAdapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });

        expect(result.outcome).toBe('rejected');
      });

      it('should report unsupported when the adapter is not wired (no offerManager or inventoryQuery)', async () => {
        // `adapter` from the outer beforeEach has no offerManager/inventoryQuery.
        const result = await adapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });

        expect(result.outcome).toBe('unsupported');
        expect(client.patch).not.toHaveBeenCalled();
        expect(client.post).not.toHaveBeenCalled();
      });

      it('should return applied with no-op when no items match the OL variant id pattern', async () => {
        // Items whose externalId is NOT an `ol_variant_*` ID (pre-existing Erli
        // listings not created by OL). The filter must skip them rather than
        // letting productPath throw ErliConfigException for the whole restore.
        client.get.mockResolvedValue(
          ok(
            buildErliOrder({
              items: [
                { id: 1, externalId: 'non-ol-legacy-id', quantity: 1, unitPrice: 1000, name: 'Widget', sku: 'SKU-X' },
              ],
            }),
          ),
        );

        const result = await wiredAdapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });

        expect(result.outcome).toBe('applied');
        expect(inventoryQuery.getAvailabilityByVariantIds).not.toHaveBeenCalled();
        expect(offerManager.restoreStockOnCancellation).not.toHaveBeenCalled();
      });
    });

    it('reports unsupported (no PATCH, no POST) when the #992 writeback gate is OFF by default (#1086)', async () => {
      delete process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-123',
        carrier: { platformType: 'inpost' },
      });

      expect(result.outcome).toBe('unsupported');
      expect(client.patch).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
      // The skip is signalled at warn level (not debug) so operators can tell the
      // dispatch was not propagated upstream (PR1086 review) — and carries no PII.
      const emitted = warnSpy.mock.calls.flat().join(' ');
      expect(emitted).toContain('Erli dispatch writeback skipped');
      expect(emitted).not.toContain(ORDER_ID);
      expect(emitted).not.toContain('WB-FAKE-123');
      warnSpy.mockRestore();
    });

    it('attaches the waybill when trackingNumber is present (non-Erli carrier)', async () => {
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockResolvedValue(ok(undefined, 202));

      // The real relay passes a SHIPPING-carrier hint (never 'erli').
      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-123',
        carrier: { platformType: 'inpost' },
      });

      expect(result.outcome).toBe('applied');
      // One status writeback (mark sent) via the order-status enum endpoint.
      expect(client.patch).toHaveBeenCalledTimes(1);
      expect(client.patch).toHaveBeenCalledWith(`/orders/${ORDER_ID}/status`, {
        status: 'sent',
      });
      // One external-shipment registration (array body) carrying the waybill +
      // vendor (the shipping carrier's platformType).
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith(
        '/shipping/external',
        [{ vendor: 'inpost', orderId: ORDER_ID, trackingNumber: 'WB-FAKE-123' }],
        { idempotent: true },
      );
    });

    it('omits the tracking attach when trackingNumber is absent (Erli-managed)', async () => {
      client.patch.mockResolvedValue(ok(undefined, 200));

      // Erli-managed / omp_fulfilled: relay passes trackingNumber undefined.
      const result = await adapter.write({ type: 'dispatched', externalOrderId: ORDER_ID });

      expect(result.outcome).toBe('applied');
      // Status writeback only — NO shipment registration.
      expect(client.patch).toHaveBeenCalledTimes(1);
      expect(client.patch).toHaveBeenCalledWith(`/orders/${ORDER_ID}/status`, {
        status: 'sent',
      });
      expect(client.post).not.toHaveBeenCalled();
    });

    it('treats a 409 on the status writeback as applied (idempotent)', async () => {
      client.patch.mockRejectedValue(new ErliApiException('already dispatched', 409));

      const result = await adapter.write({ type: 'dispatched', externalOrderId: ORDER_ID });

      expect(result.outcome).toBe('applied');
      expect(client.post).not.toHaveBeenCalled();
    });

    it('reports rejected on a non-409 status-writeback failure', async () => {
      client.patch.mockRejectedValue(new ErliApiException('bad request', 400));

      const result = await adapter.write({ type: 'dispatched', externalOrderId: ORDER_ID });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toBeDefined();
    });

    it('treats a 409 on the waybill attach as applied (retry convergence)', async () => {
      // Status PATCH succeeds; the waybill POST 409s (already attached from a prior
      // partial run) — must converge, not fail permanently (PR1082-TECH-03).
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockRejectedValue(new ErliApiException('shipment already attached', 409));

      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-123',
        carrier: { platformType: 'inpost' },
      });

      expect(result.outcome).toBe('applied');
    });

    it('reports rejected on a non-409 waybill-attach failure after the status writeback succeeded', async () => {
      // Partial failure: mark-dispatched landed, the attach POST fails terminally
      // — surfaces as rejected; the status writeback already happened (PR1082-TECH-04).
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockRejectedValue(new ErliApiException('bad request', 400));

      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-123',
        carrier: { platformType: 'inpost' },
      });

      expect(result.outcome).toBe('rejected');
      expect(client.patch).toHaveBeenCalledTimes(1);
    });

    it('never logs trackingNumber or externalOrderId on the success path', async () => {
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockResolvedValue(ok(undefined, 202));
      const logSpy = jest
        .spyOn((adapter as unknown as { logger: { log: () => void } }).logger, 'log')
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: () => void } }).logger, 'warn')
        .mockImplementation(() => undefined);

      await adapter.write({
        type: 'dispatched',
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-456',
        carrier: { platformType: 'dpd' },
      });

      const emitted = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
      expect(emitted).not.toContain('WB-FAKE-456');
      expect(emitted).not.toContain(ORDER_ID);
    });

    it('rejected detail carries no waybill or order id', async () => {
      client.patch.mockRejectedValue(new ErliApiException('upstream 400', 400));
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: () => void } }).logger, 'warn')
        .mockImplementation(() => undefined);

      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-789',
      });

      expect(result.outcome).toBe('rejected');
      expect(result.detail ?? '').not.toContain('WB-FAKE-789');
      expect(result.detail ?? '').not.toContain(ORDER_ID);
      const emitted = warnSpy.mock.calls.flat().join(' ');
      expect(emitted).not.toContain('WB-FAKE-789');
      expect(emitted).not.toContain(ORDER_ID);
    });
  });
});
