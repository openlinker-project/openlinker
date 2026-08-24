/**
 * InPost Webhook Ingestion Integration Tests (#768, ADR-021)
 *
 * End-to-end proof of the third-party-native ingress: an InPost-HMAC-signed
 * `Shipment.Tracking` webhook → per-provider decoder (verify + extract) →
 * translate → routing policy (`shipment` domain, gated on
 * ShippingProviderManager) → the durable-spine gate (#2280) committing the
 * `marketplace.shipment.syncByExternalId` work row synchronously. Complements
 * `webhook-ingestion.int-spec.ts` (the OL-enveloped/default-decoder path) by
 * exercising a registered per-provider decoder.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import * as crypto from 'crypto';

function inpostSign(rawBody: Buffer, timestamp: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), rawBody]))
    .digest('base64');
}

interface SyncJobRow {
  jobType: string;
  payloadJson: unknown;
}

/** `payloadJson` is jsonb — the driver returns it parsed; tolerate both. */
function parseJobPayload<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

async function readShipmentJobs(
  harness: IntegrationTestHarness,
  connectionId: string,
): Promise<SyncJobRow[]> {
  return (await harness.getDataSource().query(
    `SELECT "jobType", "payloadJson" FROM sync_jobs
      WHERE "connectionId" = $1 AND "jobType" = 'marketplace.shipment.syncByExternalId'`,
    [connectionId],
  )) as SyncJobRow[];
}

describe('InPost Webhook Ingestion Integration (#768)', () => {
  let harness: IntegrationTestHarness;
  const webhookSecret = 'inpost-test-secret-67890';

  beforeAll(async () => {
    harness = await getTestHarness();
    process.env.OPENLINKER_WEBHOOK_SECRET__INPOST = webhookSecret;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function createInpostConnection(): Promise<{ id: string }> {
    return createTestConnection(harness.getDataSource(), {
      platformType: 'inpost',
      status: 'active',
      adapterKey: 'inpost.shipx.v1',
      config: {},
      enabledCapabilities: ['ShippingProviderManager'],
    });
  }

  it('verifies an InPost-signed Shipment.Tracking webhook and routes it to a shipment-sync job', async () => {
    const connection = await createInpostConnection();

    const body = { tracking_number: '6200000000001' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = new Date().toISOString();
    const signature = inpostSign(rawBody, timestamp, webhookSecret);

    await harness
      .getHttp()
      .post(`/webhooks/inpost/${connection.id}`)
      .set('x-inpost-timestamp', timestamp)
      .set('x-inpost-signature', signature)
      .set('x-inpost-topic', 'Shipment.Tracking')
      .send(body)
      .expect(202);

    // The gate is synchronous (#2280): the work row is committed by the time
    // the 202 returns — no stream polling, no sleep.
    const jobs = await readShipmentJobs(harness, connection.id);
    expect(jobs).toHaveLength(1);
    const payload = parseJobPayload<{ externalId?: string }>(jobs[0].payloadJson);
    expect(payload.externalId).toBe('6200000000001');

    // Delivery row committed alongside the job, in its final status.
    const deliveries: Array<{ status: string; downstreamJobType: string | null }> = await harness
      .getDataSource()
      .query(
        `SELECT status, "downstreamJobType" FROM webhook_deliveries WHERE provider = 'inpost' AND "connectionId" = $1`,
        [connection.id],
      );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('job_enqueued');
    expect(deliveries[0].downstreamJobType).toBe('marketplace.shipment.syncByExternalId');
  });

  it('rejects an InPost webhook with an invalid signature (401)', async () => {
    const connection = await createInpostConnection();

    await harness
      .getHttp()
      .post(`/webhooks/inpost/${connection.id}`)
      .set('x-inpost-timestamp', new Date().toISOString())
      .set('x-inpost-signature', Buffer.from('not-the-real-signature').toString('base64'))
      .set('x-inpost-topic', 'Shipment.Tracking')
      .send({ tracking_number: '6200000000002' })
      .expect(401);
  });

  it('ignores a non-tracking topic (202, no job enqueued)', async () => {
    const connection = await createInpostConnection();
    const body = { tracking_number: '6200000000003' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = new Date().toISOString();
    const signature = inpostSign(rawBody, timestamp, webhookSecret);

    await harness
      .getHttp()
      .post(`/webhooks/inpost/${connection.id}`)
      .set('x-inpost-timestamp', timestamp)
      .set('x-inpost-signature', signature)
      .set('x-inpost-topic', 'Shipment.SomethingElse')
      .send(body)
      .expect(202);

    // Synchronous spine: absence is provable immediately (#2280).
    expect(await readShipmentJobs(harness, connection.id)).toHaveLength(0);
  });
});
