/**
 * Buyer Data Retention Integration Test (#4289)
 *
 * Real Postgres: the trial run writes nothing, protected orders are skipped,
 * erasing is permanent, and a re-ingestion of the same order never restores
 * the erased personal data (the whole point of the `personalDataErasedAt` guard
 * in the ingestion upsert).
 *
 * @module apps/api/test/integration
 */
import { OrderRecord } from '@openlinker/core/orders';
import {
  BUYER_DATA_RETENTION_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  eraseBuyerPersonalDataFromSnapshot,
  type IBuyerDataRetentionService,
  type OrderRecordRepositoryPort,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import {
  getTestHarness,
  type IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const PII_SNAPSHOT = {
  orderNumber: 'A-1',
  customerEmail: 'jan@example.com',
  items: [],
  shippingAddress: {
    firstName: 'Jan',
    lastName: 'Kowalski',
    address1: 'Street 1',
    city: 'Warsaw',
    postalCode: '00-001',
    country: 'PL',
  },
};

describe('Buyer data retention (integration)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;
  let service: IBuyerDataRetentionService;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
    service = harness.getApp().get<IBuyerDataRetentionService>(BUYER_DATA_RETENTION_SERVICE_TOKEN);
  });
  afterEach(async () => resetTestHarness());
  afterAll(async () => teardownTestHarness());

  const oldDate = new Date(Date.now() - 400 * 86_400_000);
  const seed = (id: string) =>
    createTestOrderRecord(harness.getDataSource(), {
      internalOrderId: id,
      sourceConnectionId: CONNECTION_ID,
      orderSnapshot: PII_SNAPSHOT,
      recordStatus: 'ready',
      placedAt: oldDate,
    });

  it('should count in the preview and write nothing', async () => {
    const order = await seed('ol_order_ret_1');
    const preview = await service.preview({
      hideAfterDays: 180,
      eraseAfterDays: 365,
      mode: 'personal-data',
    });
    expect(preview.toHide).toBe(1);
    expect(preview.toErase).toBe(1);
    expect(JSON.stringify(preview.samples)).not.toContain('Kowalski');
    const row = await harness
      .getDataSource()
      .getRepository(OrderRecordOrmEntity)
      .findOneByOrFail({ internalOrderId: order.internalOrderId });
    expect(row.hiddenAt).toBeNull();
    expect(row.personalDataErasedAt).toBeNull();
  });

  it('should skip an order with an open hold and report it as protected', async () => {
    const order = await seed('ol_order_ret_2');
    await harness
      .getDataSource()
      .query(
        `INSERT INTO order_holds ("internalOrderId", reason, "placedByService", "placedAt") VALUES ($1, 'manual', 'test', now())`,
        [order.internalOrderId]
      );
    const preview = await service.preview({
      hideAfterDays: 180,
      eraseAfterDays: 365,
      mode: 'personal-data',
    });
    expect(preview.total).toBe(0);
    expect(preview.skippedProtected).toBe(1);
    expect(preview.skippedByReason).toEqual({ openReturn: 0, hold: 1, invoicePending: 0 });
  });

  it('should count an order with a hold and an open return once, under the return', async () => {
    const order = await seed('ol_order_ret_5');
    await harness
      .getDataSource()
      .query(
        `INSERT INTO order_holds ("internalOrderId", reason, "placedByService", "placedAt") VALUES ($1, 'manual', 'test', now())`,
        [order.internalOrderId]
      );
    await harness
      .getDataSource()
      .query(
        `INSERT INTO returns (id, "sourceConnectionId", "internalOrderId", origin, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'source_ingested', now(), now())`,
        ['ol_return_x1', CONNECTION_ID, order.internalOrderId]
      );
    const preview = await service.preview({
      hideAfterDays: 180,
      eraseAfterDays: 365,
      mode: 'personal-data',
    });
    expect(preview.skippedProtected).toBe(1);
    expect(preview.skippedByReason).toEqual({ openReturn: 1, hold: 0, invoicePending: 0 });
  });

  describe('age histogram', () => {
    const OTHER_CONNECTION = '22222222-2222-4222-8222-222222222222';
    const daysAgo = (d: number): Date => new Date(Date.now() - d * 86_400_000);
    const seedAt = (id: string, days: number, connectionId = CONNECTION_ID) =>
      createTestOrderRecord(harness.getDataSource(), {
        internalOrderId: id,
        sourceConnectionId: connectionId,
        orderSnapshot: PII_SNAPSHOT,
        recordStatus: 'ready',
        placedAt: daysAgo(days),
      });

    it('should return dense buckets with the visible, hidden and erased split', async () => {
      await seedAt('ol_order_h_1', 5);
      await seedAt('ol_order_h_2', 100);
      const hidden = await seedAt('ol_order_h_3', 100);
      const erased = await seedAt('ol_order_h_4', 100);
      await harness
        .getDataSource()
        .query(`UPDATE order_records SET "hiddenAt" = now() WHERE "internalOrderId" = $1`, [
          hidden.internalOrderId,
        ]);
      await harness
        .getDataSource()
        .query(
          `UPDATE order_records SET "hiddenAt" = now(), "personalDataErasedAt" = now() WHERE "internalOrderId" = $1`,
          [erased.internalOrderId]
        );
      const result = await service.getAgeHistogram();
      expect(result.bucketUnit).toBe('month');
      expect(result.totalOrders).toBe(4);
      expect(result.buckets.map((b) => b.ageMonths)).toEqual([0, 1, 2, 3]);
      expect(result.buckets[0]).toEqual({ ageMonths: 0, visible: 1, hidden: 0, erased: 0 });
      expect(result.buckets[1]).toEqual({ ageMonths: 1, visible: 0, hidden: 0, erased: 0 });
      expect(result.buckets[3]).toEqual({ ageMonths: 3, visible: 1, hidden: 1, erased: 1 });
      expect(result.oldestPlacedAt).not.toBeNull();
    });

    it('should cap everything 120 months and older into one bucket', async () => {
      await seedAt('ol_order_h_5', 3700);
      await seedAt('ol_order_h_6', 5000);
      const result = await service.getAgeHistogram();
      expect(result.buckets).toHaveLength(121);
      expect(result.buckets[120]).toEqual({ ageMonths: 120, visible: 2, hidden: 0, erased: 0 });
    });

    it('should scope to one connection when given', async () => {
      await seedAt('ol_order_h_7', 5);
      await seedAt('ol_order_h_8', 65, OTHER_CONNECTION);
      const scoped = await service.getAgeHistogram(OTHER_CONNECTION);
      expect(scoped.totalOrders).toBe(1);
      expect(scoped.buckets.map((b) => b.ageMonths)).toEqual([0, 1, 2]);
      const all = await service.getAgeHistogram();
      expect(all.totalOrders).toBe(2);
    });
  });

  it('should keep personal data erased when the same order is ingested again', async () => {
    const order = await seed('ol_order_ret_3');
    const erased = eraseBuyerPersonalDataFromSnapshot(PII_SNAPSHOT, order.internalOrderId);
    const result = await repository.erasePersonalDataForRetention(
      [
        {
          internalOrderId: order.internalOrderId,
          orderSnapshot: erased,
          searchText: 'a-1',
          hide: true,
        },
      ],
      new Date()
    );
    expect(result.erased).toBe(1);

    const now = new Date();
    await repository.upsert(
      new OrderRecord(
        order.internalOrderId,
        null,
        CONNECTION_ID,
        null,
        { ...PII_SNAPSHOT, status: 'shipped' },
        [],
        'ready',
        now,
        now
      )
    );

    const row = await harness
      .getDataSource()
      .getRepository(OrderRecordOrmEntity)
      .findOneByOrFail({ internalOrderId: order.internalOrderId });
    const text = JSON.stringify(row.orderSnapshot);
    expect(text).not.toContain('jan@example.com');
    expect(text).not.toContain('Kowalski');
    expect((row.orderSnapshot as { status?: string }).status).toBe('shipped');
    expect(row.personalDataErasedAt).not.toBeNull();
    expect(row.hiddenAt).not.toBeNull();
  });

  it('should keep hidden orders out of the list total, the summary and the preview total alike', async () => {
    const hidden = await seed('ol_order_ret_h');
    await seed('ol_order_ret_v');
    await harness
      .getDataSource()
      .getRepository(OrderRecordOrmEntity)
      .update({ internalOrderId: hidden.internalOrderId }, { hiddenAt: new Date() });

    const list = await repository.findMany({}, { limit: 20, offset: 0 });
    const summary = await repository.countByHealth({});
    const preview = await service.preview({
      hideAfterDays: 0,
      eraseAfterDays: 0,
      mode: 'personal-data',
    });
    const shownHidden = await repository.countMany({ hidden: true });

    expect(list.total).toBe(1);
    expect(summary.total).toBe(list.total);
    expect(preview.totalOrders).toBe(list.total);
    expect(shownHidden).toBe(1);
  });
});
