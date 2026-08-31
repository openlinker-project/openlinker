/**
 * Fulfillment inbound routing — through the real gate (#2400, AC1)
 *
 * AC1: *"a fulfillment-domain webhook routes to a job instead of dead-lettering"*.
 *
 * ## What this proves, and the one hop it deliberately stops short of
 *
 * It drives the REAL `InboundRoutingPolicyService` and the REAL
 * `WebhookJobGateRepository` against a real Postgres, and asserts the durable
 * outcome: a committed `sync_jobs` row of type `fulfillment.work.statusSync`
 * carrying the routed payload, plus a `webhook_deliveries` row that is
 * `job_enqueued` and **not** `deadlettered`. That is the property AC1 is about
 * — before this change the `'fulfillment'` domain did not exist, so the same
 * delivery could only ever have produced a `deadlettered` row.
 *
 * It does NOT start from an HTTP request with a vendor signature, and cannot:
 * that hop needs a plugin `WebhookEventTranslator` emitting
 * `domain: 'fulfillment'`, and **no shipped adapter emits one** (the vendor
 * translator is plugin-side and not part of #2400). Faking a translator would
 * assert that a test double returns what the test told it to, which is not
 * evidence about this change. The boundary is therefore drawn at the canonical
 * event — the first point at which the behaviour under test is real — and the
 * hop above it is stated here rather than implied away.
 *
 * The same reasoning is why the `'return'` arm is asserted alongside: both
 * union members were added together, and both must reach a real job row.
 *
 * RED-FIRST EVIDENCE: on `origin/oms-programme-wave-3a` this spec cannot even
 * compile — `domain: 'fulfillment'` is not assignable to `InboundEventDomain`,
 * which is the union being grown. Run against a build where the two members
 * exist but the `resolveRoute` arms are removed, `resolve()` throws
 * `Unhandled inbound event domain: fulfillment` from the `never`-exhaustive
 * default and no job row is written.
 *
 * @module apps/api/test/integration
 */
import type { CanonicalInboundEvent } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { InboundRoutingPolicyService } from '@openlinker/core/sync';

import type { IWebhookJobGateService } from '../../src/webhooks/application/interfaces/webhook-job-gate.service.interface';
import { WEBHOOK_JOB_GATE_SERVICE_TOKEN } from '../../src/webhooks/application/interfaces/webhook-job-gate.service.interface';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

interface SyncJobRow {
  jobType: string;
  status: string;
  connectionId: string;
  payloadJson: unknown;
}

interface DeliveryRow {
  status: string;
  downstreamJobType: string | null;
  dlqReason: string | null;
}

