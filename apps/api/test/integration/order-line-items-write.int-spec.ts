/**
 * Order Line Items Transactional Write Integration Test (#1985 review)
 *
 * Exercises the real `OrderRecordRepository.upsertWithLineItems` — the
 * two-table transaction (`order_records` + `order_line_items`) — against
 * Testcontainers Postgres. A mocked `EntityManager` (the unit spec's
 * coverage) can only assert that `save`/`delete` were called; it cannot
 * prove the transaction actually commits both writes together, that a
 * re-ingested order with a shrunk item list leaves no stale rows, or that a
 * failure on the line-item insert rolls back the order-record write too.
 *
 * Also covers the #1985 review's blocking finding: `upsertWithLineItems` is
 * the sole writer of the four analytics scalars, and a follow-up
 * `persistIncomingSnapshot`-shaped `upsert()` call must NOT null them out.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { OrderRecord } from '@openlinker/core/orders';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const SOURCE_CONNECTION = '11111111-1111-4111-8111-111111111111';

describe('OrderRecord line-item transactional write (integration, #1985)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function findLineItems(
    orderRecordId: string
  ): Promise<Array<{ lineNumber: number; productId: string; quantity: number }>> {
    const rows: Array<{ lineNumber: number; productId: string; quantity: number }> =
      await harness.getDataSource().query(
        `SELECT "lineNumber", "productId", "quantity" FROM "order_line_items" WHERE "orderRecordId" = $1 ORDER BY "lineNumber" ASC`,
        [orderRecordId]
      );
    return rows;
  }

  function makeOrderRecord(internalOrderId: string, overrides: {
    placedAt?: Date | null;
    currency?: string | null;
    taxTreatment?: 'inclusive' | 'exclusive' | null;
    totalAmount?: number | null;
    sourceConnectionId?: string;
    sourceEventId?: string | null;
  } = {}): OrderRecord {
    return new OrderRecord(
      internalOrderId,
      null,
      overrides.sourceConnectionId ?? SOURCE_CONNECTION,
      overrides.sourceEventId ?? null,
      { id: internalOrderId, items: [] },
      [],
      'ready',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T10:00:00Z'),
      [],
      null,
      null,
      null,
      overrides.placedAt ?? new Date('2026-05-01T09:00:00Z'),
      overrides.currency ?? 'PLN',
      overrides.taxTreatment ?? 'inclusive',
      overrides.totalAmount ?? 100
    );
  }

  it('commits the order record and its line items together, and persists the four analytics scalars', async () => {
    const internalOrderId = `ol_order_fixture_${Date.now()}_1`;
    const orderRecord = makeOrderRecord(internalOrderId);

    const saved = await repository.upsertWithLineItems(orderRecord, [
      {
        lineNumber: 0,
        productId: 'ol_product_1',
        variantId: 'ol_variant_1',
        quantity: 2,
        unitPrice: 10,
        sourceConnectionId: SOURCE_CONNECTION,
        placedAt: orderRecord.placedAt,
        taxRate: null,
        taxSource: null,
        taxRateReadAt: null,
      },
      {
        lineNumber: 1,
        productId: 'ol_product_2',
        variantId: null,
        quantity: 1,
        unitPrice: 80,
        sourceConnectionId: SOURCE_CONNECTION,
        placedAt: orderRecord.placedAt,
        taxRate: null,
        taxSource: null,
        taxRateReadAt: null,
      },
    ]);

    expect(saved.placedAt).toEqual(new Date('2026-05-01T09:00:00Z'));
    expect(saved.currency).toBe('PLN');
    expect(saved.taxTreatment).toBe('inclusive');
    expect(saved.totalAmount).toBe(100);

    const found = await repository.findById(internalOrderId);
    expect(found?.placedAt).toEqual(new Date('2026-05-01T09:00:00Z'));
    expect(found?.currency).toBe('PLN');
    expect(found?.taxTreatment).toBe('inclusive');
    expect(found?.totalAmount).toBe(100);

    const lineItems = await findLineItems(internalOrderId);
    expect(lineItems).toHaveLength(2);
    expect(lineItems.map((li) => li.productId)).toEqual(['ol_product_1', 'ol_product_2']);
  });

  it('replaces the prior line-item set on re-ingestion with a shrunk item list, leaving no stale rows', async () => {
    const internalOrderId = `ol_order_fixture_${Date.now()}_2`;
    const orderRecord = makeOrderRecord(internalOrderId);

    await repository.upsertWithLineItems(orderRecord, [
      {
        lineNumber: 0,
        productId: 'ol_product_1',
        variantId: null,
        quantity: 2,
        unitPrice: 10,
        sourceConnectionId: SOURCE_CONNECTION,
        placedAt: orderRecord.placedAt,
        taxRate: null,
        taxSource: null,
        taxRateReadAt: null,
      },
      {
        lineNumber: 1,
        productId: 'ol_product_2',
        variantId: null,
        quantity: 1,
        unitPrice: 80,
        sourceConnectionId: SOURCE_CONNECTION,
        placedAt: orderRecord.placedAt,
        taxRate: null,
        taxSource: null,
        taxRateReadAt: null,
      },
    ]);

    // Re-ingested with only one line — the second must NOT survive as a stale row.
    await repository.upsertWithLineItems(orderRecord, [
      {
        lineNumber: 0,
        productId: 'ol_product_1',
        variantId: null,
        quantity: 3,
        unitPrice: 10,
        sourceConnectionId: SOURCE_CONNECTION,
        placedAt: orderRecord.placedAt,
        taxRate: null,
        taxSource: null,
        taxRateReadAt: null,
      },
    ]);

    const lineItems = await findLineItems(internalOrderId);
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]).toMatchObject({
      lineNumber: 0,
      productId: 'ol_product_1',
      quantity: 3,
    });
  });

  it('rolls back the order-record write when the line-item insert fails', async () => {
    const internalOrderId = `ol_order_fixture_${Date.now()}_3`;
    const orderRecord = makeOrderRecord(internalOrderId, { totalAmount: 42 });

    // Two drafts sharing the same lineNumber violate
    // UQ_order_line_items_order_line — the insert throws mid-transaction.
    await expect(
      repository.upsertWithLineItems(orderRecord, [
        {
          lineNumber: 0,
          productId: 'ol_product_1',
          variantId: null,
          quantity: 1,
          unitPrice: 10,
          sourceConnectionId: SOURCE_CONNECTION,
          placedAt: orderRecord.placedAt,
          taxRate: null,
          taxSource: null,
          taxRateReadAt: null,
        },
        {
          lineNumber: 0,
          productId: 'ol_product_2',
          variantId: null,
          quantity: 1,
          unitPrice: 20,
          sourceConnectionId: SOURCE_CONNECTION,
          placedAt: orderRecord.placedAt,
          taxRate: null,
          taxSource: null,
          taxRateReadAt: null,
        },
      ])
    ).rejects.toThrow();

    // Neither write survived — no order_records row, no order_line_items rows.
    const found = await repository.findById(internalOrderId);
    expect(found).toBeNull();
    const lineItems = await findLineItems(internalOrderId);
    expect(lineItems).toHaveLength(0);
  });

  it('does not null the analytics scalars when persistIncomingSnapshot-shaped upsert() runs after upsertWithLineItems (#1985 review, finding 1)', async () => {
    const internalOrderId = `ol_order_fixture_${Date.now()}_4`;
    const orderRecord = makeOrderRecord(internalOrderId, {
      placedAt: new Date('2026-05-02T08:00:00Z'),
      currency: 'EUR',
      totalAmount: 55.5,
    });

    await repository.upsertWithLineItems(orderRecord, [
      {
        lineNumber: 0,
        productId: 'ol_product_1',
        variantId: null,
        quantity: 1,
        unitPrice: 55.5,
        sourceConnectionId: SOURCE_CONNECTION,
        placedAt: orderRecord.placedAt,
        taxRate: null,
        taxSource: null,
        taxRateReadAt: null,
      },
    ]);

    // A re-poll re-enters persistIncomingSnapshot's shape: a fresh OrderRecord
    // with the four scalars at their constructor `null` default, written via
    // the plain upsert() (never upsertWithLineItems()).
    const snapshotShapedRecord = new OrderRecord(
      internalOrderId,
      null,
      SOURCE_CONNECTION,
      null,
      { id: internalOrderId, items: [] },
      [],
      'awaiting_mapping',
      new Date('2026-05-02T08:05:00Z'),
      new Date('2026-05-02T08:05:00Z')
    );
    await repository.upsert(snapshotShapedRecord);

    const found = await repository.findById(internalOrderId);
    expect(found?.placedAt).toEqual(new Date('2026-05-02T08:00:00Z'));
    expect(found?.currency).toBe('EUR');
    expect(found?.totalAmount).toBe(55.5);

    // The line item from the first ingestion also survives — upsert() never
    // touches order_line_items.
    const lineItems = await findLineItems(internalOrderId);
    expect(lineItems).toHaveLength(1);
  });

  /**
   * Source attribution (#2282 / ADR-057) must hold on EVERY write path, not
   * only on `upsert()`. `upsertWithLineItems` is the second writer of
   * `order_records`; a full-object `save()` there UPDATEs `sourceConnectionId`
   * and would silently re-attribute an order on re-ingestion from a different
   * connection. Only a real Postgres round-trip can prove the freeze — a
   * mocked `EntityManager.save` asserts nothing about the emitted SQL.
   */
  describe('source attribution freeze on upsertWithLineItems (#2282)', () => {
    const OTHER_CONNECTION = '22222222-2222-4222-8222-222222222222';

    async function readAttribution(
      internalOrderId: string
    ): Promise<{ sourceConnectionId: string; sourceEventId: string | null }> {
      const rows: Array<{ sourceConnectionId: string; sourceEventId: string | null }> =
        await harness
          .getDataSource()
          .query(
            `SELECT "sourceConnectionId", "sourceEventId" FROM "order_records" WHERE "internalOrderId" = $1`,
            [internalOrderId]
          );
      return rows[0];
    }

    const draft = (orderRecord: OrderRecord) => ({
      lineNumber: 0,
      productId: 'ol_product_1',
      variantId: null,
      quantity: 1,
      unitPrice: 10,
      sourceConnectionId: orderRecord.sourceConnectionId,
      placedAt: orderRecord.placedAt,
      taxRate: null,
      taxSource: null,
      taxRateReadAt: null,
    });

    it('leaves sourceConnectionId and sourceEventId untouched when a second write arrives from a different source', async () => {
      const internalOrderId = `ol_order_attr_${Date.now()}_1`;

      await repository.upsertWithLineItems(
        makeOrderRecord(internalOrderId, {
          sourceConnectionId: SOURCE_CONNECTION,
          sourceEventId: 'evt-first',
        }),
        [draft(makeOrderRecord(internalOrderId))]
      );

      const impostor = makeOrderRecord(internalOrderId, {
        sourceConnectionId: OTHER_CONNECTION,
        sourceEventId: 'evt-impostor',
        currency: 'EUR',
        totalAmount: 77,
      });
      await repository.upsertWithLineItems(impostor, [draft(impostor)]);

      const attribution = await readAttribution(internalOrderId);
      expect(attribution.sourceConnectionId).toBe(SOURCE_CONNECTION);
      expect(attribution.sourceEventId).toBe('evt-first');

      // The rest of the write set still lands — the freeze is narrow.
      const found = await repository.findById(internalOrderId);
      expect(found?.currency).toBe('EUR');
      expect(found?.totalAmount).toBe(77);
    });

    it("advances sourceEventId when the second write arrives from the row's own source", async () => {
      const internalOrderId = `ol_order_attr_${Date.now()}_2`;

      const first = makeOrderRecord(internalOrderId, { sourceEventId: 'evt-1' });
      await repository.upsertWithLineItems(first, [draft(first)]);

      const second = makeOrderRecord(internalOrderId, { sourceEventId: 'evt-2' });
      await repository.upsertWithLineItems(second, [draft(second)]);

      const attribution = await readAttribution(internalOrderId);
      expect(attribution.sourceConnectionId).toBe(SOURCE_CONNECTION);
      expect(attribution.sourceEventId).toBe('evt-2');
    });

    it('keeps the line-item replacement atomic with the frozen-attribution upsert', async () => {
      const internalOrderId = `ol_order_attr_${Date.now()}_3`;

      const first = makeOrderRecord(internalOrderId, { sourceEventId: 'evt-1' });
      await repository.upsertWithLineItems(first, [draft(first)]);

      // Duplicate lineNumber violates UQ_order_line_items_order_line: the
      // whole transaction — including the order_records write — rolls back,
      // so the committed attribution and item set are both unchanged.
      const second = makeOrderRecord(internalOrderId, { sourceEventId: 'evt-2' });
      await expect(
        repository.upsertWithLineItems(second, [draft(second), draft(second)])
      ).rejects.toThrow();

      const attribution = await readAttribution(internalOrderId);
      expect(attribution.sourceEventId).toBe('evt-1');
      const lineItems = await findLineItems(internalOrderId);
      expect(lineItems).toHaveLength(1);
    });
  });
});
