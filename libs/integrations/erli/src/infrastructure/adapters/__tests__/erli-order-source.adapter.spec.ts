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
import { isOrderDispatchNotifier, type OrderFeedInput } from '@openlinker/core/orders';
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliOrderDispatchRejectedException } from '../../../domain/exceptions/erli-order-dispatch-rejected.exception';
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
        type: 'variant',
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

  describe('notifyDispatched (#997 Half A — OrderDispatchNotifier)', () => {
    const ORDER_ID = 'erli-order-xyz';

    // #992 release gate (#1086 review): dispatch writeback is opt-in / default OFF.
    // Enable it for the writeback assertions below; restore the env after each.
    let prevGate: string | undefined;
    beforeEach(() => {
      prevGate = process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;
      process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED = 'true';
    });
    afterEach(() => {
      if (prevGate === undefined) delete process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;
      else process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED = prevGate;
    });

    it('is narrowed by isOrderDispatchNotifier', () => {
      expect(isOrderDispatchNotifier(adapter)).toBe(true);
    });

    it('no-ops (no PATCH, no POST) when the #992 writeback gate is OFF by default (#1086)', async () => {
      delete process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;

      await adapter.notifyDispatched({
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-123',
        carrier: { platformType: 'inpost' },
      });

      expect(client.patch).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('attaches the waybill when trackingNumber is present (non-Erli carrier)', async () => {
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockResolvedValue(ok(undefined, 202));

      // The real orchestration passes a SHIPPING-carrier hint (never 'erli').
      await adapter.notifyDispatched({
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-123',
        carrier: { platformType: 'inpost' },
      });

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

      // Erli-managed / omp_fulfilled: orchestration passes trackingNumber undefined.
      await adapter.notifyDispatched({ externalOrderId: ORDER_ID });

      // Status writeback only — NO shipment registration.
      expect(client.patch).toHaveBeenCalledTimes(1);
      expect(client.patch).toHaveBeenCalledWith(`/orders/${ORDER_ID}/status`, {
        status: 'sent',
      });
      expect(client.post).not.toHaveBeenCalled();
    });

    it('treats a 409 on the status writeback as success (idempotent)', async () => {
      client.patch.mockRejectedValue(new ErliApiException('already dispatched', 409));

      await expect(adapter.notifyDispatched({ externalOrderId: ORDER_ID })).resolves.toBeUndefined();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('wraps a non-409 status-writeback failure in ErliOrderDispatchRejectedException', async () => {
      client.patch.mockRejectedValue(new ErliApiException('bad request', 400));

      await expect(adapter.notifyDispatched({ externalOrderId: ORDER_ID })).rejects.toBeInstanceOf(
        ErliOrderDispatchRejectedException,
      );
    });

    it('treats a 409 on the waybill attach as success (retry convergence)', async () => {
      // Status PATCH succeeds; the waybill POST 409s (already attached from a prior
      // partial run) — must converge, not fail permanently (PR1082-TECH-03).
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockRejectedValue(new ErliApiException('shipment already attached', 409));

      await expect(
        adapter.notifyDispatched({
          externalOrderId: ORDER_ID,
          trackingNumber: 'WB-FAKE-123',
          carrier: { platformType: 'inpost' },
        }),
      ).resolves.toBeUndefined();
    });

    it('wraps a non-409 waybill-attach failure after the status writeback succeeded', async () => {
      // Partial failure: mark-dispatched landed, the attach POST fails terminally
      // — surfaces as a rejection; the status writeback already happened (PR1082-TECH-04).
      client.patch.mockResolvedValue(ok(undefined, 200));
      client.post.mockRejectedValue(new ErliApiException('bad request', 400));

      await expect(
        adapter.notifyDispatched({
          externalOrderId: ORDER_ID,
          trackingNumber: 'WB-FAKE-123',
          carrier: { platformType: 'inpost' },
        }),
      ).rejects.toBeInstanceOf(ErliOrderDispatchRejectedException);
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

      await adapter.notifyDispatched({
        externalOrderId: ORDER_ID,
        trackingNumber: 'WB-FAKE-456',
        carrier: { platformType: 'dpd' },
      });

      const emitted = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
      expect(emitted).not.toContain('WB-FAKE-456');
      expect(emitted).not.toContain(ORDER_ID);
    });

    it('error rejection message carries no waybill or order id', async () => {
      client.patch.mockRejectedValue(new ErliApiException('upstream 400', 400));

      let caught: unknown;
      try {
        await adapter.notifyDispatched({
          externalOrderId: ORDER_ID,
          trackingNumber: 'WB-FAKE-789',
        });
      } catch (e) {
        caught = e;
      }
      const message = (caught as Error).message;
      expect(message).not.toContain('WB-FAKE-789');
      expect(message).not.toContain(ORDER_ID);
    });
  });
});