describe('Fulfillment inbound routing through the real gate (#2400)', () => {
  let harness: IntegrationTestHarness;
  let routing: InboundRoutingPolicyService;
  let gate: IWebhookJobGateService;

  beforeAll(async () => {
    harness = await getTestHarness();
    routing = harness.getApp().get(InboundRoutingPolicyService);
    gate = harness.getApp().get<IWebhookJobGateService>(WEBHOOK_JOB_GATE_SERVICE_TOKEN);
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  const event = (overrides: Partial<CanonicalInboundEvent>): CanonicalInboundEvent => ({
    domain: 'order',
    externalId: 'ext-1',
    eventType: 'picked',
    occurredAt: '2026-08-31T10:00:00.000Z',
    ...overrides,
  });

  /** Route, then commit through the real single-transaction gate. */
  const ingest = async (
    canonical: CanonicalInboundEvent,
    connectionId: string,
    platformType: string,
    enabled: string[],
    eventId: string
  ): Promise<SyncJobRequest | null> => {
    const connection = {
      id: connectionId,
      platformType,
      enabledCapabilities: enabled,
    } as unknown as Connection;

    const resolution = routing.resolve(canonical, connection, enabled, eventId);
    const job = resolution.status === 'resolved' ? resolution.job : null;

    await gate.insertDeliveryWithJob(
      {
        eventId,
        provider: platformType,
        connectionId,
        eventType: canonical.eventType,
        externalId: canonical.externalId,
        status: job ? 'job_enqueued' : 'deadlettered',
        downstreamJobType: job?.jobType ?? null,
        dlqReason: job ? null : `ungated: ${canonical.domain}`,
      },
      job
    );

    return job;
  };

  const readJob = async (connectionId: string): Promise<SyncJobRow | undefined> => {
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT "jobType", status, "connectionId", "payloadJson"
         FROM sync_jobs WHERE "connectionId" = $1`,
        [connectionId]
      )) as SyncJobRow[];
    return rows[0];
  };

  const readDelivery = async (connectionId: string): Promise<DeliveryRow | undefined> => {
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT status, "downstreamJobType", "dlqReason"
         FROM webhook_deliveries WHERE "connectionId" = $1`,
        [connectionId]
      )) as DeliveryRow[];
    return rows[0];
  };

  it('should commit a fulfillment.work.statusSync job row and a non-deadlettered delivery', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      enabledCapabilities: ['FulfillmentExecutor'],
    });

    const job = await ingest(
      event({ domain: 'fulfillment', externalId: 'vendor-work-7' }),
      connection.id,
      'prestashop',
      ['FulfillmentExecutor'],
      'evt-fulfillment-1'
    );

    expect(job?.jobType).toBe('fulfillment.work.statusSync');

    // The durable half — this is what AC1 is actually about.
    const row = await readJob(connection.id);
    expect(row?.jobType).toBe('fulfillment.work.statusSync');
    expect(row?.status).toBe('queued');

    const payload =
      typeof row?.payloadJson === 'string'
        ? (JSON.parse(row.payloadJson) as Record<string, unknown>)
        : (row?.payloadJson as Record<string, unknown>);
    expect(payload.externalWorkId).toBe('vendor-work-7');
    // No deltas reach the job: the webhook body is never a source of truth.
    expect(payload).not.toHaveProperty('lines');

    const delivery = await readDelivery(connection.id);
    expect(delivery?.status).toBe('job_enqueued');
    expect(delivery?.status).not.toBe('deadlettered');
    expect(delivery?.dlqReason).toBeNull();
  });

  it('should dead-letter instead when FulfillmentExecutor is not enabled — TODAY\'S REAL CASE', async () => {
    // No shipped adapter manifest advertises `FulfillmentExecutor`, so this is
    // what a real deployment does right now. Asserted so the arm is never
    // mistaken for working end-to-end.
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      enabledCapabilities: [],
    });

    const job = await ingest(
      event({ domain: 'fulfillment', externalId: 'vendor-work-7' }),
      connection.id,
      'prestashop',
      [],
      'evt-fulfillment-2'
    );

    expect(job).toBeNull();
    expect(await readJob(connection.id)).toBeUndefined();
    expect((await readDelivery(connection.id))?.status).toBe('deadlettered');
  });

  it('should commit a marketplace.return.sync job row for a return-domain event', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      enabledCapabilities: ['OrderSource'],
    });

    await ingest(
      event({ domain: 'return', externalId: 'ret-5' }),
      connection.id,
      'allegro',
      ['OrderSource'],
      'evt-return-1'
    );

    const row = await readJob(connection.id);
    expect(row?.jobType).toBe('marketplace.return.sync');

    const payload =
      typeof row?.payloadJson === 'string'
        ? (JSON.parse(row.payloadJson) as Record<string, unknown>)
        : (row?.payloadJson as Record<string, unknown>);
    expect(payload.externalReturnId).toBe('ret-5');

    expect((await readDelivery(connection.id))?.status).toBe('job_enqueued');
  });

  it('should be idempotent on a redelivery of the same event id', async () => {
    // The gate's ADR-005 dedup, exercised for the NEW domain specifically:
    // a replay must not mint a second job row.
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      enabledCapabilities: ['FulfillmentExecutor'],
    });

    for (let i = 0; i < 2; i += 1) {
      await ingest(
        event({ domain: 'fulfillment', externalId: 'vendor-work-7' }),
        connection.id,
        'prestashop',
        ['FulfillmentExecutor'],
        'evt-fulfillment-dup'
      );
    }

    const rows = (await harness
      .getDataSource()
      .query(`SELECT count(*)::int AS total FROM sync_jobs WHERE "connectionId" = $1`, [
        connection.id,
      ])) as { total: number }[];
    expect(rows[0].total).toBe(1);
  });
});
