/**
 * Empik Orders Vertical-Slice Integration Test (#4275)
 *
 * Runs Empik order ingestion end to end through the REAL
 * `MiraklOrderSourceAdapter` (acceptance, feed windows, mapper) over an
 * in-memory Mirakl order API, the production adapter-resolution seam, the REAL
 * `OrderIngestionService` and `OrderRecord` persistence, and real Postgres and
 * Redis.
 *
 * The order shape follows the Mirakl Seller API spec and the Empik staging
 * configuration (additional fields `nip`, `customer-email`,
 * `delivery-point-name`); no real Empik order has been placed on staging yet,
 * so this is the fixture to update when one is. All buyer data is synthetic.
 *
 * @module apps/api/test/integration/empik
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  type IOrderIngestionService,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { SYNC_JOB_QUEUE_TOKEN, type SyncJobQueuePort } from '@openlinker/core/sync';
import { MiraklApiException } from '@openlinker/integrations-mirakl';
import type { MiraklOrder } from '@openlinker/integrations-mirakl/domain/types/mirakl-order.types';
import {
  buildMiraklOrder,
  buildMiraklOrderLine,
} from '@openlinker/integrations-mirakl/infrastructure/adapters/__tests__/mirakl-order.fixture';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  EMPIK_ORDER_SOURCE_TEST_ADAPTER_KEY,
  EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE,
  installEmpikOrderSourceHarness,
  type EmpikOrderSourceHarness,
} from '../helpers/empik-test-order-source.helper';

const CURSOR_KEY = 'empik.orders.lastUpdateDate';
const OFFER_SKU = 'EMPIK-SKU-1';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** A new Empik order waiting for the seller to accept it. */
function waitingOrder(orderId: string, overrides: Partial<MiraklOrder> = {}): MiraklOrder {
  return buildMiraklOrder({
    order_id: orderId,
    order_state: 'WAITING_ACCEPTANCE',
    created_date: minutesAgo(10),
    last_updated_date: minutesAgo(10),
    order_lines: [
      buildMiraklOrderLine({
        order_line_id: `${orderId}-1`,
        order_line_state: 'WAITING_ACCEPTANCE',
        offer_sku: OFFER_SKU,
      }),
    ],
    ...overrides,
  });
}

