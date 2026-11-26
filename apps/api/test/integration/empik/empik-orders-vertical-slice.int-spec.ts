/**
 * Empik Orders Vertical-Slice Integration Test (#4275, #4276, #4279)
 *
 * Runs Empik order ingestion end to end through the REAL
 * `MiraklOrderSourceAdapter` (acceptance, feed windows, mapper) over an
 * in-memory Mirakl order API, the production adapter-resolution seam, the REAL
 * `OrderIngestionService` and `OrderRecord` persistence, and real Postgres and
 * Redis.
 *
 * E7-E10 (#4276) cover the way back: the adapter is resolved through
 * `IntegrationsService.getCapabilityAdapter` and narrowed with core's own
 * guards, exactly as the lifecycle relay, the fulfilment readback and the
 * invoice upload do it.
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
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  isOrderBillingDocumentUploader,
  isOrderFulfillmentReadback,
  isOrderStatusWriteback,
  ORDER_INGESTION_SERVICE_TOKEN,
  type IOrderIngestionService,
  type OrderSourcePort,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  RETURN_INGESTION_SERVICE_TOKEN,
  type IReturnIngestionService,
} from '@openlinker/core/returns';
import { ReturnLineOrmEntity, ReturnOrmEntity } from '@openlinker/core/returns/orm-entities';
import { SYNC_JOB_QUEUE_TOKEN, type SyncJobQueuePort } from '@openlinker/core/sync';
import { MiraklApiException } from '@openlinker/integrations-mirakl';
import type { MiraklOrder } from '@openlinker/integrations-mirakl/domain/types/mirakl-order.types';
import {
  buildMiraklOrder,
  buildMiraklOrderLine,
} from '@openlinker/integrations-mirakl/infrastructure/adapters/__tests__/mirakl-order.fixture';
import { buildMiraklReturn } from '@openlinker/integrations-mirakl/infrastructure/adapters/__tests__/mirakl-return.fixture';

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
      [productId, 'Empik Test Product']
    );
    await dataSource.query(
      `INSERT INTO product_variants (id, "productId", attributes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3::jsonb, now(), now())`,
      [variantId, productId, JSON.stringify({})]
    );
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Offer,
      OFFER_SKU,
      connectionId,
      variantId
    );
  }

  async function findOrderRecord(externalOrderId: string): Promise<OrderRecordOrmEntity | null> {
    const internalOrderId = await identifierMapping().getInternalId(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connectionId
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
      requests.map((request) => request.options?.dedupeKey)
    );
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);

    await ingestion().syncOrderFromSource(connectionId, 'E2-A');
    await ingestion().syncOrderFromSource(connectionId, 'E2-A');
    expect(
      await dataSource.getRepository(OrderRecordOrmEntity).count({
        where: { sourceConnectionId: connectionId },
      })
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
      new MiraklApiException('invalid state', 400, 'ORDER_INVALID_STATE', 'Order is not waiting')
    );

    await expect(poll()).resolves.toMatchObject({ committed: true });
  });

  it('E5: a cash-on-delivery order is ingested as cod with the amount to collect', async () => {
    connectionId = await seedEmpikConnection(dataSource, {});
    await seedOfferMapping();
    empik.fake.putOrder(
      waitingOrder('E5-A', { shipping_type_code: 'COURIER_POD', shipping_pudo_id: undefined })
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
      })
    );
    const queue = harness.getApp().get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN);
    const enqueueBulk = jest.spyOn(queue, 'enqueueBulk');

    await poll();

    const payloads = enqueueBulk.mock.calls.flatMap(([requests]) =>
      requests.map((request) => request.payload)
    );
    expect(payloads).toEqual([
      expect.objectContaining({ externalOrderId: 'E6-A', eventType: 'cancelled' }),
    ]);
  });

  describe('Empik returns (#4279)', () => {
    function returns(): IReturnIngestionService {
      return harness.getApp().get<IReturnIngestionService>(RETURN_INGESTION_SERVICE_TOKEN);
    }

    async function ingestOrder(orderId: string): Promise<void> {
      await seedOfferMapping();
      empik.fake.putOrder(waitingOrder(orderId));
      await poll();
      await ingestion().syncOrderFromSource(connectionId, orderId);
    }

    it('E11: a return opened on Empik is polled, ingested with its lines and reason, and attributed to the order', async () => {
      connectionId = await seedEmpikConnection(dataSource, {});
      await ingestOrder('E11-A');
      empik.fake.putReturn(
        buildMiraklReturn({
          id: 'R-E11',
          order_id: 'E11-A',
          last_updated: minutesAgo(5),
          return_lines: [
            { order_line_id: 'E11-A-1', quantity: 1, reason_code: 'RETURN_BROKEN_ITEM' },
          ],
        })
      );

      const polled = await returns().ingestReturns(connectionId, {
        cursorKey: 'empik.returns.lastUpdateDate',
        limit: 100,
      });
      expect(polled).toMatchObject({ fetched: 1, enqueued: 1, committed: true });

      const synced = await returns().syncReturnFromSource(connectionId, 'R-E11');
      expect(synced.attributed).toBe(true);
      const stored = await dataSource
        .getRepository(ReturnOrmEntity)
        .findOneOrFail({ where: { sourceConnectionId: connectionId, externalReturnId: 'R-E11' } });
      expect(stored).toMatchObject({ externalOrderId: 'E11-A', rawStatus: 'WAITING_ACCEPTANCE' });
      expect(stored.internalOrderId).not.toBeNull();
      const lines = await dataSource
        .getRepository(ReturnLineOrmEntity)
        .find({ where: { returnId: stored.id } });
      expect(lines).toEqual([
        expect.objectContaining({ externalLineId: 'E11-A-1', sku: OFFER_SKU, quantityAdvised: 1 }),
      ]);
    });

    it('E12: a re-read follows the return to a terminal state', async () => {
      connectionId = await seedEmpikConnection(dataSource, {});
      await ingestOrder('E12-A');
      empik.fake.putReturn(buildMiraklReturn({ id: 'R-E12', order_id: 'E12-A' }));
      await returns().syncReturnFromSource(connectionId, 'R-E12');

      empik.fake.putReturn(buildMiraklReturn({ id: 'R-E12', order_id: 'E12-A', state: 'CLOSED' }));
      await returns().syncReturnFromSource(connectionId, 'R-E12');

      const stored = await dataSource
        .getRepository(ReturnOrmEntity)
        .findOneOrFail({ where: { sourceConnectionId: connectionId, externalReturnId: 'R-E12' } });
      expect(stored.rawStatus).toBe('CLOSED');
    });
  });

  describe('Empik order way back (#4276)', () => {
    async function orderSource(config: Record<string, unknown> = {}): Promise<OrderSourcePort> {
      const connectionId = await seedEmpikConnection(dataSource, config);
      return harness
        .getApp()
        .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN)
        .getCapabilityAdapter<OrderSourcePort>(connectionId, 'OrderSource');
    }

    it('E7: a dispatch sends the tracking number with the Empik carrier code and ships the order', async () => {
      empik.fake.putOrder(buildMiraklOrder({ order_id: 'E7-A', order_state: 'SHIPPING' }));
      const adapter = await orderSource();
      if (!isOrderStatusWriteback(adapter)) throw new Error('not a writeback');

      const result = await adapter.write({
        type: 'dispatched',
        externalOrderId: 'E7-A',
        trackingNumber: '620000000000123',
        carrier: { platformType: 'inpost' },
      });

      expect(result).toEqual({ outcome: 'applied' });
      expect(empik.fake.order('E7-A')).toMatchObject({
        order_state: 'SHIPPED',
        shipping_tracking: '620000000000123',
        shipping_carrier_code: 'paczkomatyinpost',
      });
      const replay = await adapter.write({
        type: 'dispatched',
        externalOrderId: 'E7-A',
        trackingNumber: '620000000000123',
      });
      expect(replay.outcome).toBe('applied');
      expect(empik.fake.callsOf('PUT')).toHaveLength(2);
    });

    it('E8: a cancellation cancels the order, and a shipped order is refused', async () => {
      empik.fake.putOrder(buildMiraklOrder({ order_id: 'E8-A', order_state: 'SHIPPING' }));
      empik.fake.putOrder(buildMiraklOrder({ order_id: 'E8-B', order_state: 'SHIPPED' }));
      const adapter = await orderSource();
      if (!isOrderStatusWriteback(adapter)) throw new Error('not a writeback');

      expect((await adapter.write({ type: 'cancelled', externalOrderId: 'E8-A' })).outcome).toBe(
        'applied'
      );
      expect(empik.fake.orderState('E8-A')).toBe('CANCELED');
      expect((await adapter.write({ type: 'cancelled', externalOrderId: 'E8-B' })).outcome).toBe(
        'rejected'
      );
      expect(empik.fake.orderState('E8-B')).toBe('SHIPPED');
    });

    it('E9: a shipment entered in the Empik panel is read back with its tracking number', async () => {
      empik.fake.putOrder(
        buildMiraklOrder({
          order_id: 'E9-A',
          order_state: 'SHIPPED',
          shipping_tracking: 'DPD-1',
          shipping_carrier_code: 'dpd',
          shipping_company: 'DPD',
        })
      );
      const adapter = await orderSource();
      if (!isOrderFulfillmentReadback(adapter)) throw new Error('not a readback');

      expect(await adapter.readFulfillment({ externalOrderId: 'E9-A' })).toEqual({
        outcome: 'read',
        rawStatus: 'SHIPPED',
        dispatched: true,
        waybills: [{ waybill: 'DPD-1', carrierId: 'dpd', carrierName: 'DPD' }],
      });
    });

    it('E10: an invoice is attached once as CUSTOMER_INVOICE', async () => {
      empik.fake.putOrder(buildMiraklOrder({ order_id: 'E10-A', order_state: 'SHIPPED' }));
      const adapter = await orderSource();
      if (!isOrderBillingDocumentUploader(adapter)) throw new Error('not an uploader');
      const input = {
        externalOrderId: 'E10-A',
        documentNumber: 'FV/10/2026',
        fileName: 'FV-10-2026.pdf',
        contentType: 'application/pdf',
        content: new Uint8Array([37, 80, 68, 70]),
      };

      expect((await adapter.uploadBillingDocument(input)).outcome).toBe('uploaded');
      expect((await adapter.uploadBillingDocument(input)).outcome).toBe('already-present');
      expect(empik.fake.documents).toEqual([
        { order_id: 'E10-A', file_name: 'FV-10-2026.pdf', type: 'CUSTOMER_INVOICE' },
      ]);
    });
  });
});

async function seedEmpikConnection(
  dataSource: DataSource,
  config: Record<string, unknown>
): Promise<string> {
  const credentialsRef = `test-empik-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(
        key,
        JSON.stringify({ apiKey: 'test-empik-key-not-real' })
      ),
    })
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
    })
  );
  return connection.id;
}
