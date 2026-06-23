/**
 * Erli Orders Vertical-Slice Integration Test (#998 — the FINAL Erli issue)
 *
 * Exercises the Erli ORDERS half end-to-end through the REAL
 * `ErliOrderSourceAdapter` wired to a fake `IErliHttpClient`, the production
 * adapter-resolution seam (`AdapterRegistryService` + `AdapterFactoryResolverService`
 * → `IntegrationsService.getCapabilityAdapter`), the REAL #994 order mapper, the
 * REAL `OrderIngestionService` / `OrderRecord` persistence, the REAL
 * `ErliWebhookEventTranslator` + REAL `InboundRoutingPolicy`, and real Postgres +
 * Redis. It proves the #993/#994/#995/#996/#997 pieces COMPOSE — not the
 * per-branch unit coverage those issues already carry (plan §2 Out of Scope).
 *
 * ── Why webhook translate→route→sync is proven by DIRECT INVOCATION, not HTTP ──
 * The live HTTP webhook front door is STRUCTURALLY UNACHIEVABLE for Erli today
 * (plan §5/Q1, R2). The host `WebhookRequestDto` forces `eventType` to match
 * `/^[a-z]+\.[a-z_]+$/` (lowercase-dotted), but `ErliWebhookEventTranslator`
 * resolves ONLY the camelCase literals `orderCreated`/`orderStatusChanged`. No
 * DTO-valid `eventType` both validates AND resolves over the host default-decoder
 * path; the bridge is the #992 native `InboundWebhookDecoderPort`, which does not
 * exist. So S1 builds the `InboundWebhookEvent` directly and drives the REAL
 * translator + REAL routing policy at the contract level — proving the two
 * load-bearing OL components compose to `marketplace.order.sync`. The host's
 * fail-closed signature posture is proven separately over HTTP (S2). Neither
 * proves Erli's real HMAC nor the live HTTP success path — both are #992.
 *
 * ── #992-provisional fixture banner ──
 * Every Erli wire shape here (`ErliOrder`, the top-level inbox array, fulfillment
 * paths) is #992-PROVISIONAL — authored to match the DOCUMENTED shapes in
 * `erli-order.types.ts` / `erli-inbox.types.ts` / `erli-fulfillment.types.ts`,
 * NOT a real Erli sandbox. A #992 spike revision is a one-place fixture update.
 *
 * ── Synthetic PII only ──
 * All buyer fixtures use the reserved test domain `@example.test` and synthetic
 * names ("Jan Testowy"); the fail-closed webhook secret is an obviously-fake
 * local constant. No real or guessed PII (plan A6).
 *
 * @module apps/api/test/integration/erli
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  CONNECTION_PORT_TOKEN,
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type Connection,
  type ConnectionPort,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  type DispatchCarrierHint,
  type IOrderIngestionService,
  type OrderSourcePort,
  type OrderStatusWriteback,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  INBOUND_ROUTING_POLICY_TOKEN,
  type IInboundRoutingPolicyService,
} from '@openlinker/core/sync';
import { ErliWebhookEventTranslator } from '@openlinker/integrations-erli/infrastructure/adapters/erli-webhook-event-translator.adapter';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY,
  ERLI_ORDER_SOURCE_TEST_PLATFORM_TYPE,
  installErliOrderSourceHarness,
  type ErliOrderSourceHarness,
} from '../helpers/erli-test-order-source.helper';

// Obviously-fake local webhook secret — only used by the fail-closed HTTP test
// (S2). Never a real secret. The translate→route→sync scenario (S1) needs no
// secret (direct invocation, no HTTP).
const FAKE_ERLI_WEBHOOK_SECRET = 'erli-fake-webhook-secret-not-real-998';

// External order ids the fake serves; distinct per scenario so each is isolated.
const ORDER_POLL = 'erli-order-poll-001';
const ORDER_COD = 'erli-order-cod-002';
const ORDER_CONVERGE = 'erli-order-converge-003';
const ORDER_WEBHOOK = 'erli-order-webhook-004';
const ORDER_DISPATCH_NO_TRACKING = 'erli-order-dispatch-005';
const ORDER_DISPATCH_WITH_TRACKING = 'erli-order-dispatch-006';
const ORDER_AWAITING = 'erli-order-awaiting-007';

/** Inbox path the OrderSource adapter requests (literal). */
const INBOX_PATH = '/inbox';
/** Order-resource path the adapter requests for a given external order id. */
function orderPath(externalOrderId: string): string {
  return `/orders/${encodeURIComponent(externalOrderId)}`;
}
/** Order status-writeback path (#992-verified): PATCH /orders/{id}/status. */
function orderStatusPath(externalOrderId: string): string {
  return `/orders/${encodeURIComponent(externalOrderId)}/status`;
}
/** External-shipment registration endpoint (#992-verified): POST /shipping/external. */
const EXTERNAL_SHIPPING_PATH = '/shipping/external';

