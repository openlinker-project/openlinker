/**
 * Order source-amendment fact Int-Spec (#2283)
 *
 * The value here is the DB-level guarantee, not mock choreography. Every
 * property under test is a property of the STATEMENT Postgres runs, or of the
 * ingestion upsert running against a real row, and none is observable against a
 * mocked repository:
 *
 *  - the `IS DISTINCT FROM` no-op guard, and specifically that it compares ONLY
 *    `lastAmendmentChanges` — a guard that also compared `lastAmendedAt` would
 *    be defeated by the fresh timestamp every call carries and would bump
 *    `updatedAt` on writes that changed nothing,
 *  - the `toOrm` exclusion, provable only by writing the fact out of band and
 *    then re-running the ingestion upsert against a real row. That is the
 *    highest-risk regression shape here: #2140 / #2101 / #1984 / #2100 / #2124 /
 *    #2287 each had to remove a column an earlier issue re-admitted, and this
 *    column is the sharpest case — the write is TRIGGERED by an ingestion, so a
 *    re-admitted mapping would have the detecting poll erase its own finding,
 *  - and the PII discipline: the persisted jsonb must carry no raw address value
 *    under `OL_STORE_PII=false`.
 *
 * Records are read through `IOrderRecordService` and the ORM entity, never a
 * `*RepositoryPort` — importing one from `apps/api` is a deny shape in
 * `scripts/check-cross-context-imports.mjs`.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
  diffOrderAmendment,
  type IOrderRecordService,
  type IncomingOrder,
  type Order,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

const ORDER_ID = 'ol_order_amend_test';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-AMEND-1',
    status: 'pending',
    customerId: null,
    items: [
      {
        id: 'l1',
        productId: 'ol_product_1',
        variantId: 'ol_variant_1',
        quantity: 2,
        price: 10,
        sku: 'SKU-1',
      },
    ],
    totals: { subtotal: 20, tax: 0, shipping: 0, total: 20, currency: 'PLN' },
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Nowak',
      address1: 'ul. Kwiatowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Order;
}

function makeIncoming(overrides: Partial<IncomingOrder> = {}): IncomingOrder {
  return {
    externalOrderId: 'EXT-AMEND-1',
    orderNumber: 'ORD-AMEND-1',
    status: 'pending',
    items: [
      {
        id: 'l1',
        productRef: { type: 'offer', externalId: 'offer-l1' },
        quantity: 1,
        price: 10,
        sku: 'SKU-1',
      },
    ],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    ...overrides,
  } as IncomingOrder;
}

describe('Order source-amendment fact (#2283)', () => {
  let harness: IntegrationTestHarness;
  let orderRecordService: IOrderRecordService;

  beforeAll(async () => {
    harness = await getTestHarness();
    orderRecordService = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function recordRepo() {
    return harness.getDataSource().getRepository(OrderRecordOrmEntity);
  }

  async function seedOrder(): Promise<string> {
    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    await orderRecordService.persistOrder(makeOrder(), source.id, 'evt-1');
    return source.id;
  }

  async function readRow(): Promise<OrderRecordOrmEntity> {
    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row).not.toBeNull();
    return row as OrderRecordOrmEntity;
  }

  it('writes the quantity change a re-ingestion diff observes, and suppresses an identical re-write', async () => {
    await seedOrder();

    const stored = await readRow();
    const changes = diffOrderAmendment(stored.orderSnapshot, makeIncoming(), { storePii: true });
    expect(changes).toEqual([
      {
        kind: 'line-quantity-changed',
        lineId: 'l1',
        sku: 'SKU-1',
        fromQuantity: 2,
        toQuantity: 1,
      },
    ]);

    await orderRecordService.recordAmendment(
      ORDER_ID,
      new Date('2026-08-02T09:00:00Z'),
      changes,
    );

    const afterFirst = await readRow();
    expect(afterFirst.lastAmendedAt).toEqual(new Date('2026-08-02T09:00:00Z'));
    expect(afterFirst.lastAmendmentChanges).toEqual(changes);

    // The no-op guard: an identical re-write must touch nothing — neither the
    // instant nor `updatedAt`. A guard that also compared `lastAmendedAt` would
    // fail here, because the second call carries a later instant.
    await orderRecordService.recordAmendment(
      ORDER_ID,
      new Date('2026-08-02T10:00:00Z'),
      changes,
    );

    const afterSecond = await readRow();
    expect(afterSecond.lastAmendedAt).toEqual(afterFirst.lastAmendedAt);
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);

    // A genuinely different change list IS last-write-wins.
    const removal = [{ kind: 'line-removed' as const, lineId: 'l1', fromQuantity: 1 }];
    await orderRecordService.recordAmendment(
      ORDER_ID,
      new Date('2026-08-02T11:00:00Z'),
      removal,
    );
    const afterThird = await readRow();
    expect(afterThird.lastAmendedAt).toEqual(new Date('2026-08-02T11:00:00Z'));
    expect(afterThird.lastAmendmentChanges).toEqual(removal);
  });

  it('survives the ingestion upsert — the re-poll that detects the amendment cannot erase it', async () => {
    const sourceId = await seedOrder();
    const changes = [
      { kind: 'line-quantity-changed' as const, lineId: 'l1', fromQuantity: 2, toQuantity: 1 },
    ];
    await orderRecordService.recordAmendment(
      ORDER_ID,
      new Date('2026-08-02T09:00:00Z'),
      changes,
    );

    // Exactly what the ingestion path does next, on the same tick.
    await orderRecordService.persistIncomingSnapshot(makeIncoming(), ORDER_ID, null, sourceId, 'evt-2');
    await orderRecordService.persistOrder(makeOrder({ status: 'processing' }), sourceId, 'evt-2');

    const row = await readRow();
    expect(row.lastAmendedAt).toEqual(new Date('2026-08-02T09:00:00Z'));
    expect(row.lastAmendmentChanges).toEqual(changes);
  });

  it('is a silent no-op for an order that does not exist', async () => {
    await expect(
      orderRecordService.recordAmendment('ol_order_missing', new Date(), [
        { kind: 'line-removed', lineId: 'l1' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('stores no raw address value when PII storage is off', async () => {
    const previous = process.env.OL_STORE_PII;
    process.env.OL_STORE_PII = 'false';
    try {
      const sourceId = await seedOrder();
      const stored = await readRow();

      const amendedIncoming = makeIncoming({
        shippingAddress: {
          firstName: 'Anna',
          lastName: 'Nowak',
          address1: 'ul. Kwiatowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'DE',
        },
      });
      const changes = diffOrderAmendment(stored.orderSnapshot, amendedIncoming, {
        storePii: false,
      });

      // Only the country is observable in hash-only mode — the documented cost
      // of comparing like with like rather than raw-against-redacted.
      expect(changes).toContainEqual({
        kind: 'shipping-address-changed',
        fields: ['country'],
      });

      await orderRecordService.recordAmendment(ORDER_ID, new Date(), changes);

      const row = await readRow();
      const persisted = JSON.stringify(row.lastAmendmentChanges);
      for (const value of ['Anna', 'Nowak', 'Kwiatowa', 'Warszawa', '00-001']) {
        expect(persisted).not.toContain(value);
      }
      expect(sourceId).toBeTruthy();
    } finally {
      if (previous === undefined) {
        delete process.env.OL_STORE_PII;
      } else {
        process.env.OL_STORE_PII = previous;
      }
    }
  });
});
