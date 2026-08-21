/**
 * Role Coverage Assertion Unit Tests
 *
 * Pins the `jobs`-role boot guard (#2279, ADR-051): a job type with no
 * registered handler fails the BOOT, naming the uncovered types — rather than
 * surfacing hours later as jobs aging into `dead`.
 *
 * @module apps/worker/src/sync
 */
import { JobTypeValues } from '@openlinker/core/sync';
import type { SyncJobHandlerRegistry } from '../handlers/sync-job-handler.registry';
import { RoleCoverageAssertionService } from '../role-coverage-assertion.service';

describe('RoleCoverageAssertionService', () => {
  const makeRegistry = (registered: readonly string[]): SyncJobHandlerRegistry =>
    ({
      getRegisteredJobTypes: jest.fn().mockReturnValue([...registered]),
    }) as unknown as SyncJobHandlerRegistry;

  it('passes when every job type has a handler', () => {
    const service = new RoleCoverageAssertionService(makeRegistry(JobTypeValues));

    expect(() => service.onApplicationBootstrap()).not.toThrow();
  });

  it('fails the boot naming each uncovered job type', () => {
    const covered = JobTypeValues.filter(
      (jobType) => jobType !== 'marketplace.order.sync' && jobType !== 'invoicing.issue'
    );
    const service = new RoleCoverageAssertionService(makeRegistry(covered));

    expect(() => service.onApplicationBootstrap()).toThrow(/marketplace\.order\.sync/);
    expect(() => service.onApplicationBootstrap()).toThrow(/invoicing\.issue/);
  });

  it('reports the uncovered count so the message is actionable at a glance', () => {
    const service = new RoleCoverageAssertionService(makeRegistry([]));

    expect(() => service.onApplicationBootstrap()).toThrow(
      new RegExp(`${JobTypeValues.length} job type\\(s\\) have no registered handler`)
    );
  });

  it('ignores an extra registered type that is not in the core vocabulary', () => {
    const service = new RoleCoverageAssertionService(
      makeRegistry([...JobTypeValues, 'plugin.custom.job'])
    );

    expect(() => service.onApplicationBootstrap()).not.toThrow();
  });
});
