/**
 * Order edits overlay survives re-ingestion (integration, #3542, D9)
 *
 * The whole point of the overlay column: `persistOrder` rewrites `orderSnapshot`
 * wholesale on every poll and webhook, so an operator's edit is only real if a
 * later re-ingestion of the same source order cannot undo it. A unit spec can
 * show the merge is right; only the real upsert statement can show the column is
 * left alone, the stored hash and search text are kept, and the channel snapshot
 * stays the channel's own words.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { OrderRecord, ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';
import type { ApplyOrderEditInput } from '@openlinker/core/orders';

/**
 * The slice of the order-record repository this spec drives. Typed locally
 * because the repository PORT is deliberately not importable across contexts
 * (`check-cross-context-imports`); the token still resolves the real instance.
 */
interface EditsRepository {
  upsert(record: OrderRecord): Promise<OrderRecord>;
  upsertWithLineItems(record: OrderRecord, lineItems: never[]): Promise<OrderRecord>;
  applyOrderEdit(input: ApplyOrderEditInput): Promise<OrderRecord | null>;
  findById(id: string): Promise<OrderRecord | null>;
  findMany(
    filters: { search: string },
    pagination: { limit: number; offset: number }
  ): Promise<{ items: OrderRecord[] }>;
}

const SOURCE_CONNECTION = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = 'ol_order_edit_1';
const STAMP = { changeId: 'chg-1', editedAt: '2026-10-26T10:00:00.000Z', editedBy: null };