/**
 * Build an `ErliOrder` fixture (synthetic PII only), shaped to the #992-verified
 * contract in `erli-order.types.ts`: `user.email`, `items[]`, INTEGER grosze
 * money, `delivery.cod`. The real `getOrder` validates it and the #994 mapper
 * translates it.
 */
function buildErliOrder(
  id: string,
  overrides: {
    status?: 'pending' | 'purchased' | 'cancelled' | 'returned';
    cod?: boolean;
    productExternalId?: string;
  } = {},
): Record<string, unknown> {
  return {
    id,
    externalOrderId: id,
    status: overrides.status ?? 'purchased',
    user: {
      email: 'jan.testowy@example.test',
      deliveryAddress: {
        firstName: 'Jan',
        lastName: 'Testowy',
        address: 'ul. Testowa 1',
        street: 'Testowa',
        buildingNumber: '1',
        zip: '00-001',
        city: 'Warszawa',
        country: 'PL',
        phone: '+48000000000',
      },
    },
    items: [
      {
        id: 1,
        externalId: overrides.productExternalId ?? `erli-variant-${id}`,
        quantity: 1,
        unitPrice: 4999, // 49.99 PLN in grosze
        sku: `SKU-${id}`,
        name: 'Test Widget',
      },
    ],
    delivery: { name: 'Kurier', typeId: 'courier', price: 0, cod: overrides.cod ?? false },
    totalPrice: 4999,
    sellerStatus: 'created',
    created: '2026-06-01T10:00:00.000Z',
    updated: '2026-06-01T10:00:00.000Z',
  };
}

/** A single inbox WIRE message (#992-verified): { id, created, type, payload: { id } }. */
function buildInboxMessage(
  messageId: string,
  externalOrderId: string,
): Record<string, unknown> {
  return {
    id: messageId,
    shopId: 99990,
    type: 'orderCreated',
    created: '2026-06-01T10:00:00.000Z',
    read: false,
    payload: { id: externalOrderId, externalOrderId },
  };
}

