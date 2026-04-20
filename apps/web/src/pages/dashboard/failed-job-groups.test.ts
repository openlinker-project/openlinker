import { describe, expect, it } from 'vitest';
import {
  groupFailedJobs,
  summarizeFailuresByConnection,
} from './failed-job-groups';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';

function makeJob(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: 'job_1',
    jobType: 'master.inventory.syncByExternalId',
    connectionId: 'conn_a',
    status: 'dead',
    attempts: 10,
    maxAttempts: 10,
    nextRunAt: '2026-04-20T10:00:00.000Z',
    lastError: 'insert or update on table inventory_items violates foreign key constraint',
    payloadJson: null,
    idempotencyKey: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: '2026-04-20T09:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupFailedJobs', () => {
  it('collapses jobs that share connection + job type into one row', () => {
    const jobs = [
      makeJob({ id: '1', connectionId: 'conn_a', jobType: 'master.inventory.syncByExternalId' }),
      makeJob({ id: '2', connectionId: 'conn_a', jobType: 'master.inventory.syncByExternalId' }),
      makeJob({ id: '3', connectionId: 'conn_a', jobType: 'master.inventory.syncByExternalId' }),
    ];
    const groups = groupFailedJobs(jobs);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].key).toBe('conn_a::master.inventory.syncByExternalId');
  });

  it('keeps separate groups for different connections with the same job type', () => {
    const jobs = [
      makeJob({ id: '1', connectionId: 'conn_a' }),
      makeJob({ id: '2', connectionId: 'conn_b' }),
    ];
    const groups = groupFailedJobs(jobs);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.connectionId).sort()).toEqual(['conn_a', 'conn_b']);
  });

  it('sorts groups by failure count descending', () => {
    const jobs = [
      makeJob({ id: '1', connectionId: 'c1', jobType: 'a' }),
      makeJob({ id: '2', connectionId: 'c1', jobType: 'a' }),
      makeJob({ id: '3', connectionId: 'c2', jobType: 'b' }),
      makeJob({ id: '4', connectionId: 'c3', jobType: 'c' }),
      makeJob({ id: '5', connectionId: 'c3', jobType: 'c' }),
      makeJob({ id: '6', connectionId: 'c3', jobType: 'c' }),
    ];
    const groups = groupFailedJobs(jobs);
    expect(groups.map((g) => g.count)).toEqual([3, 2, 1]);
  });

  it('picks the most recently updated job as the representative', () => {
    const jobs = [
      makeJob({ id: 'old', updatedAt: '2026-04-20T08:00:00.000Z', lastError: 'old error' }),
      makeJob({ id: 'new', updatedAt: '2026-04-20T12:00:00.000Z', lastError: 'new error' }),
      makeJob({ id: 'mid', updatedAt: '2026-04-20T10:00:00.000Z', lastError: 'mid error' }),
    ];
    const [group] = groupFailedJobs(jobs);
    expect(group.representative.id).toBe('new');
    expect(group.lastError).toBe('new error');
    expect(group.latestUpdatedAt).toBe('2026-04-20T12:00:00.000Z');
  });

  it('returns an empty array when given no jobs', () => {
    expect(groupFailedJobs([])).toEqual([]);
  });
});

describe('summarizeFailuresByConnection', () => {
  it('tallies dead-job counts per connection', () => {
    const jobs = [
      makeJob({ id: '1', connectionId: 'c1' }),
      makeJob({ id: '2', connectionId: 'c1' }),
      makeJob({ id: '3', connectionId: 'c2' }),
    ];
    const summary = summarizeFailuresByConnection(jobs);
    expect(summary.get('c1')?.deadJobCount).toBe(2);
    expect(summary.get('c2')?.deadJobCount).toBe(1);
  });

  it('returns an empty map when no jobs are failing', () => {
    expect(summarizeFailuresByConnection([])).toEqual(new Map());
  });
});
