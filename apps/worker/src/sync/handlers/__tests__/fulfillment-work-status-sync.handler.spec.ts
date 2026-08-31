/**
 * Fulfillment Work Status Sync Handler Unit Tests (#2400)
 *
 * The handler records NOTHING by design — see its docblock. What is testable,
 * and what these cover, is the payload contract: the one field that identifies
 * the subject is guarded, the two advisory fields are not, and the job
 * completes `ok` rather than failing.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';

import { FulfillmentWorkStatusSyncHandler } from '../fulfillment-work-status-sync.handler';

describe('FulfillmentWorkStatusSyncHandler', () => {
  let handler: FulfillmentWorkStatusSyncHandler;

  const job = (payload: unknown): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.work.statusSync',
      connectionId: 'conn-1',
      payload,
    }) as unknown as SyncJob;

  beforeEach(() => {
    handler = new FulfillmentWorkStatusSyncHandler();
  });

  it('should complete ok for a well-formed trigger', async () => {
    const result = await handler.execute(
      job({
        schemaVersion: 1,
        externalWorkId: 'vendor-work-7',
        sourceEventId: 'evt-1',
        eventType: 'picked',
      })
    );

    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should complete ok even though it records no progress — the authoritative read is #2398', async () => {
    // Pins the deliberate no-op. If a future change makes this handler write
    // progress from the webhook body, this test is the one that should be
    // reconsidered FIRST — the payload carries no deltas precisely so it cannot.
    const result = await handler.execute(
      job({ schemaVersion: 1, externalWorkId: 'vendor-work-7' })
    );

    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should throw when the payload is missing entirely', async () => {
    await expect(handler.execute(job(null))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should throw when externalWorkId is absent — it is the only field that identifies the subject', async () => {
    await expect(
      handler.execute(job({ schemaVersion: 1, sourceEventId: 'evt-1' }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should throw when externalWorkId is present but not a string', async () => {
    await expect(
      handler.execute(job({ schemaVersion: 1, externalWorkId: 42 }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should tolerate absent advisory fields rather than failing the job', async () => {
    // `sourceEventId` / `eventType` reach only the log line, and the routing
    // policy always populates them — failing here would turn a cosmetic gap
    // into a dead row.
    await expect(
      handler.execute(job({ schemaVersion: 1, externalWorkId: 'vendor-work-7' }))
    ).resolves.toEqual({ outcome: 'ok' });
  });
});
