/**
 * Worker Role Resolution Unit Tests
 *
 * Pins the `OL_WORKER_ROLE` contract (#2279, ADR-051): unset/empty/`all` boots
 * the full set (so an existing single-process deployment is unchanged by the
 * upgrade), a subset is parsed case- and whitespace-insensitively, and an
 * unknown role THROWS rather than being skipped — a typo in a split
 * deployment must not silently produce a worker that carries nothing.
 *
 * @module apps/worker/src/roles
 */
import { resolveWorkerRoles, WorkerRoleValues } from '../worker-role.types';

describe('resolveWorkerRoles', () => {
  it('boots every role when unset — an existing deployment is unchanged by the upgrade', () => {
    expect(resolveWorkerRoles(undefined)).toEqual(WorkerRoleValues);
  });

  it.each(['', '   ', 'all', 'ALL'])('boots every role for %p', (raw) => {
    expect(resolveWorkerRoles(raw)).toEqual(WorkerRoleValues);
  });

  it('parses a single role', () => {
    expect(resolveWorkerRoles('jobs')).toEqual(['jobs']);
  });

  it('parses a comma-separated subset, preserving the given order', () => {
    expect(resolveWorkerRoles('scheduler,jobs')).toEqual(['scheduler', 'jobs']);
  });

  it('tolerates whitespace and mixed case around role names', () => {
    expect(resolveWorkerRoles(' Jobs , EVENTS ')).toEqual(['jobs', 'events']);
  });

  it('de-duplicates a repeated role', () => {
    expect(resolveWorkerRoles('jobs,jobs')).toEqual(['jobs']);
  });

  it('throws naming the offending value on an unknown role, never skipping it', () => {
    expect(() => resolveWorkerRoles('jobs,scheduIer')).toThrow(/scheduier/i);
  });

  it('names the valid roles in the error so an operator can fix it without the source', () => {
    expect(() => resolveWorkerRoles('nonsense')).toThrow(
      /jobs, events, scheduler, maintenance/
    );
  });
});