describe('Empik Orders Vertical Slice Integration (#4275)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let empik: EmpikOrderSourceHarness;
  let connectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    empik = installEmpikOrderSourceHarness(harness);
  });

  afterEach(async () => {
    empik.fake.reset();
    jest.restoreAllMocks();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function ingestion(): IOrderIngestionService {
    return harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
  }

  function identifierMapping(): IIdentifierMappingService {
    return harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
  }

  function poll(): ReturnType<IOrderIngestionService['ingestOrders']> {
    return ingestion().ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 200 });
  }

  /** Product, variant and the `Offer` mapping keyed by the shop SKU. */
  async function seedOfferMapping(): Promise<void> {
    const productId = `ol_product_${randomUUID().replace(/-/g, '')}`;
    const variantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
    await dataSource.query(
      `INSERT INTO products (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`,
      [productId, 'Empik Test Product'],
    );
    await dataSource.query(
      `INSERT INTO product_variants (id, "productId", attributes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3::jsonb, now(), now())`,
      [variantId, productId, JSON.stringify({})],
    );
    await identifierMapping().createMapping(CORE_ENTITY_TYPE.Offer, OFFER_SKU, connectionId, variantId);
  }

  async function findOrderRecord(externalOrderId: string): Promise<OrderRecordOrmEntity | null> {
    const internalOrderId = await identifierMapping().getInternalId(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connectionId,
    );
    return internalOrderId
      ? dataSource.getRepository(OrderRecordOrmEntity).findOne({ where: { internalOrderId } })
      : null;
  }

  it('E1: accepts a waiting order on the poll and ingests it with lines, VAT, delivery, payment and NIP', async () => {
    connectionId = await seedEmpikConnection(dataSource, {});
    await seedOfferMapping();
    empik.fake.putOrder(waitingOrder('E1-A'));

    const result = await poll();

    expect(empik.fake.callsOf('PUT')).toEqual([
      expect.objectContaining({
        path: '/api/orders/E1-A/accept',
        body: { order_lines: [{ id: 'E1-A-1', accepted: true }] },
      }),
    ]);
    expect(result).toMatchObject({ fetched: 1, enqueued: 1, committed: true });

    await ingestion().syncOrderFromSource(connectionId, 'E1-A');

    const record = await findOrderRecord('E1-A');
    expect(record?.recordStatus).toBe('ready');
    const snapshot = record!.orderSnapshot as unknown as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      status: 'processing',
      paymentStatus: 'paid',
      paymentMethod: 'online',
      shipping: { methodId: 'PACKSTATION', methodName: 'Paczkomaty InPost' },
      pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A', pointType: 'apm' },
    });
    expect(snapshot.totals).toMatchObject({ total: 112.97, shipping: 12.99, currency: 'PLN' });
    expect(snapshot.items).toEqual([
      expect.objectContaining({ quantity: 2, price: 49.99, taxRate: '23' }),
    ]);
    expect(record!.buyerTaxId).toBe('5260250995');
  });

  it('E2: a replayed poll enqueues the same change under the same key and keeps one order', async () => {
    connectionId = await seedEmpikConnection(dataSource, {});
    await seedOfferMapping();
    empik.fake.putOrder(waitingOrder('E2-A'));
    const queue = harness.getApp().get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN);
    const enqueueBulk = jest.spyOn(queue, 'enqueueBulk');

    await poll();
    await poll();

    const keys = enqueueBulk.mock.calls.flatMap(([requests]) =>
      requests.map((request) => request.options?.dedupeKey),
    );
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);

    await ingestion().syncOrderFromSource(connectionId, 'E2-A');
    await ingestion().syncOrderFromSource(connectionId, 'E2-A');
    expect(
      await dataSource.getRepository(OrderRecordOrmEntity).count({
        where: { sourceConnectionId: connectionId },
      }),
    ).toBe(1);
  });

  it('E3: with acceptance off, a waiting order is left untouched and not ingested', async () => {
    connectionId = await seedEmpikConnection(dataSource, { orderAcceptance: 'off' });
    empik.fake.putOrder(waitingOrder('E3-A'));

    const result = await poll();

    expect(empik.fake.callsOf('PUT')).toHaveLength(0);
    expect(empik.fake.orderState('E3-A')).toBe('WAITING_ACCEPTANCE');
    expect(result).toMatchObject({ fetched: 0, committed: true });
  });

  it('E4: an ORDER_INVALID_STATE answer does not fail the poll', async () => {
    connectionId = await seedEmpikConnection(dataSource, {});
    empik.fake.putOrder(waitingOrder('E4-A'));
    empik.fake.failNextAccept(
      new MiraklApiException('invalid state', 400, 'ORDER_INVALID_STATE', 'Order is not waiting'),
    );

    await expect(poll()).resolves.toMatchObject({ committed: true });
  });

  it('E5: a cash-on-delivery order is ingested as cod with the amount to collect', async () => {
    connectionId = await seedEmpikConnection(dataSource, {});
    await seedOfferMapping();
    empik.fake.putOrder(
      waitingOrder('E5-A', { shipping_type_code: 'COURIER_POD', shipping_pudo_id: undefined }),
    );

    await poll();
    await ingestion().syncOrderFromSource(connectionId, 'E5-A');

    const snapshot = (await findOrderRecord('E5-A'))!.orderSnapshot as unknown as Record<
      string,
      unknown
    >;
    expect(snapshot).toMatchObject({
      paymentMethod: 'cash_on_delivery',
      paymentStatus: 'cod',
      codToCollect: { amount: '112.97', currency: 'PLN' },
    });
  });

  it('E6: a cancelled order is reported to core as a cancellation', async () => {
    connectionId = await seedEmpikConnection(dataSource, {});
    empik.fake.putOrder(
      buildMiraklOrder({
        order_id: 'E6-A',
        order_state: 'CANCELED',
        created_date: minutesAgo(20),
        last_updated_date: minutesAgo(5),
      }),
    );
    const queue = harness.getApp().get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN);
    const enqueueBulk = jest.spyOn(queue, 'enqueueBulk');

    await poll();

    const payloads = enqueueBulk.mock.calls.flatMap(([requests]) =>
      requests.map((request) => request.payload),
    );
    expect(payloads).toEqual([
      expect.objectContaining({ externalOrderId: 'E6-A', eventType: 'cancelled' }),
    ]);
  });
});

async function seedEmpikConnection(
  dataSource: DataSource,
  config: Record<string, unknown>,
): Promise<string> {
  const credentialsRef = `test-empik-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(key, JSON.stringify({ apiKey: 'test-empik-key-not-real' })),
    }),
  );
  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE,
      name: 'Test Empik orders connection',
      status: 'active',
      config,
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: EMPIK_ORDER_SOURCE_TEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
    }),
  );
  return connection.id;
}