describe('order edits overlay - re-ingestion (integration, #3542)', () => {
  let harness: IntegrationTestHarness;
  let repository: EditsRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<EditsRepository>(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const channelSnapshot = (status: string): Record<string, unknown> => ({
    id: ORDER_ID,
    orderNumber: 'ALLEGRO-1',
    status,
    items: [{ id: 'l1', productId: 'p1', quantity: 3, price: 10, sku: 'SKU-1' }],
    totals: { subtotal: 30, tax: 0, shipping: 0, total: 30, currency: 'PLN' },
    shippingAddress: { firstName: 'Anna', lastName: 'Channel', address1: 'Old 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    shipping: { methodId: 'courier', methodName: 'Courier' },
  });

  function makeOrder(
    snapshot: Record<string, unknown>,
    recordStatus: 'ready' | 'awaiting_mapping' = 'ready'
  ): OrderRecord {
    const now = new Date('2026-10-26T09:00:00Z');
    return Object.assign(
      new OrderRecord(ORDER_ID, null, SOURCE_CONNECTION, null, snapshot, [], recordStatus, now, now),
      { shippingAddressHash: 'channel-hash' }
    );
  }

  async function ingestAndEdit(): Promise<void> {
    await repository.upsertWithLineItems(makeOrder(channelSnapshot('BOUGHT')), []);
    const edited = await repository.applyOrderEdit({
      internalOrderId: ORDER_ID,
      expectedRev: 0,
      address: {
        ...STAMP,
        hash: 'edited-hash',
        shipping: { firstName: 'Zofia', lastName: 'Edited', address1: 'New 9', city: 'Krakow', postalCode: '30-001', country: 'PL' },
      },
      lines: { l1: { ...STAMP, quantity: 1 } },
      deliveryMethod: { ...STAMP, methodId: 'locker', methodName: 'Locker', pickupPoint: { id: 'KRA01' } },
    });
    expect(edited).not.toBeNull();
  }

  it('should read the order as edited while the channel snapshot keeps the original', async () => {
    await ingestAndEdit();

    const record = (await repository.findById(ORDER_ID)) as OrderRecord;

    const items = record.orderSnapshot.items as Array<{ quantity: number }>;
    expect(items[0].quantity).toBe(1);
    expect((record.orderSnapshot.totals as { total: number }).total).toBe(10);
    expect((record.orderSnapshot.shippingAddress as { city: string }).city).toBe('Krakow');
    expect(record.sourceDeliveryMethodId).toBe('locker');
    expect((record.channelSnapshot.items as Array<{ quantity: number }>)[0].quantity).toBe(3);
    expect((record.channelSnapshot.shippingAddress as { city: string }).city).toBe('Warsaw');
    expect(record.isEditedInOpenLinker).toBe(true);
  });

  it('should keep the edit, the address hash and the search text through a re-ingestion of the same order', async () => {
    await ingestAndEdit();

    // The next poll: the channel reports the same order, now with a new status.
    const reingested = await repository.upsertWithLineItems(makeOrder(channelSnapshot('READY_FOR_PROCESSING')), []);

    // The upsert's own RETURNING hands ingestion the overlay that applied to it.
    expect(reingested.orderEdits?.rev).toBe(1);

    const record = (await repository.findById(ORDER_ID)) as OrderRecord;
    expect((record.orderSnapshot.items as Array<{ quantity: number }>)[0].quantity).toBe(1);
    expect((record.orderSnapshot.shippingAddress as { city: string }).city).toBe('Krakow');
    expect(record.sourceDeliveryMethodId).toBe('locker');
    // The channel's own snapshot DID move: it is what the source reported last.
    expect(record.channelSnapshot.status).toBe('READY_FOR_PROCESSING');
    expect((record.channelSnapshot.items as Array<{ quantity: number }>)[0].quantity).toBe(3);
    // The ingestion's hash is the channel's; the edited address keeps its own.
    expect(record.shippingAddressHash).toBe('edited-hash');

    const bySearch = await repository.findMany({ search: 'edited' }, { limit: 20, offset: 0 });
    expect(bySearch.items.map((o) => o.internalOrderId)).toContain(ORDER_ID);
  });

  it('should let an ordinary re-ingestion refresh the hash and text of an order with no address edit', async () => {
    await repository.upsertWithLineItems(makeOrder(channelSnapshot('BOUGHT')), []);
    await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 0, lines: { l1: { ...STAMP, quantity: 2 } } });

    await repository.upsertWithLineItems(
      Object.assign(makeOrder(channelSnapshot('BOUGHT')), { shippingAddressHash: 'newer-channel-hash' }),
      []
    );

    expect((await repository.findById(ORDER_ID))?.shippingAddressHash).toBe('newer-channel-hash');
  });

  it('should refuse a stale writer: a second edit built on rev 0 writes nothing', async () => {
    await ingestAndEdit();

    const stale = await repository.applyOrderEdit({
      internalOrderId: ORDER_ID,
      expectedRev: 0,
      lines: { l1: { ...STAMP, quantity: 0 } },
    });

    expect(stale).toBeNull();
    const record = (await repository.findById(ORDER_ID)) as OrderRecord;
    expect((record.orderSnapshot.items as Array<{ quantity: number }>)[0].quantity).toBe(1);
  });

  it('should merge a later lines edit into the first rather than replacing it', async () => {
    await repository.upsertWithLineItems(
      makeOrder({
        ...channelSnapshot('BOUGHT'),
        items: [
          { id: 'l1', productId: 'p1', quantity: 3, price: 10 },
          { id: 'l2', productId: 'p2', quantity: 2, price: 5 },
        ],
        totals: { subtotal: 40, tax: 0, shipping: 0, total: 40, currency: 'PLN' },
      }),
      []
    );
    await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 0, lines: { l1: { ...STAMP, quantity: 2 } } });
    await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 1, lines: { l2: { ...STAMP, quantity: 1 } } });

    const record = (await repository.findById(ORDER_ID)) as OrderRecord;

    expect((record.orderSnapshot.items as Array<{ id: string; quantity: number }>).map((i) => [i.id, i.quantity])).toEqual([
      ['l1', 2],
      ['l2', 1],
    ]);
    expect((record.orderSnapshot.totals as { total: number }).total).toBe(25);
    expect(record.orderEdits?.rev).toBe(2);
  });

  it('should not apply an edit to an order that is not ready, and bring it back when it is', async () => {
    await ingestAndEdit();

    await repository.upsert(makeOrder({ externalOrderId: 'ALLEGRO-1', items: [] }, 'awaiting_mapping'));
    const awaiting = (await repository.findById(ORDER_ID)) as OrderRecord;
    expect(awaiting.orderEdits).toBeNull();

    await repository.upsertWithLineItems(makeOrder(channelSnapshot('BOUGHT')), []);
    const ready = (await repository.findById(ORDER_ID)) as OrderRecord;
    expect(ready.orderEdits?.rev).toBe(1);
  });

  describe('discount (#3543)', () => {
    const discount = (amount: string, changeId: string): NonNullable<ApplyOrderEditInput['discount']> => ({
      ...STAMP,
      changeId,
      amount,
      currency: 'PLN',
      perLine: [{ orderItemId: 'l1', amount }],
    });

    const total = (record: OrderRecord): number => (record.orderSnapshot.totals as { total: number }).total;

    it('should survive a re-ingestion, and the channel keeps the price the buyer paid', async () => {
      await repository.upsertWithLineItems(makeOrder(channelSnapshot('BOUGHT')), []);
      await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 0, discount: discount('6.00', 'd1') });

      await repository.upsertWithLineItems(makeOrder(channelSnapshot('READY_FOR_PROCESSING')), []);

      const record = (await repository.findById(ORDER_ID)) as OrderRecord;
      expect(total(record)).toBe(24);
      expect((record.orderSnapshot.totals as { discountTotal?: number }).discountTotal).toBe(6);
      expect((record.orderSnapshot.items as Array<{ price: number }>)[0].price).toBe(8);
      expect((record.channelSnapshot.totals as { total: number }).total).toBe(30);
      expect((record.channelSnapshot.items as Array<{ price: number }>)[0].price).toBe(10);
      expect(record.orderEdits?.discount?.changeId).toBe('d1');
    });

    it('should replace a second discount in the database, never stack it', async () => {
      await repository.upsertWithLineItems(makeOrder(channelSnapshot('BOUGHT')), []);
      await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 0, discount: discount('6.00', 'd1') });
      await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 1, discount: discount('3.00', 'd2') });

      const record = (await repository.findById(ORDER_ID)) as OrderRecord;

      expect(total(record)).toBe(27);
      expect(record.orderEdits?.discount).toMatchObject({ changeId: 'd2', amount: '3.00' });
      expect(record.orderEdits?.rev).toBe(2);
    });

    it('should read the channel total again once the discount is set to zero, and keep the other edits', async () => {
      await repository.upsertWithLineItems(makeOrder(channelSnapshot('BOUGHT')), []);
      await repository.applyOrderEdit({
        internalOrderId: ORDER_ID,
        expectedRev: 0,
        lines: { l1: { ...STAMP, quantity: 2 } },
        discount: discount('4.00', 'd1'),
      });
      await repository.applyOrderEdit({ internalOrderId: ORDER_ID, expectedRev: 1, discount: discount('0.00', 'd2') });

      const record = (await repository.findById(ORDER_ID)) as OrderRecord;

      expect(total(record)).toBe(20);
      expect((record.orderSnapshot.items as Array<{ quantity: number }>)[0].quantity).toBe(2);
    });
  });
});