describe('Erli Orders Vertical Slice Integration (#998)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let erli: ErliOrderSourceHarness;
  let connectionId: string;
  let priorWebhookSecret: string | undefined;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    erli = installErliOrderSourceHarness(harness);
    priorWebhookSecret = process.env.OPENLINKER_WEBHOOK_SECRET__ERLI;
    process.env.OPENLINKER_WEBHOOK_SECRET__ERLI = FAKE_ERLI_WEBHOOK_SECRET;
  });

  afterEach(async () => {
    erli.fake.reset();
    // S6a/S6b opt into the dispatch-writeback gate (#1086, default-OFF); clear it
    // so it never leaks into another test's expectations.
    delete process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED;
    await resetTestHarness();
  });

  afterAll(async () => {
    if (priorWebhookSecret === undefined) {
      delete process.env.OPENLINKER_WEBHOOK_SECRET__ERLI;
    } else {
      process.env.OPENLINKER_WEBHOOK_SECRET__ERLI = priorWebhookSecret;
    }
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = await seedErliConnection(dataSource);
  });

  function ingestion(): IOrderIngestionService {
    return harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
  }

  function identifierMapping(): IIdentifierMappingService {
    return harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
  }

  /**
   * Drive `syncOrderFromSource` and TOLERATE the terminal "no destination" throw.
   * These scenarios prove the ingestion → #994 mapper → OrderRecord persistence
   * slice; the order record is upserted with `recordStatus:'ready'` (step 5,
   * `order-ingestion.service.ts:274`) BEFORE destination dispatch (step `syncOrder`,
   * `:294`). With no `OrderProcessorManager` connection seeded (the Erli orders
   * half is OrderSource-only — destination dispatch is a separate vertical slice),
   * `OrderSyncService.syncOrder` throws `NoOrderDestinationsAvailableException`
   * AFTER the record is persisted. We swallow ONLY that error (matched by name) so
   * the persisted-record assertions can run; any other error propagates.
   */
  async function syncTolerateNoDestination(externalOrderId: string): Promise<void> {
    try {
      await ingestion().syncOrderFromSource(connectionId, externalOrderId);
    } catch (error) {
      if ((error as Error).name !== 'NoOrderDestinationsAvailableException') {
        throw error;
      }
    }
  }

  /**
   * Seed BOTH a `ProductVariant` identifier mapping AND the variant row so the
   * order-item-ref resolver reaches `recordStatus:'ready'` (plan A3, resolver
   * `order-item-ref-resolver.service.ts:90-100` — a mapping alone is
   * insufficient; `getVariant` must find a row). Returns the internal variant id.
   */
  async function seedReadyItem(externalProductId: string): Promise<string> {
    const internalProductId = `ol_product_${randomUUID().replace(/-/g, '')}`;
    const internalVariantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
    await dataSource.query(
      `INSERT INTO products (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`,
      [internalProductId, 'Erli Test Product'],
    );
    await dataSource.query(
      `INSERT INTO product_variants (id, "productId", attributes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3::jsonb, now(), now())`,
      [internalVariantId, internalProductId, JSON.stringify({})],
    );
    // #1099: the Erli order mapper emits `productRef: { type: 'offer' }` — core's
    // OrderItemRefResolver resolves an `offer` ref via an `Offer` identifier
    // mapping (`Offer: <externalId> → variant`), then loads that variant. Seed the
    // Offer mapping (not ProductVariant) so resolution lands on the seeded variant.
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Offer,
      externalProductId,
      connectionId,
      internalVariantId,
    );
    return internalVariantId;
  }

  async function findOrderRecord(externalOrderId: string): Promise<OrderRecordOrmEntity | null> {
    const internalOrderId = await identifierMapping().getInternalId(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connectionId,
    );
    if (!internalOrderId) {
      return null;
    }
    return dataSource.getRepository(OrderRecordOrmEntity).findOne({ where: { internalOrderId } });
  }

  // ── S1: translate → route → sync (DIRECT invocation of the REAL components) ─
  it('S1: real ErliWebhookEventTranslator + real InboundRoutingPolicy compose to marketplace.order.sync', async () => {
    // The HTTP front door is structurally unachievable for Erli (file header) —
    // build the InboundWebhookEvent the translator actually reads, not a DTO.
    const event: InboundWebhookEvent = {
      eventId: 'erli-evt-s1',
      provider: 'erli',
      connectionId,
      eventType: 'orderCreated',
      occurredAt: '2026-06-01T10:00:00.000Z',
      receivedAt: '2026-06-01T10:00:01.000Z',
      objectType: 'order',
      externalId: ORDER_WEBHOOK,
      payload: { id: ORDER_WEBHOOK },
    };

    // 1) REAL translator → canonical order/created event.
    const translator = new ErliWebhookEventTranslator();
    const canonical = translator.translate(event);
    expect(canonical).toEqual({
      domain: 'order',
      externalId: ORDER_WEBHOOK,
      eventType: 'created',
      occurredAt: '2026-06-01T10:00:00.000Z',
      payload: { id: ORDER_WEBHOOK },
    });

    // 2) REAL routing policy → marketplace.order.sync (requiredCapability OrderSource).
    const routing = harness
      .getApp()
      .get<IInboundRoutingPolicyService>(INBOUND_ROUTING_POLICY_TOKEN);
    const integrations = harness
      .getApp()
      .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    const connectionPort = harness.getApp().get<ConnectionPort>(CONNECTION_PORT_TOKEN);

    const connection: Connection = await connectionPort.get(connectionId);
    const metadata = await integrations.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY,
    });

    const outcome = await routing.route(
      canonical!,
      connection,
      metadata.supportedCapabilities,
      event.eventId,
    );

    expect(outcome.status).toBe('enqueued');
    if (outcome.status === 'enqueued') {
      expect(outcome.jobType).toBe('marketplace.order.sync');
    }
  });

  // ── S2: fail-closed HTTP webhook (security-positive) ───────────────────────
  it('S2: a webhook with a bad signature is rejected 401 with no delivery row and no job', async () => {
    const payload = {
      schemaVersion: 1,
      eventId: 'erli-evt-s2',
      eventType: 'order.created',
      occurredAt: new Date().toISOString(),
      object: { type: 'order', externalId: ORDER_WEBHOOK },
    };

    await harness
      .getHttp()
      .post(`/webhooks/erli/${connectionId}`)
      .set('X-OpenLinker-Timestamp', Date.now().toString())
      .set('X-OpenLinker-Signature', 'sha256=' + 'f'.repeat(64))
      .send(payload)
      .expect(401);

    // No side effects: the signature gate fires before any delivery row / job.
    const deliveryCount = await countRows(
      `SELECT count(*)::int AS n FROM webhook_deliveries WHERE provider = 'erli' AND "connectionId" = $1`,
      connectionId,
    );
    expect(deliveryCount).toBe(0);

    const jobCount = await countRows(
      `SELECT count(*)::int AS n FROM sync_jobs WHERE "connectionId" = $1`,
      connectionId,
    );
    expect(jobCount).toBe(0);
  });

  /** Run a `SELECT count(*)::int AS n …` query and return the count. */
  async function countRows(sql: string, ...params: unknown[]): Promise<number> {
    const rows: Array<{ n: number }> = await dataSource.query(sql, params);
    return rows[0].n;
  }

  // ── S3: inbox-poll reconciliation ─────────────────────────────────────────
  it('S3: inbox-poll discovers an order then syncOrderFromSource persists it (ready)', async () => {
    const externalProductId = `erli-variant-${ORDER_POLL}`;
    await seedReadyItem(externalProductId);

    // Script the inbox (one orderCreated message) + the order resource.
    erli.fake.setRawGet(INBOX_PATH, [buildInboxMessage('1001', ORDER_POLL)]);
    erli.fake.setRawGet(orderPath(ORDER_POLL), buildErliOrder(ORDER_POLL, { productExternalId: externalProductId }));

    // Poll: enqueues a marketplace.order.sync job + commits the cursor.
    const result = await ingestion().ingestOrders(connectionId, {
      cursorKey: 'erli.orders.inboxCursor',
      limit: 200,
    });
    expect(result.fetched).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(result.committed).toBe(true);
    expect(erli.fake.callsOf('GET').some((c) => c.path === INBOX_PATH)).toBe(true);

    // Drive the enqueued sync directly (no worker in the api harness).
    await syncTolerateNoDestination(ORDER_POLL);

    const record = await findOrderRecord(ORDER_POLL);
    expect(record).not.toBeNull();
    expect(record!.recordStatus).toBe('ready');
    expect(record!.orderSnapshot.status).toBe('processing');
  });

  // ── S4: webhook + poll convergence (one order) ─────────────────────────────
  it('S4: two syncOrderFromSource calls for one externalOrderId converge on a single order_records row', async () => {
    const externalProductId = `erli-variant-${ORDER_CONVERGE}`;
    await seedReadyItem(externalProductId);
    erli.fake.setRawGet(
      orderPath(ORDER_CONVERGE),
      buildErliOrder(ORDER_CONVERGE, { productExternalId: externalProductId }),
    );

    // First call = poll-routed sync; second = webhook-routed sync. Both funnel
    // into the identical syncOrderFromSource core path → getOrCreateInternalId
    // resolves the same internalOrderId → single upserted row (plan Q3).
    await syncTolerateNoDestination(ORDER_CONVERGE);
    await syncTolerateNoDestination(ORDER_CONVERGE);

    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const internalOrderId = await identifierMapping().getInternalId(
      CORE_ENTITY_TYPE.Order,
      ORDER_CONVERGE,
      connectionId,
    );
    expect(internalOrderId).not.toBeNull();
    expect(await recordRepo.count({ where: { internalOrderId: internalOrderId! } })).toBe(1);
    expect(await recordRepo.count()).toBe(1);
  });

  // ── S5: COD → processing + paymentStatus:'cod' ─────────────────────────────
  it('S5: a COD order maps to status processing + paymentStatus cod (ready)', async () => {
    const externalProductId = `erli-variant-${ORDER_COD}`;
    await seedReadyItem(externalProductId);
    erli.fake.setRawGet(
      orderPath(ORDER_COD),
      buildErliOrder(ORDER_COD, { status: 'purchased', cod: true, productExternalId: externalProductId }),
    );

    await syncTolerateNoDestination(ORDER_COD);

    const record = await findOrderRecord(ORDER_COD);
    expect(record).not.toBeNull();
    expect(record!.recordStatus).toBe('ready');
    expect(record!.orderSnapshot.status).toBe('processing');
    expect(record!.orderSnapshot.paymentStatus).toBe('cod');
  });

  // ── S5b: negative — unmapped item leaves the order awaiting_mapping ─────────
  it('S5b: an order whose item has no variant mapping persists awaiting_mapping + throws', async () => {
    // No seedReadyItem — the line item's productRef cannot be resolved.
    erli.fake.setRawGet(orderPath(ORDER_AWAITING), buildErliOrder(ORDER_AWAITING));

    await expect(ingestion().syncOrderFromSource(connectionId, ORDER_AWAITING)).rejects.toThrow();

    const record = await findOrderRecord(ORDER_AWAITING);
    expect(record).not.toBeNull();
    expect(record!.recordStatus).toBe('awaiting_mapping');
  });

  // ── S6: lifecycle writeback (DIRECT invocation of OrderStatusWriteback.write) ─
  it('S6a: write(dispatched) marks dispatched and OMITS tracking for an Erli-managed shipment', async () => {
    process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED = 'true';
    const adapter = await getOrderSourceAdapter();

    const result = await adapter.write({
      type: 'dispatched',
      externalOrderId: ORDER_DISPATCH_NO_TRACKING,
    });

    expect(result.outcome).toBe('applied');
    const patches = erli.fake.callsOf('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(orderStatusPath(ORDER_DISPATCH_NO_TRACKING));
    expect(patches[0].body).toEqual({ status: 'sent' });
    // No shipment POST when tracking is absent (omit-on-absence, §5.4).
    expect(erli.fake.callsOf('POST')).toHaveLength(0);
  });

  it('S6b: write(dispatched) ATTACHES the waybill when a real trackingNumber + carrier is present', async () => {
    process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED = 'true';
    const adapter = await getOrderSourceAdapter();

    const carrier: DispatchCarrierHint = { platformType: 'inpost' };
    const result = await adapter.write({
      type: 'dispatched',
      externalOrderId: ORDER_DISPATCH_WITH_TRACKING,
      trackingNumber: 'WB-998-XYZ',
      carrier,
    });

    expect(result.outcome).toBe('applied');
    const patches = erli.fake.callsOf('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(orderStatusPath(ORDER_DISPATCH_WITH_TRACKING));
    expect(patches[0].body).toEqual({ status: 'sent' });

    const posts = erli.fake.callsOf('POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(EXTERNAL_SHIPPING_PATH);
    expect(posts[0].body).toEqual([
      { vendor: 'inpost', orderId: ORDER_DISPATCH_WITH_TRACKING, trackingNumber: 'WB-998-XYZ' },
    ]);
  });

  /** Resolve the REAL ErliOrderSourceAdapter (an OrderStatusWriteback) via the seam. */
  async function getOrderSourceAdapter(): Promise<OrderSourcePort & OrderStatusWriteback> {
    const integrations = harness
      .getApp()
      .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    return integrations.getCapabilityAdapter<OrderSourcePort & OrderStatusWriteback>(
      connectionId,
      'OrderSource',
    );
  }
});

/**
 * Seed an active Erli connection wired to the test OrderSource adapterKey +
 * `OrderSource` capability (required for routing/getCapabilityAdapter), plus an
 * obviously-fake credential row (the real adapter never consumes it; present for
 * referential hygiene).
 */
async function seedErliConnection(dataSource: DataSource): Promise<string> {
  const credentialsRef = `test-erli-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: ERLI_ORDER_SOURCE_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(
        key,
        JSON.stringify({ apiKey: 'test-erli-key-not-real' }),
      ),
    }),
  );

  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: ERLI_ORDER_SOURCE_TEST_PLATFORM_TYPE,
      name: 'Test Erli orders connection',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
    }),
  );
  return connection.id;
}
