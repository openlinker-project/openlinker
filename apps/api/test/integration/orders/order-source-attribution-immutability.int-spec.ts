/**
 * Order Source-Attribution Immutability Int-Spec (#2282, ADR-057)
 *
 * `persistOrder` / `persistIncomingSnapshot` used to write the row through a
 * full-object TypeORM `save()`, so a re-ingestion rewrote `sourceConnectionId`
 * and `sourceEventId` along with the snapshot. The only protection was the
 * ADR-017 caller-side guard in `OrderIngestionService`; any other caller
 * reaching the write path clobbered attribution (the #940 defect class).
 *
 * The invariant now lives in the statement the repository emits, which is
 * exactly why this coverage has to be an integration test: a mocked repository
 * can only assert what was handed to it, whereas the whole point is what
 * Postgres does with `INSERT ... ON CONFLICT DO UPDATE`. The suite bypasses the
 * ADR-017 guard on purpose by calling the record service directly.
 *
 * The excluded-column regression block is the highest-risk part of the change:
 * swapping `save()` for raw SQL is exactly the shape that silently re-admits a
 * column an earlier issue removed (#2140 / #2101 / #1984 / #2100 / #2124).
 *
 * Records are read through `IOrderRecordService` and the ORM entity, never a
 * `*RepositoryPort` - importing one from `apps/api` is a deny shape in
 * `scripts/check-cross-context-imports.mjs`.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
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

const ORDER_ID = 'ol_order_attribution_test';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-ATTR-1',
    status: 'pending',
    customerId: null,
    items: [],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Order;
}

function makeIncoming(overrides: Partial<IncomingOrder> = {}): IncomingOrder {
  return {
    externalOrderId: 'ext-attr-1',
    status: 'pending',
    items: [],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: new Date('2026-08-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-08-01T00:00:00Z').toISOString(),
    ...overrides,
  } as IncomingOrder;
}

describe('Order source attribution is immutable at the write path (#2282)', () => {
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

  async function seedConnections(): Promise<{ sourceId: string; otherId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    const other = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
    });
    return { sourceId: source.id, otherId: other.id };
  }

  function recordRepo() {
    return harness.getDataSource().getRepository(OrderRecordOrmEntity);
  }

  it('records the supplied attribution on the first insert', async () => {
    const { sourceId } = await seedConnections();

    const saved = await orderRecordService.persistOrder(makeOrder(), sourceId, 'evt-1');

    expect(saved.sourceConnectionId).toBe(sourceId);
    expect(saved.sourceEventId).toBe('evt-1');

    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row!.sourceConnectionId).toBe(sourceId);
    expect(row!.sourceEventId).toBe('evt-1');
  });

  it('refreshes the snapshot and advances sourceEventId on a same-source re-ingestion', async () => {
    const { sourceId } = await seedConnections();

    await orderRecordService.persistOrder(makeOrder(), sourceId, 'evt-1');
    const saved = await orderRecordService.persistOrder(
      makeOrder({ orderNumber: 'ORD-ATTR-2', status: 'processing' }),
      sourceId,
      'evt-2',
    );

    expect(saved.sourceConnectionId).toBe(sourceId);
    // Same-source may advance: byte-identical to the pre-#2282 behaviour.
    expect(saved.sourceEventId).toBe('evt-2');
    expect(saved.orderSnapshot.orderNumber).toBe('ORD-ATTR-2');
    expect(saved.orderSnapshot.status).toBe('processing');

    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row!.sourceEventId).toBe('evt-2');
    // The jsonb column round-trips as a document, not as a string.
    expect(row!.orderSnapshot).toEqual(saved.orderSnapshot);
    expect(row!.orderSnapshot).toMatchObject({
      orderNumber: 'ORD-ATTR-2',
      status: 'processing',
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    });
  });

  it('refuses a cross-source attribution change on persistOrder, ADR-017 guard bypassed', async () => {
    const { sourceId, otherId } = await seedConnections();

    await orderRecordService.persistOrder(makeOrder(), sourceId, 'evt-1');
    const saved = await orderRecordService.persistOrder(
      makeOrder({ orderNumber: 'ORD-ECHO' }),
      otherId,
      'echo-evt',
    );

    // Both attribution fields frozen; the returned record reports the ORIGINAL
    // source, which is what lets the service warn without a second read.
    expect(saved.sourceConnectionId).toBe(sourceId);
    expect(saved.sourceEventId).toBe('evt-1');

    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row!.sourceConnectionId).toBe(sourceId);
    expect(row!.sourceEventId).toBe('evt-1');
  });

  it('refuses a cross-source attribution change on persistIncomingSnapshot too', async () => {
    const { sourceId, otherId } = await seedConnections();

    await orderRecordService.persistIncomingSnapshot(
      makeIncoming(),
      ORDER_ID,
      null,
      sourceId,
      'evt-1',
    );
    const saved = await orderRecordService.persistIncomingSnapshot(
      makeIncoming({ externalOrderId: 'ext-echo' }),
      ORDER_ID,
      null,
      otherId,
      'echo-evt',
    );

    expect(saved.sourceConnectionId).toBe(sourceId);
    expect(saved.sourceEventId).toBe('evt-1');

    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row!.sourceConnectionId).toBe(sourceId);
    expect(row!.sourceEventId).toBe('evt-1');
  });

  it('does not move createdAt on a re-ingestion, but does move updatedAt', async () => {
    const { sourceId } = await seedConnections();

    await orderRecordService.persistOrder(makeOrder(), sourceId, 'evt-1');
    const first = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await orderRecordService.persistOrder(makeOrder({ status: 'processing' }), sourceId, 'evt-2');
    const second = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });

    expect(second!.createdAt.getTime()).toBe(first!.createdAt.getTime());
    expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
  });

  it('leaves every out-of-band column untouched by a re-ingestion (#2140/#2101/#1984/#2100/#2124)', async () => {
    const { sourceId } = await seedConnections();

    await orderRecordService.persistOrder(makeOrder(), sourceId, 'evt-1');

    // Seed the excluded columns out of band, exactly as their narrow writers do.
    const cancelledAt = new Date('2026-08-02T10:00:00Z');
    const fxStampedAt = new Date('2026-08-02T11:00:00Z');
    await recordRepo().update(
      { internalOrderId: ORDER_ID },
      {
        syncStatus: [
          {
            destinationConnectionId: '22222222-2222-4222-8222-222222222222',
            status: 'synced',
            externalOrderId: 'dest-1',
          },
        ],
        syncAttempts: [
          {
            destinationConnectionId: '22222222-2222-4222-8222-222222222222',
            status: 'synced',
            attemptedAt: cancelledAt.toISOString(),
          },
        ],
        fulfillmentState: 'dispatched',
        cancelledAt,
        salesDocumentBlockReason: 'trigger-model-manual',
        salesDocumentUnresolvedReason: 'no-configuration-for-country',
        salesDocumentBlockDetail: 'seeded detail',
        reportingCurrency: 'EUR',
        reportingTotalAmount: 42.5,
        exchangeRateId: '33333333-3333-4333-8333-333333333333',
        fxRule: 'prev-business-day',
        fxStampedAt,
        fxIntendedCurrency: 'EUR',
      },
    );

    // Re-ingest. Every column above must survive the raw-SQL upsert.
    await orderRecordService.persistOrder(
      makeOrder({ status: 'processing' }),
      sourceId,
      'evt-2',
    );

    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row!.syncStatus).toHaveLength(1);
    expect(row!.syncStatus[0].externalOrderId).toBe('dest-1');
    expect(row!.syncAttempts).toHaveLength(1);
    expect(row!.fulfillmentState).toBe('dispatched');
    expect(row!.cancelledAt!.getTime()).toBe(cancelledAt.getTime());
    expect(row!.salesDocumentBlockReason).toBe('trigger-model-manual');
    expect(row!.salesDocumentUnresolvedReason).toBe('no-configuration-for-country');
    expect(row!.salesDocumentBlockDetail).toBe('seeded detail');
    expect(row!.reportingCurrency).toBe('EUR');
    expect(Number(row!.reportingTotalAmount)).toBe(42.5);
    expect(row!.exchangeRateId).toBe('33333333-3333-4333-8333-333333333333');
    expect(row!.fxRule).toBe('prev-business-day');
    expect(row!.fxStampedAt!.getTime()).toBe(fxStampedAt.getTime());
    expect(row!.fxIntendedCurrency).toBe('EUR');
    // The write set itself still landed.
    expect(row!.orderSnapshot.status).toBe('processing');

    // The other half of the contract - that `upsert()`'s OWN return reports
    // these columns empty despite `RETURNING *` carrying them - is asserted in
    // `order-record.repository.spec.ts`, not here: `persistOrder` may hand back
    // a `findById` re-read instead of the upsert return (#2125), so what this
    // path returns is deliberately not a statement about the write contract.
  });
});
