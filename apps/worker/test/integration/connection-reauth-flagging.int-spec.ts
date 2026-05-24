/**
 * Connection Re-auth Flagging Integration Test (#819)
 *
 * Drives the production `SyncJobRunner.handleJobFailure` path against a real
 * Postgres + the full worker module graph (so the Allegro auth-failure
 * classifier is registered exactly as it is at boot). Verifies that a terminal
 * credential rejection flips the originating connection to `needs_reauth` while
 * a transient / non-auth failure leaves it `active`.
 *
 * @module apps/worker/test/integration
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- driving the runner's private handleJobFailure with the production seam */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestSyncJob, getSyncJobById } from './helpers/test-sync-job.helper';
import { SyncJobRunner } from '../../src/sync/sync-job.runner';
import { SyncJobEntity as SyncJob, SyncJobExecutionError } from '@openlinker/core/sync';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import {
  AllegroAuthenticationException,
  AllegroApiException,
} from '@openlinker/integrations-allegro';

describe('Connection Re-auth Flagging Integration (#819)', () => {
  let harness: WorkerIntegrationTestHarness;
  let runner: SyncJobRunner;
  let connectionPort: ConnectionPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    runner = harness.get(SyncJobRunner);
    connectionPort = harness.get(CONNECTION_PORT_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function runFailure(connectionId: string, cause: unknown): Promise<string> {
    const ormJob = await createTestSyncJob(harness.getDataSource(), {
      jobType: 'marketplace.orders.poll',
      connectionId,
      status: 'running',
      attempts: 1,
      maxAttempts: 10,
    });
    const job = new SyncJob(
      ormJob.id,
      ormJob.jobType,
      connectionId,
      ormJob.payloadJson,
      'running',
      ormJob.idempotencyKey,
      1,
      10,
      new Date(),
      new Date(),
      'worker-test',
      null,
      new Date(),
      new Date()
    );
    const error = new SyncJobExecutionError(
      'Marketplace orders poll failed',
      job.id,
      job.jobType,
      connectionId,
      cause
    );
    await (runner as any).handleJobFailure(job, error);
    return ormJob.id;
  }

  it('flips an active Allegro connection to needs_reauth on a terminal credential rejection', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      status: 'active',
      adapterKey: 'allegro.publicapi.v1',
      config: { environment: 'sandbox' },
    });

    const jobId = await runFailure(
      connection.id,
      new AllegroAuthenticationException('Invalid refresh token', 401)
    );

    const updated = await connectionPort.get(connection.id);
    expect(updated.status).toBe('needs_reauth');

    // The job is still marked dead — flagging is additive.
    const job = await getSyncJobById(harness.getDataSource(), jobId);
    expect(job?.status).toBe('dead');
  });

  it('leaves the connection active on a non-auth non-retryable failure (422)', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      status: 'active',
      adapterKey: 'allegro.publicapi.v1',
      config: { environment: 'sandbox' },
    });

    await runFailure(
      connection.id,
      new AllegroApiException('Validation failed', 422, 'body', 'https://api.allegro.pl/x')
    );

    const updated = await connectionPort.get(connection.id);
    expect(updated.status).toBe('active');
  });
});
