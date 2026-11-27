/**
 * Webhook Job Gate Fan-Out Integration Tests
 *
 * One inbound webhook can stand for several changes (Shoper sends a single
 * `product.edit` for a product edit AND a panel stock edit), so a translator
 * may return several canonical events and the gate commits one job per event.
 * These tests pin that against real Postgres: every job and the delivery row
 * commit in ONE transaction, the delivery row records the primary job, a
 * replay creates nothing, and a failure on a later job rolls back the earlier
 * job AND the delivery row - so a source retry never meets half a fan-out
 * recorded as delivered (ADR-049 decision 1).
 *
 * The last test drives the REAL routing service and the REAL Shoper translator
 * so the fan-out decision and the keys it produces are exercised end to end.
 *
 * @module apps/api/test/integration
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { SyncJobRequest } from '@openlinker/core/sync';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import type { IWebhookJobGateService } from '../../src/webhooks/application/interfaces/webhook-job-gate.service.interface';
import { WEBHOOK_JOB_GATE_SERVICE_TOKEN } from '../../src/webhooks/application/interfaces/webhook-job-gate.service.interface';
import type { IInboundWebhookRoutingService } from '../../src/webhooks/application/interfaces/inbound-webhook-routing.service.interface';
import { INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN } from '../../src/webhooks/application/interfaces/inbound-webhook-routing.service.interface';

const PRODUCT_JOB = 'master.product.syncByExternalId';
const INVENTORY_JOB = 'master.inventory.syncByExternalId';

interface DeliveryRow {
  status: string;
  downstreamJobId: string | null;
  downstreamJobType: string | null;
}

interface JobRow {
  id: string;
  jobType: string;
  idempotencyKey: string;
}

describe('Webhook job gate fan-out (one delivery, several jobs)', () => {
  let harness: IntegrationTestHarness;
  let gate: IWebhookJobGateService;

  beforeAll(async () => {
    harness = await getTestHarness();
    gate = harness.getApp().get<IWebhookJobGateService>(WEBHOOK_JOB_GATE_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function delivery(connectionId: string, eventId: string): WebhookDeliveryUpsertInput {
    return {
      eventId,
      provider: 'shoper',
      connectionId,
      eventType: 'product.edit',
      objectType: 'product',
      externalId: '23',
      receivedAt: new Date(),
      signatureValid: true,
      dedupResult: 'new',
      status: 'job_enqueued',
      payload: { product_id: '23' },
    };
  }

  function jobs(connectionId: string, eventId: string): [SyncJobRequest, SyncJobRequest] {
    const base = `shoper:${connectionId}:${eventId}`;
    return [
      {
        jobType: PRODUCT_JOB,
        connectionId,
        payload: { schemaVersion: 1, externalId: '23', objectType: 'Product' },
        idempotencyKey: base,
      },
      {
        jobType: INVENTORY_JOB,
        connectionId,
        payload: { schemaVersion: 1, externalId: '23', objectType: 'Inventory' },
        idempotencyKey: `${base}:${INVENTORY_JOB}`,
      },
    ];
  }

  async function readDelivery(
    connectionId: string,
    eventId: string
  ): Promise<DeliveryRow | undefined> {
    const rows = (await harness.getDataSource().query(
      `SELECT status, "downstreamJobId", "downstreamJobType"
         FROM webhook_deliveries
        WHERE provider = 'shoper' AND "connectionId" = $1 AND "eventId" = $2`,
      [connectionId, eventId]
    )) as DeliveryRow[];
    return rows[0];
  }

  async function readJobs(connectionId: string): Promise<JobRow[]> {
    return (await harness.getDataSource().query(
      `SELECT id, "jobType", "idempotencyKey" FROM sync_jobs
        WHERE "connectionId" = $1 ORDER BY "idempotencyKey"`,
      [connectionId]
    )) as JobRow[];
  }

  it('should commit both jobs and the delivery row together when a delivery fans out into two jobs', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'shoper',
      adapterKey: 'shoper.restapi.v1',
    });
    const eventId = 'fan-out-commit-1';
    const [productJob, inventoryJob] = jobs(connection.id, eventId);

    const result = await gate.insertDeliveryWithJobs(delivery(connection.id, eventId), [
      productJob,
      inventoryJob,
    ]);

    expect(result.isNew).toBe(true);
    expect(result.jobIds).toHaveLength(2);
    expect(result.jobId).toBe(result.jobIds[0]);

    const stored = await readJobs(connection.id);
    expect(stored.map((row) => [row.jobType, row.idempotencyKey])).toEqual([
      [PRODUCT_JOB, productJob.idempotencyKey],
      [INVENTORY_JOB, inventoryJob.idempotencyKey],
    ]);
    expect(stored.find((row) => row.jobType === PRODUCT_JOB)?.id).toBe(result.jobIds[0]);
    expect(stored.find((row) => row.jobType === INVENTORY_JOB)?.id).toBe(result.jobIds[1]);

    // The delivery row has one downstream slot, and it names the PRIMARY job.
    const row = await readDelivery(connection.id, eventId);
    expect(row).toEqual({
      status: 'job_enqueued',
      downstreamJobId: result.jobIds[0],
      downstreamJobType: PRODUCT_JOB,
    });
  });

  it('should create no new job and return the same ids when the same delivery is replayed', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'shoper',
      adapterKey: 'shoper.restapi.v1',
    });
    const eventId = 'fan-out-replay-1';
    const fanOut = jobs(connection.id, eventId);

    const first = await gate.insertDeliveryWithJobs(delivery(connection.id, eventId), fanOut);
    const replay = await gate.insertDeliveryWithJobs(delivery(connection.id, eventId), fanOut);

    expect(first.isNew).toBe(true);
    expect(replay.isNew).toBe(false);
    expect(replay.jobIds).toEqual(first.jobIds);
    expect(await readJobs(connection.id)).toHaveLength(2);
    expect((await readDelivery(connection.id, eventId))?.downstreamJobId).toBe(first.jobIds[0]);
  });

  it('should roll back the first job AND the delivery row when the second job insert fails', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'shoper',
      adapterKey: 'shoper.restapi.v1',
    });
    const eventId = 'fan-out-rollback-1';
    const [productJob, inventoryJob] = jobs(connection.id, eventId);

    // A genuine database refusal inside the transaction, not a mocked throw:
    // `sync_jobs.connectionId` is a uuid column, so Postgres rejects the second
    // job's INSERT after the first has already been written in the same
    // transaction. Committed sequentially, the first job would survive.
    const brokenSecond: SyncJobRequest = { ...inventoryJob, connectionId: 'not-a-uuid' };

    await expect(
      gate.insertDeliveryWithJobs(delivery(connection.id, eventId), [productJob, brokenSecond])
    ).rejects.toThrow(/uuid/i);

    expect(await readJobs(connection.id)).toHaveLength(0);
    const leaked = (await harness
      .getDataSource()
      .query(`SELECT id FROM sync_jobs WHERE "idempotencyKey" LIKE $1`, [
        `shoper:${connection.id}:${eventId}%`,
      ])) as Array<{ id: string }>;
    expect(leaked).toHaveLength(0);
    expect(await readDelivery(connection.id, eventId)).toBeUndefined();

    // Nothing was recorded, so the source's retry re-enters cleanly.
    const retry = await gate.insertDeliveryWithJobs(delivery(connection.id, eventId), [
      productJob,
      inventoryJob,
    ]);
    expect(retry.isNew).toBe(true);
    expect(await readJobs(connection.id)).toHaveLength(2);
  });

  it('should route a Shoper product.edit to a product job and an inventory job when both capabilities are enabled', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'shoper',
      adapterKey: 'shoper.restapi.v1',
      enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    });
    const eventId = 'fan-out-shoper-edit-1';
    const routing = harness
      .getApp()
      .get<IInboundWebhookRoutingService>(INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN);
    const event: InboundWebhookEvent = {
      eventId,
      provider: 'shoper',
      connectionId: connection.id,
      eventType: 'product.edit',
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      objectType: 'product',
      externalId: '23',
      payload: { product_id: '23' },
    };

    const outcome = await routing.resolveEvent(event);

    expect(outcome.kind).toBe('routed');
    if (outcome.kind !== 'routed') {
      return;
    }
    const base = `shoper:${connection.id}:${eventId}`;
    expect(outcome.jobs.map((job) => [job.jobType, job.idempotencyKey])).toEqual([
      [PRODUCT_JOB, base],
      [INVENTORY_JOB, `${base}:${INVENTORY_JOB}`],
    ]);

    const result = await gate.insertDeliveryWithJobs(
      delivery(connection.id, eventId),
      outcome.jobs
    );
    expect(result.jobIds).toHaveLength(2);
    expect((await readDelivery(connection.id, eventId))?.downstreamJobType).toBe(PRODUCT_JOB);
  });

  it('should route a Shoper product.edit to the product job alone when InventoryMaster is not enabled', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'shoper',
      adapterKey: 'shoper.restapi.v1',
      enabledCapabilities: ['ProductMaster'],
    });
    const eventId = 'fan-out-shoper-edit-2';
    const routing = harness
      .getApp()
      .get<IInboundWebhookRoutingService>(INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN);

    const outcome = await routing.resolveEvent({
      eventId,
      provider: 'shoper',
      connectionId: connection.id,
      eventType: 'product.edit',
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      objectType: 'product',
      externalId: '23',
      payload: { product_id: '23' },
    });

    expect(outcome.kind).toBe('routed');
    if (outcome.kind === 'routed') {
      expect(outcome.jobs.map((job) => job.jobType)).toEqual([PRODUCT_JOB]);
      expect(outcome.jobs[0].idempotencyKey).toBe(`shoper:${connection.id}:${eventId}`);
    }
  });
});
