/**
 * Erli Webhook Ingestion Integration Test (#1081 / #1294, ADR-021)
 *
 * End-to-end proof of the NATIVE Erli ingress over real HTTP: a genuine
 * `Authorization: Bearer <secret>` delivery, in Erli's real full-order-resource
 * body shape, through the registered `ErliInboundWebhookDecoderAdapter`
 * (verify + extractEnvelope) → dedup → publish → the real
 * `ErliWebhookEventTranslator` → the real `InboundRoutingPolicy` →
 * `marketplace.order.sync`. Complements
 * `erli-orders-vertical-slice.int-spec.ts` S1/S2, which drive the
 * translator/routing pair directly (the native decoder did not exist when
 * that file's header was authored) and only prove the fail-closed path over
 * HTTP — this spec is the one that proves a genuine signature succeeds
 * through the real host ingress end to end (piotrswierzy's PR #1295 review).
 *
 * @module apps/api/test/integration/erli
 */
import { randomUUID } from 'crypto';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

/** The real, registered Erli adapterKey (mirrors `erli.constants.ts`'s `ERLI_ADAPTER_KEY`). */
const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';

/** A real Erli webhook delivery is the full order resource — only `id` is load-bearing. */
function buildErliOrderWebhookBody(orderId: string, updated: string): Record<string, unknown> {
  return {
    id: orderId,
    status: 'purchased',
    updated,
    created: updated,
  };
}

describe('Erli Webhook Ingestion Integration (#1081 / #1294)', () => {
  let harness: IntegrationTestHarness;
  const webhookSecret = 'erli-native-decoder-test-secret-135790';
  let priorEnvSecret: string | undefined;

  beforeAll(async () => {
    harness = await getTestHarness();
    priorEnvSecret = process.env.OPENLINKER_WEBHOOK_SECRET__ERLI;
    // Provider-level env fallback (`CredentialsWebhookSecretAdapter`) — same
    // mechanism the InPost/PrestaShop webhook int-specs use; simplest way to
    // give the real decoder a secret to verify against without going through
    // the full provisioning (`ErliWebhookProvisioningAdapter.install`) flow.
    process.env.OPENLINKER_WEBHOOK_SECRET__ERLI = webhookSecret;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    if (priorEnvSecret === undefined) {
      delete process.env.OPENLINKER_WEBHOOK_SECRET__ERLI;
    } else {
      process.env.OPENLINKER_WEBHOOK_SECRET__ERLI = priorEnvSecret;
    }
    await teardownTestHarness();
  });

  async function createErliConnection(): Promise<{ id: string }> {
    return createTestConnection(harness.getDataSource(), {
      platformType: 'erli',
      status: 'active',
      adapterKey: ERLI_ADAPTER_KEY,
      config: {},
      enabledCapabilities: ['OrderSource'],
    });
  }

  it('verifies a real Bearer-signed Erli order webhook and routes it to a marketplace.order.sync job', async () => {
    const connection = await createErliConnection();
    const orderId = `erli-order-${randomUUID()}`;
    const body = buildErliOrderWebhookBody(orderId, new Date().toISOString());

    await harness
      .getHttp()
      .post(`/webhooks/erli/${connection.id}`)
      .set('Authorization', `Bearer ${webhookSecret}`)
      .send(body)
      .expect(202);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const redisClient = harness.getRedisClient();
    if (!redisClient) throw new Error('Redis client not available');

    const jobs = await redisClient.xRead([{ key: 'jobs.sync', id: '0' }], { COUNT: 50 });
    const orderJob = jobs?.[0]?.messages.find((msg) => {
      if (msg.message.jobType !== 'marketplace.order.sync') return false;
      if (msg.message.connectionId !== connection.id) return false;
      try {
        const payload = JSON.parse(msg.message.payloadJson) as {
          externalOrderId?: string;
        };
        return payload.externalOrderId === orderId;
      } catch {
        return false;
      }
    });
    expect(orderJob).toBeDefined();

    // The controller's own 'published' delivery-recording write and the
    // handler's later 'job_enqueued' write race independently of the job
    // enqueue itself (both are best-effort, #711) — assert only that a
    // signature-verified delivery row exists, not its exact terminal status.
    const deliveryRows: Array<{ signatureValid: boolean }> = await harness.getDataSource().query(
      `SELECT "signatureValid" FROM webhook_deliveries WHERE provider = 'erli' AND "connectionId" = $1`,
      [connection.id],
    );
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0].signatureValid).toBe(true);
  });

  it('rejects an Erli webhook with a wrong Bearer token (401), records no delivery, enqueues no job', async () => {
    const connection = await createErliConnection();
    const orderId = `erli-order-${randomUUID()}`;

    await harness
      .getHttp()
      .post(`/webhooks/erli/${connection.id}`)
      .set('Authorization', 'Bearer not-the-real-secret')
      .send(buildErliOrderWebhookBody(orderId, new Date().toISOString()))
      .expect(401);

    const deliveryRows: Array<{ n: number }> = await harness.getDataSource().query(
      `SELECT count(*)::int AS n FROM webhook_deliveries WHERE provider = 'erli' AND "connectionId" = $1`,
      [connection.id],
    );
    expect(deliveryRows[0].n).toBe(0);
  });

  it('rejects an Erli webhook with a lowercase "bearer" scheme carrying the wrong token (401)', async () => {
    const connection = await createErliConnection();
    const orderId = `erli-order-${randomUUID()}`;

    // Regression guard for the case-sensitivity fix (#1295 round-1 review):
    // a lowercase scheme must still go through the same case-insensitive
    // prefix strip, so a WRONG token under that scheme is rejected on its
    // own merits — not because the scheme match itself broke.
    await harness
      .getHttp()
      .post(`/webhooks/erli/${connection.id}`)
      .set('Authorization', 'bearer not-the-real-secret')
      .send(buildErliOrderWebhookBody(orderId, new Date().toISOString()))
      .expect(401);
  });
});
