/**
 * Shopify Webhook Ingestion Integration Tests (#3981, #4100 review)
 *
 * The vertical slice of the Shopify inbound path, over real HTTP and real
 * Postgres: a delivery signed the way Shopify signs it
 * (`x-shopify-hmac-sha256 = base64(HMAC-SHA256(client secret, raw body))`)
 * reaches `/webhooks/shopify/:connectionId`, goes through the registered
 * `ShopifyInboundWebhookDecoderAdapter` and `ShopifyWebhookEventTranslatorAdapter`,
 * the capability-gated routing policy, and the durable gate (#2280), which
 * commits the `webhook_deliveries` row and the `sync_jobs` row together. So
 * every assertion reads Postgres directly.
 *
 * It also proves the plugin is wired into the API host: nothing here registers
 * a stub, so a decoder or translator missing from the registries fails these
 * tests rather than a live install.
 *
 * Covered:
 *  - an order webhook enqueues one `marketplace.order.sync` job;
 *  - the same delivery sent again (same `x-shopify-webhook-id`, a later
 *    `x-shopify-triggered-at`, as a Shopify retry carries) stays one delivery
 *    and one job - the decoder reports no timestamp, so this gate is the
 *    replay protection;
 *  - a product update fans out to the product and the stock job;
 *  - a wrong signature answers 401 and writes nothing;
 *  - a topic OpenLinker does not handle answers 202 and writes no job.
 *
 * @module apps/api/test/integration
 */
import { createHmac, randomUUID } from 'crypto';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

/** The registered Shopify adapter key and platform type (`shopify.constants.ts`). */
const SHOPIFY_ADAPTER_KEY = 'shopify.admin.v1';
const SHOPIFY_PLATFORM_TYPE = 'shopify';

/** Shopify's delivery signature: base64 HMAC-SHA256 over the raw body. */
function shopifySign(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(Buffer.from(rawBody)).digest('base64');
}

interface SyncJobRow {
  jobType: string;
  idempotencyKey: string;
  payloadJson: unknown;
}

function parseJobPayload<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

async function readJobs(
  harness: IntegrationTestHarness,
  connectionId: string
): Promise<SyncJobRow[]> {
  return harness.getDataSource().query<SyncJobRow[]>(
    `SELECT "jobType", "idempotencyKey", "payloadJson" FROM sync_jobs
      WHERE "connectionId" = $1 ORDER BY "jobType"`,
    [connectionId]
  );
}

async function readDeliveries(
  harness: IntegrationTestHarness,
  connectionId: string
): Promise<Array<{ eventId: string; status: string; signatureValid: boolean }>> {
  return harness.getDataSource().query(
    `SELECT "eventId", status, "signatureValid" FROM webhook_deliveries
      WHERE provider = $1 AND "connectionId" = $2`,
    [SHOPIFY_PLATFORM_TYPE, connectionId]
  );
}

