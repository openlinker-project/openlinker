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
});
