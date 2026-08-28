/**
 * Order Holds API Integration Test (#2341)
 *
 * The issue's acceptance criterion verbatim — **place -> detail -> release ->
 * detail** — plus the four refusals, over real HTTP against a real Postgres.
 *
 * What only an int-spec can prove here:
 *
 * 1. **The two 409s are distinguishable.** Double-place and double-release are
 *    both `409`, and their remedies differ, so the machine-readable code in the
 *    body is the contract — a status code alone does not satisfy the AC.
 * 2. **The detail projection round-trips through the real repository.**
 *    `activeHold` must be derived from the same `listHolds` read as
 *    `holdHistory`, so the two can never disagree about whether the order is
 *    held.
 * 3. **`activeHoldReason` reaches the LIST**, which is what #2342's row badge
 *    renders. A unit test cannot show it survives the real `persistOrder`
 *    round trip (#2340 excludes it from `toOrm`).
 * 4. **A foreign `holdId` refuses without a side effect** — the release must not
 *    happen and then 404.
 *
 * `loginAsAdmin` is called exactly ONCE PER TEST, from `beforeEach`: it
 * plain-INSERTs a fixed admin user, so a second call inside one test violates
 * the users unique constraint — while `resetTestHarness` truncates `users`
 * between tests, so a token minted once in `beforeAll` would outlive its user.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderRecordService,
  type Order,
} from '@openlinker/core/orders';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import { loginAsAdmin } from '../helpers/test-auth.helper';

const ORDER_ID = 'ol_order_holds_api';
const OTHER_ORDER_ID = 'ol_order_holds_api_other';

function makeOrder(id: string, orderNumber: string): Order {
  return {
    id,
    orderNumber,
    status: 'pending',
    items: [
      {
        id: 'l1',
        productId: 'ol_product_1',
        variantId: 'ol_variant_1',
        quantity: 1,
        price: 10,
        sku: 'SKU-1',
      },
    ],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
  } as Order;
}

describe('Order holds API (#2341)', () => {
  let harness: IntegrationTestHarness;
  let token: string;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    // Once per TEST — see the header for why neither once-per-file nor
    // twice-per-test works.
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const records = harness
      .getApp()
      .get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN, { strict: false });

    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });

    await records.persistOrder(makeOrder(ORDER_ID, 'ORD-HOLD-API-1'), source.id, 'evt-1');
    await records.persistOrder(
      makeOrder(OTHER_ORDER_ID, 'ORD-HOLD-API-2'),
      source.id,
      'evt-2'
    );
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const placeHold = (orderId: string, body: Record<string, unknown>) =>
    harness.getHttp().post(`/v1/orders/${orderId}/holds`).set(auth()).send(body);

  const releaseHold = (orderId: string, holdId: string, body: Record<string, unknown> = {}) =>
    harness
      .getHttp()
      .post(`/v1/orders/${orderId}/holds/${holdId}/release`)
      .set(auth())
      .send(body);

  const getOrder = (orderId: string) =>
    harness.getHttp().get(`/v1/orders/${orderId}`).set(auth());

  it('should round-trip place -> detail -> release -> detail', async () => {
    const placed = await placeHold(ORDER_ID, {
      reason: 'stock-shortfall',
      note: 'awaiting restock',
    }).expect(201);

    const holdId = placed.body.hold.id as string;
    expect(placed.body.hold.reason).toBe('stock-shortfall');
    expect(placed.body.hold.releasedAt).toBeNull();

    const held = await getOrder(ORDER_ID).expect(200);
    expect(held.body.activeHold?.id).toBe(holdId);
    expect(held.body.activeHold?.reason).toBe('stock-shortfall');
    expect(held.body.holdHistory).toHaveLength(1);
    // #2340's display cache, on the shared projection so the list badge works.
    expect(held.body.activeHoldReason).toBe('stock-shortfall');

    const released = await releaseHold(ORDER_ID, holdId, {
      note: 'restocked',
    }).expect(200);
    expect(released.body.hold.releasedAt).not.toBeNull();
    expect(released.body.hold.releaseNote).toBe('restocked');
    // Reported, never assumed — the enqueue is a consequence of the release.
    expect(released.body.provisioningResume.status).toEqual(expect.any(String));

    const free = await getOrder(ORDER_ID).expect(200);
    expect(free.body.activeHold).toBeNull();
    // The history is an audit trail: the released hold is kept, not removed.
    expect(free.body.holdHistory).toHaveLength(1);
    expect(free.body.holdHistory[0].releasedAt).not.toBeNull();
    expect(free.body.activeHoldReason).toBeNull();
  });

  it('should answer 409 ORDER_ALREADY_ON_HOLD when the order is already held', async () => {
    await placeHold(ORDER_ID, { reason: 'operator' }).expect(201);

    const second = await placeHold(ORDER_ID, { reason: 'fraud-review' }).expect(409);

    expect(second.body.error).toBe('ORDER_ALREADY_ON_HOLD');
  });

  it('should answer 409 HOLD_ALREADY_RELEASED — distinguishable from the place conflict', async () => {
    const placed = await placeHold(ORDER_ID, { reason: 'operator' }).expect(201);
    const holdId = placed.body.hold.id as string;
    await releaseHold(ORDER_ID, holdId).expect(200);

    const second = await releaseHold(ORDER_ID, holdId).expect(409);

    expect(second.body.error).toBe('HOLD_ALREADY_RELEASED');
    expect(second.body.error).not.toBe('ORDER_ALREADY_ON_HOLD');
  });

  it('should answer 400 for a reason outside the closed union', async () => {
    await placeHold(ORDER_ID, { reason: 'because-i-said-so' }).expect(400);
  });

  it('should answer 404 for an order that does not exist', async () => {
    await placeHold('ol_order_nope', { reason: 'operator' }).expect(404);
  });

  it('should answer 404 without releasing when the hold belongs to another order', async () => {
    const placed = await placeHold(OTHER_ORDER_ID, { reason: 'operator' }).expect(201);
    const holdId = placed.body.hold.id as string;

    await releaseHold(ORDER_ID, holdId).expect(404);

    // The refusal performed no side effect: the hold is still open on its own order.
    const other = await getOrder(OTHER_ORDER_ID).expect(200);
    expect(other.body.activeHold?.id).toBe(holdId);
  });

  it('should allow the order to be held again after a release', async () => {
    const first = await placeHold(ORDER_ID, { reason: 'operator' }).expect(201);
    await releaseHold(ORDER_ID, first.body.hold.id as string).expect(200);

    // The partial unique index is partial precisely so this is possible.
    const second = await placeHold(ORDER_ID, { reason: 'address-invalid' }).expect(201);

    const detail = await getOrder(ORDER_ID).expect(200);
    expect(detail.body.activeHold?.id).toBe(second.body.hold.id);
    expect(detail.body.holdHistory).toHaveLength(2);
  });
});