describe('Shopify Webhook Ingestion Integration (#3981)', () => {
  let harness: IntegrationTestHarness;
  const clientSecret = 'shopify-client-secret-int-spec-13579';
  let priorEnvSecret: string | undefined;

  beforeAll(async () => {
    harness = await getTestHarness();
    // Provider-level env fallback of `CredentialsWebhookSecretAdapter`, as the
    // inFakt / Erli / InPost int-specs use it. In production the provisioner
    // stores the app's client secret as the connection's webhook secret.
    priorEnvSecret = process.env.OPENLINKER_WEBHOOK_SECRET__SHOPIFY;
    process.env.OPENLINKER_WEBHOOK_SECRET__SHOPIFY = clientSecret;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    if (priorEnvSecret === undefined) {
      delete process.env.OPENLINKER_WEBHOOK_SECRET__SHOPIFY;
    } else {
      process.env.OPENLINKER_WEBHOOK_SECRET__SHOPIFY = priorEnvSecret;
    }
    await teardownTestHarness();
  });

  async function createShopifyConnection(enabledCapabilities: string[]): Promise<{ id: string }> {
    return createTestConnection(harness.getDataSource(), {
      platformType: SHOPIFY_PLATFORM_TYPE,
      name: 'Shopify store',
      status: 'active',
      adapterKey: SHOPIFY_ADAPTER_KEY,
      config: { storeDomain: 'ol-int-spec.myshopify.com' },
      enabledCapabilities,
    });
  }

  function post(
    connectionId: string,
    topic: string,
    rawBody: string,
    headers: { webhookId?: string; triggeredAt?: string; signature?: string } = {}
  ) {
    const shopifyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-shopify-topic': topic,
      'x-shopify-hmac-sha256': headers.signature ?? shopifySign(rawBody, clientSecret),
      'x-shopify-triggered-at': headers.triggeredAt ?? '2026-11-17T10:00:00.000Z',
      ...(headers.webhookId === undefined ? {} : { 'x-shopify-webhook-id': headers.webhookId }),
    };
    return harness
      .getHttp()
      .post(`/webhooks/shopify/${connectionId}`)
      .set(shopifyHeaders)
      .send(rawBody);
  }

  it('routes a signed order webhook to one order sync job, and a retry of it to nothing more', async () => {
    const connection = await createShopifyConnection(['OrderSource']);
    const webhookId = `wh-${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: 5501234567,
      admin_graphql_api_id: 'gid://shopify/Order/5501234567',
      name: '#1001',
    });

    await post(connection.id, 'orders/updated', rawBody, { webhookId }).expect(202);

    const jobs = await readJobs(harness, connection.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobType).toBe('marketplace.order.sync');
    expect(parseJobPayload<{ externalOrderId?: string }>(jobs[0].payloadJson).externalOrderId).toBe(
      '5501234567'
    );
    const deliveries = await readDeliveries(harness, connection.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      eventId: webhookId,
      status: 'job_enqueued',
      signatureValid: true,
    });

    // A Shopify retry: same webhook id and body, a later trigger time. The
    // decoder reports no timestamp, so nothing refuses it as stale - the gate
    // keyed by the webhook id is what drops it.
    for (const triggeredAt of ['2026-11-17T10:05:00.000Z', '2026-11-17T13:55:00.000Z']) {
      await post(connection.id, 'orders/updated', rawBody, { webhookId, triggeredAt }).expect(202);
    }

    expect(await readJobs(harness, connection.id)).toHaveLength(1);
    expect(await readDeliveries(harness, connection.id)).toHaveLength(1);
  });

  it('fans a product update out to the product and the stock job', async () => {
    const connection = await createShopifyConnection(['ProductMaster', 'InventoryMaster']);
    const rawBody = JSON.stringify({
      id: 7701234567,
      admin_graphql_api_id: 'gid://shopify/Product/7701234567',
      title: 'Koszulka',
    });

    await post(connection.id, 'products/update', rawBody, {
      webhookId: `wh-${randomUUID()}`,
    }).expect(202);

    const jobs = await readJobs(harness, connection.id);
    expect(jobs.map((job) => job.jobType)).toEqual([
      'master.inventory.syncByExternalId',
      'master.product.syncByExternalId',
    ]);
    for (const job of jobs) {
      expect(parseJobPayload<{ externalId?: string }>(job.payloadJson).externalId).toBe(
        '7701234567'
      );
    }
    expect(await readDeliveries(harness, connection.id)).toHaveLength(1);
  });

  it('rejects a delivery signed with another secret (401), records no delivery and enqueues no job', async () => {
    const connection = await createShopifyConnection(['OrderSource']);
    const rawBody = JSON.stringify({
      id: 5501234568,
      admin_graphql_api_id: 'gid://shopify/Order/5501234568',
    });

    await post(connection.id, 'orders/updated', rawBody, {
      webhookId: `wh-${randomUUID()}`,
      signature: shopifySign(rawBody, 'not-the-client-secret'),
    }).expect(401);

    expect(await readDeliveries(harness, connection.id)).toHaveLength(0);
    expect(await readJobs(harness, connection.id)).toHaveLength(0);
  });

  it('accepts a topic OpenLinker does not handle without enqueueing a job', async () => {
    const connection = await createShopifyConnection(['OrderSource', 'ProductMaster']);
    const rawBody = JSON.stringify({ id: 9901234567, email: 'buyer@example.com' });

    await post(connection.id, 'customers/create', rawBody, {
      webhookId: `wh-${randomUUID()}`,
    }).expect(202);

    expect(await readJobs(harness, connection.id)).toHaveLength(0);
  });
});
