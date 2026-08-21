/**
 * Webhook Job Gate Repository Unit Tests
 *
 * Pins the transactional shape of the durable webhook spine (#2280): both
 * inserts inside one `dataSource.transaction`, job insert FIRST (so the
 * delivery row carries the real id and a replay against a job-less legacy row
 * self-heals the job), `ON CONFLICT DO NOTHING` + in-transaction SELECT for
 * the idempotency-key dedup (never the catch-based dedup, which would abort
 * the surrounding transaction), and `isNew` derived from the delivery insert's
 * RETURNING row count. The real-Postgres behaviour is covered by
 * `apps/api/test/integration/webhook-ingestion.int-spec.ts`.
 *
 * @module apps/api/src/webhooks/infrastructure/persistence
 */
import type { DataSource, EntityManager } from 'typeorm';
import type { SyncJobRequest } from '@openlinker/core/sync';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import { WebhookJobGateRepository } from './webhook-job-gate.repository';

const connectionId = '123e4567-e89b-12d3-a456-426614174000';

const delivery: WebhookDeliveryUpsertInput = {
  eventId: 'e1',
  provider: 'prestashop',
  connectionId,
  eventType: 'product.saved',
  objectType: 'product',
  externalId: '12345',
  receivedAt: new Date('2026-06-08T10:00:00.000Z'),
  signatureValid: true,
  dedupResult: 'new',
  status: 'job_enqueued',
  payload: { name: 'Test' },
};

const job: SyncJobRequest = {
  jobType: 'master.product.syncByExternalId',
  connectionId,
  payload: { schemaVersion: 1, externalId: '12345', objectType: 'Product' },
  idempotencyKey: `prestashop:${connectionId}:e1`,
};

describe('WebhookJobGateRepository', () => {
  let repository: WebhookJobGateRepository;
  let managerQuery: jest.Mock;

  beforeEach(() => {
    managerQuery = jest.fn();
    const manager = { query: managerQuery } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        async (fn: (manager: EntityManager) => Promise<unknown>) => fn(manager)
      ),
    } as unknown as DataSource;
    repository = new WebhookJobGateRepository(dataSource);
  });

  it('inserts the job FIRST, then the delivery row carrying the returned job id', async () => {
    managerQuery
      .mockResolvedValueOnce([{ id: 'job-uuid-1' }]) // sync_jobs insert
      .mockResolvedValueOnce([{ id: 'delivery-uuid-1' }]); // webhook_deliveries insert

    const result = await repository.insertDeliveryWithJob(delivery, job);

    expect(result).toEqual({ isNew: true, jobId: 'job-uuid-1' });
    const [jobSql, jobParams] = managerQuery.mock.calls[0] as [string, unknown[]];
    expect(jobSql).toContain('INSERT INTO sync_jobs');
    expect(jobSql).toContain('ON CONFLICT ("idempotencyKey") DO NOTHING');
    expect(jobParams).toContain(job.idempotencyKey);
    const [deliverySql, deliveryParams] = managerQuery.mock.calls[1] as [string, unknown[]];
    expect(deliverySql).toContain('INSERT INTO webhook_deliveries');
    expect(deliverySql).toContain('ON CONFLICT ("provider", "connectionId", "eventId") DO NOTHING');
    expect(deliveryParams).toContain('job-uuid-1');
  });

  it('recovers the winning job id via an in-transaction SELECT when the idempotency key conflicts', async () => {
    managerQuery
      .mockResolvedValueOnce([]) // sync_jobs insert conflicted
      .mockResolvedValueOnce([{ id: 'job-uuid-existing' }]) // SELECT by idempotencyKey
      .mockResolvedValueOnce([{ id: 'delivery-uuid-1' }]);

    const result = await repository.insertDeliveryWithJob(delivery, job);

    expect(result).toEqual({ isNew: true, jobId: 'job-uuid-existing' });
    const [selectSql] = managerQuery.mock.calls[1] as [string, unknown[]];
    expect(selectSql).toContain('SELECT id FROM sync_jobs');
  });

  it('reports isNew: false on a delivery replay while still returning the (self-healed) job id', async () => {
    managerQuery
      .mockResolvedValueOnce([{ id: 'job-uuid-1' }])
      .mockResolvedValueOnce([]); // delivery insert conflicted → replay

    const result = await repository.insertDeliveryWithJob(delivery, job);

    expect(result).toEqual({ isNew: false, jobId: 'job-uuid-1' });
  });

  it('inserts only the delivery row (no job statement) for a jobless outcome', async () => {
    managerQuery.mockResolvedValueOnce([{ id: 'delivery-uuid-1' }]);

    const result = await repository.insertDeliveryWithJob(
      { ...delivery, status: 'received' },
      null
    );

    expect(result).toEqual({ isNew: true, jobId: null });
    expect(managerQuery).toHaveBeenCalledTimes(1);
    const [sql] = managerQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO webhook_deliveries');
  });

  it('surfaces the unreachable conflict-then-no-row case instead of inventing a job id', async () => {
    managerQuery
      .mockResolvedValueOnce([]) // insert conflicted
      .mockResolvedValueOnce([]); // and the SELECT found nothing

    await expect(repository.insertDeliveryWithJob(delivery, job)).rejects.toThrow(
      /no row was found/
    );
  });
});
