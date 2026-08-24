/**
 * Infakt Webhook Ingestion Integration Tests (#1509, #1281 / #1354, ADR-021)
 *
 * End-to-end proof of the third-party-native Infakt ingress over real HTTP:
 * a genuine `X-Infakt-Signature` HMAC-SHA256 delivery, in Infakt's real
 * `{ event, resource }` body shape, through the registered
 * `InfaktInboundWebhookDecoderAdapter` (detectHandshake + verify +
 * extractEnvelope) → the real `InfaktWebhookEventTranslatorAdapter` → the real
 * `InboundRoutingPolicy` → the durable-spine gate (#2280): the `sync_jobs`
 * work row commits in the same transaction as the delivery row, so job
 * assertions read Postgres directly — no stream polling.
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

interface SyncJobRow {
  jobType: string;
  connectionId: string;
  payloadJson: unknown;
}

/** `payloadJson` is jsonb — the driver returns it parsed; tolerate both. */
function parseJobPayload<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * The gate is synchronous (#2280): by the time the 202 returns, any enqueued
 * job is committed to `sync_jobs` — read it back directly.
 */
async function readJobsForConnection(
  harness: IntegrationTestHarness,
  connectionId: string,
): Promise<SyncJobRow[]> {
  return (await harness.getDataSource().query(
    `SELECT "jobType", "connectionId", "payloadJson" FROM sync_jobs WHERE "connectionId" = $1`,
    [connectionId],
  )) as SyncJobRow[];
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
    const ksefJobs = await readJobsForConnection(harness, ksefConnection.id);
    expect(ksefJobs).toHaveLength(1);
    expect(ksefJobs[0].jobType).toBe('invoicing.regulatoryStatus.reconcile');

    // Payment event → by-id payment-status refresh keyed by the invoice uuid.
    const paymentJobs = await readJobsForConnection(harness, paymentConnection.id);
    expect(paymentJobs).toHaveLength(1);
    expect(paymentJobs[0].jobType).toBe('invoicing.paymentStatus.refreshByExternalId');
    const paymentPayload = parseJobPayload<{ externalInvoiceId?: string }>(
      paymentJobs[0].payloadJson,
    );
    expect(paymentPayload.externalInvoiceId).toBe(paidInvoiceUuid);

    // The delivery row commits in the same transaction as the job (#2280), in
    // its final status — no race with a separate handler write to tolerate.
    const deliveryRows: Array<{ signatureValid: boolean; status: string }> = await harness
      .getDataSource()
      .query(
        `SELECT "signatureValid", status FROM webhook_deliveries WHERE provider = 'infakt' AND "connectionId" = $1`,
        [ksefConnection.id],
      );
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0].signatureValid).toBe(true);
    expect(deliveryRows[0].status).toBe('job_enqueued');
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

    // The spine is synchronous — a rejected delivery cannot have written
    // anything, and there is no async consumer whose lag could hide a write.
    const deliveryRows: Array<{ n: number }> = await harness.getDataSource().query(
      `SELECT count(*)::int AS n FROM webhook_deliveries WHERE provider = 'infakt' AND "connectionId" = $1`,
      [connection.id],
    );
    expect(deliveryRows[0].n).toBe(0);
    expect(await readJobsForConnection(harness, connection.id)).toHaveLength(0);
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

    // The handshake short-circuits before routing — synchronously, so the
    // absence of a job row is provable immediately (#2280).
    expect(await readJobsForConnection(harness, connection.id)).toHaveLength(0);
  });
});
