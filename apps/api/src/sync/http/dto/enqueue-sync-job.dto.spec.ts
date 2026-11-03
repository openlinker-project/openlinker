/**
 * `EnqueueSyncJobDto` — `connectionId` validation (#3506, G02-4)
 *
 * The manual `POST /v1/sync/jobs` trigger must accept the nil UUID the worker
 * scheduler uses for deployment-wide jobs, or the documented manual run of
 * `fulfillment.work.relaySweep` is impossible as written — and the workaround
 * (a v4-shaped stand-in) changes the handler's lock scope, so a manual run and
 * the cron would no longer exclude each other.
 *
 * @module apps/api/src/sync/http/dto
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EnqueueSyncJobDto } from './enqueue-sync-job.dto';

const base = {
  jobType: 'fulfillment.work.relaySweep',
  payload: { schemaVersion: 1 },
  idempotencyKey: 'manual:relay-sweep:1',
};

const connectionIdErrors = (connectionId: unknown): string[] =>
  validateSync(plainToInstance(EnqueueSyncJobDto, { ...base, connectionId }))
    .filter((error) => error.property === 'connectionId')
    .flatMap((error) => Object.values(error.constraints ?? {}));

describe('EnqueueSyncJobDto connectionId', () => {
  it('should accept the nil UUID when a system-scoped job is triggered by hand', () => {
    expect(connectionIdErrors('00000000-0000-0000-0000-000000000000')).toEqual([]);
  });

  it('should accept an ordinary v4 connection id when a connection-scoped job is triggered', () => {
    expect(connectionIdErrors('123e4567-e89b-42d3-a456-426614174000')).toEqual([]);
  });

  it.each(['not-a-uuid', '', '00000000-0000-0000-0000-00000000000', 42])(
    'should reject %p when it is not a UUID',
    (connectionId) => {
      expect(connectionIdErrors(connectionId)).toContain('connectionId must be a valid UUID');
    }
  );
});
