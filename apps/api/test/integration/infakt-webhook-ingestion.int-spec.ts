/**
 * Infakt Webhook Ingestion Integration Tests (#1509, #1281 / #1354, ADR-021)
 *
 * End-to-end proof of the third-party-native Infakt ingress over real HTTP:
 * a genuine `X-Infakt-Signature` HMAC-SHA256 delivery, in Infakt's real
 * `{ event, resource }` body shape, through the registered
 * `InfaktInboundWebhookDecoderAdapter` (detectHandshake + verify +
 * extractEnvelope) → dedup → publish → the real
 * `InfaktWebhookEventTranslatorAdapter` → the real `InboundRoutingPolicy`.
 *
 * Complements the existing unit coverage (decoder / event-translator / the
 * `InfaktWebhookTranslator` HMAC + parse + handshake specs) by exercising the
 * full receiver stack in CI, mirroring the Erli/InPost/PrestaShop int-specs.
 *
 * Covers the two OL-actionable routing branches plus the two auth/handshake
 * quirks documented on the decoder:
 *  - `send_to_ksef_success` → `invoicing.regulatoryStatus.reconcile`
 *  - `invoice_marked_as_paid` → `invoicing.paymentStatus.refreshByExternalId`
 *  - wrong signature → 401 (no delivery row, no job)
 *  - subscription-verification handshake → 200 + echoed `verification_code`
 *    (the documented 200-instead-of-202 quirk verified live against Infakt's
 *    "Zweryfikuj" button)
 *
 * @module apps/api/test/integration
 */
import { createHmac, randomUUID } from 'crypto';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

/** The real, registered Infakt adapterKey (mirrors `infaktAdapterManifest`). */
const INFAKT_ADAPTER_KEY = 'infakt.accounting.v1';

