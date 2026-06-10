/**
 * InPost Webhook Ingestion Integration Tests (#768, ADR-021)
 *
 * End-to-end proof of the third-party-native ingress: an InPost-HMAC-signed
 * `Shipment.Tracking` webhook → per-provider decoder (verify + extract) →
 * publish → translate → routing policy (`shipment` domain, gated on
 * ShippingProviderManager) → `marketplace.shipment.syncByExternalId` job.
 * Complements `webhook-ingestion.int-spec.ts` (the OL-enveloped/default-decoder
 * path) by exercising a registered per-provider decoder.
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

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const redisClient = harness.getRedisClient();
    if (!redisClient) throw new Error('Redis client not available');

    // Inbound event published with the neutral shipment shape. The publisher
    // packs objectType + externalId into the `payloadJson` stream field.
    const events = await redisClient.xRead(
      [{ key: 'events.inbound.webhooks', id: '0' }],
      { COUNT: 50 },
    );
    const shipmentEvent = events?.[0]?.messages.find((msg) => {
      try {
        const p = JSON.parse(msg.message.payloadJson as string) as {
          objectType?: string;
          externalId?: string;
        };
        return p.objectType === 'shipment' && p.externalId === '6200000000001';
      } catch {
        return false;
      }
    });
    expect(shipmentEvent).toBeDefined();

    // Routed to the parcel-targeted shipment-sync job.
    const jobs = await redisClient.xRead([{ key: 'jobs.sync', id: '0' }], { COUNT: 50 });
    const shipmentJob = jobs?.[0]?.messages.find(
      (msg) =>
        msg.message.jobType === 'marketplace.shipment.syncByExternalId' &&
        msg.message.connectionId === connection.id,
    );
    expect(shipmentJob).toBeDefined();
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

    await new Promise((resolve) => setTimeout(resolve, 750));

    const redisClient = harness.getRedisClient();
    if (!redisClient) throw new Error('Redis client not available');
    const jobs = await redisClient.xRead([{ key: 'jobs.sync', id: '0' }], { COUNT: 50 });
    const shipmentJobs =
      jobs?.[0]?.messages.filter(
        (msg) =>
          msg.message.jobType === 'marketplace.shipment.syncByExternalId' &&
          msg.message.connectionId === connection.id,
      ) ?? [];
    expect(shipmentJobs).toHaveLength(0);
  });
});