/** Infakt delivery auth: HMAC-SHA256 hex over the raw body, header `X-Infakt-Signature`. */
function infaktSign(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Job stream field shape (all values are strings on the Redis stream). */
type JobFields = { jobType: string; connectionId: string; payloadJson: string };

/**
 * Ingestion is async (HTTP 202 → event bus → WebhookToJobHandler → enqueue), so
 * poll the `jobs.sync` stream until a job matching `predicate` appears rather
 * than relying on a single fixed sleep (which races under full-suite load).
 */
async function waitForJob(
  harness: IntegrationTestHarness,
  predicate: (fields: JobFields) => boolean,
  timeoutMs = 5000,
): Promise<JobFields | undefined> {
  const redisClient = harness.getRedisClient();
  if (!redisClient) throw new Error('Redis client not available');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = await redisClient.xRead([{ key: 'jobs.sync', id: '0' }], { COUNT: 50 });
    const match = jobs?.[0]?.messages
      .map((msg) => msg.message as JobFields)
      .find((fields) => predicate(fields));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return undefined;
}

describe('Infakt Webhook Ingestion Integration (#1509)', () => {
  let harness: IntegrationTestHarness;
  const webhookSecret = 'infakt-native-decoder-test-secret-246810';
  let priorEnvSecret: string | undefined;

  beforeAll(async () => {
    harness = await getTestHarness();
    priorEnvSecret = process.env.OPENLINKER_WEBHOOK_SECRET__INFAKT;
    // Provider-level env fallback (`CredentialsWebhookSecretAdapter`) — same
    // mechanism the Erli/InPost webhook int-specs use; the simplest way to give
    // the real decoder a secret to verify against without provisioning a
    // per-connection encrypted credentials row.
    process.env.OPENLINKER_WEBHOOK_SECRET__INFAKT = webhookSecret;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    if (priorEnvSecret === undefined) {
      delete process.env.OPENLINKER_WEBHOOK_SECRET__INFAKT;
    } else {
      process.env.OPENLINKER_WEBHOOK_SECRET__INFAKT = priorEnvSecret;
    }
    await teardownTestHarness();
  });

  async function createInfaktConnection(): Promise<{ id: string }> {
    return createTestConnection(harness.getDataSource(), {
      platformType: 'infakt',
      status: 'active',
      adapterKey: INFAKT_ADAPTER_KEY,
      config: {},
      enabledCapabilities: ['Invoicing'],
    });
  }

  // Both OL-actionable routing branches are asserted in a SINGLE test on
  // purpose: `resetTestHarness()` flushes Redis (`flushDb`), which destroys the
  // `webhook-handler` consumer group the handler created at boot — so only the
  // first pre-reset test can observe a handler-processed enqueue (the same
  // reason the Erli/InPost webhook int-specs each assert exactly one enqueue).
  // Firing both signed deliveries here, before any reset, keeps the consumer
  // group alive across both.
  it('routes real Infakt-signed KSeF-clearance and payment webhooks to their respective jobs', async () => {
    const ksefConnection = await createInfaktConnection();
    const paymentConnection = await createInfaktConnection();
    const ksefInvoiceUuid = `inv-${randomUUID()}`;
    const paidInvoiceUuid = `inv-${randomUUID()}`;

    const ksefBody = {
      event: {
        uuid: `evt-${randomUUID()}`,
        name: 'send_to_ksef_success',
        retry_counter: 0,
        created_at: new Date().toISOString(),
      },
      resource: { status: 'success', invoice_uuid: ksefInvoiceUuid, ksef_number: 'KSeF-INT-1' },
    };
    const ksefRawBody = Buffer.from(JSON.stringify(ksefBody));

    const paymentBody = {
      event: {
        uuid: `evt-${randomUUID()}`,
        name: 'invoice_marked_as_paid',
        retry_counter: 0,
        created_at: new Date().toISOString(),
      },
      // A payment event's resource is the full invoice object → `uuid`, not `invoice_uuid`.
      resource: { uuid: paidInvoiceUuid, status: 'paid' },
    };
    const paymentRawBody = Buffer.from(JSON.stringify(paymentBody));

    await harness
      .getHttp()
      .post(`/webhooks/infakt/${ksefConnection.id}`)
      .set('X-Infakt-Signature', infaktSign(ksefRawBody, webhookSecret))
      .send(ksefBody)
      .expect(202);

    await harness
      .getHttp()
      .post(`/webhooks/infakt/${paymentConnection.id}`)
      .set('X-Infakt-Signature', infaktSign(paymentRawBody, webhookSecret))
      .send(paymentBody)
      .expect(202);

    // KSeF-clearance event → regulatory-status reconcile (a trigger, not the
    // source of truth: it nudges the page-scan reconciler; no by-id job exists).
    const reconcileJob = await waitForJob(
      harness,
      (fields) =>
        fields.jobType === 'invoicing.regulatoryStatus.reconcile' &&
        fields.connectionId === ksefConnection.id,
    );
    expect(reconcileJob).toBeDefined();

    // Payment event → by-id payment-status refresh keyed by the invoice uuid.
    const paymentJob = await waitForJob(harness, (fields) => {
      if (fields.jobType !== 'invoicing.paymentStatus.refreshByExternalId') return false;
      if (fields.connectionId !== paymentConnection.id) return false;
      try {
        const payload = JSON.parse(fields.payloadJson) as { externalInvoiceId?: string };
        return payload.externalInvoiceId === paidInvoiceUuid;
      } catch {
        return false;
      }
    });
    expect(paymentJob).toBeDefined();

    // The controller's own 'published' delivery-recording write and the
    // handler's later 'job_enqueued' write race independently of the enqueue
    // itself (both best-effort, #711) — assert only that a signature-verified
    // delivery row exists, not its exact terminal status.
    const deliveryRows: Array<{ signatureValid: boolean }> = await harness.getDataSource().query(
      `SELECT "signatureValid" FROM webhook_deliveries WHERE provider = 'infakt' AND "connectionId" = $1`,
      [ksefConnection.id],
    );
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0].signatureValid).toBe(true);
  });

  it('rejects an Infakt webhook with a wrong signature (401), records no delivery, enqueues no job', async () => {
    const connection = await createInfaktConnection();
    const body = {
      event: {
        uuid: `evt-${randomUUID()}`,
        name: 'send_to_ksef_success',
        retry_counter: 0,
        created_at: new Date().toISOString(),
      },
      resource: { status: 'success', invoice_uuid: `inv-${randomUUID()}` },
    };

    await harness
      .getHttp()
      .post(`/webhooks/infakt/${connection.id}`)
      .set('X-Infakt-Signature', 'deadbeefdeadbeefdeadbeefdeadbeef')
      .send(body)
      .expect(401);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const deliveryRows: Array<{ n: number }> = await harness.getDataSource().query(
      `SELECT count(*)::int AS n FROM webhook_deliveries WHERE provider = 'infakt' AND "connectionId" = $1`,
      [connection.id],
    );
    expect(deliveryRows[0].n).toBe(0);

    const redisClient = harness.getRedisClient();
    if (!redisClient) throw new Error('Redis client not available');
    const jobs = await redisClient.xRead([{ key: 'jobs.sync', id: '0' }], { COUNT: 50 });
    const infaktJobs =
      jobs?.[0]?.messages.filter((msg) => msg.message.connectionId === connection.id) ?? [];
    expect(infaktJobs).toHaveLength(0);
  });

  it('echoes the verification_code handshake with 200 and enqueues no job', async () => {
    const connection = await createInfaktConnection();
    const verificationCode = `vc-${randomUUID()}`;

    // The handshake ping predates any signed traffic and carries no signature;
    // the controller must echo the same body back with a 200 (not the route's
    // default 202) to activate the subscription.
    const response = await harness
      .getHttp()
      .post(`/webhooks/infakt/${connection.id}`)
      .send({ verification_code: verificationCode })
      .expect(200);

    expect(response.body).toEqual({ verification_code: verificationCode });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const redisClient = harness.getRedisClient();
    if (!redisClient) throw new Error('Redis client not available');
    const jobs = await redisClient.xRead([{ key: 'jobs.sync', id: '0' }], { COUNT: 50 });
    const infaktJobs =
      jobs?.[0]?.messages.filter((msg) => msg.message.connectionId === connection.id) ?? [];
    expect(infaktJobs).toHaveLength(0);
  });
});
