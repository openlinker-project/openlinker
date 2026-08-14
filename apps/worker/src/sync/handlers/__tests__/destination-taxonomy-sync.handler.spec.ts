/**
 * Destination Taxonomy Sync Handler Tests (#1979, #2063)
 *
 * The load-bearing assertion here is that the cursor key is derived from the
 * RESOLVED scope, never from `payload.taxonomyOwner`. Since #2063 the owner
 * derives from mutable connection config, so the two can disagree — and keying
 * the frontier off the payload while the watermark sweep is scoped to the
 * resolution would let a run complete early against a frontier it never built
 * and then delete everything that truncated walk failed to re-stamp.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { DestinationTaxonomySyncHandler } from '../destination-taxonomy-sync.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob as SyncJobEntity } from '@openlinker/core/sync';
import type { TaxonomyScope, TaxonomySyncResult } from '@openlinker/core/listings';

describe('DestinationTaxonomySyncHandler', () => {
  let handler: DestinationTaxonomySyncHandler;
  let taxonomyService: { syncTaxonomy: jest.Mock; resolveScope: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };

  const OWNER_SCOPE: TaxonomyScope = { taxonomyOwner: 'allegro', connectionId: null };
  const SANDBOX_SCOPE: TaxonomyScope = { taxonomyOwner: 'allegro:sandbox', connectionId: null };
  const SHOP_SCOPE: TaxonomyScope = { taxonomyOwner: null, connectionId: 'conn-1' };

  const completedResult: TaxonomySyncResult = {
    upserted: 3,
    removed: 0,
    completed: true,
    nextRunStartedAt: null,
  };

  const partialResult: TaxonomySyncResult = {
    upserted: 3,
    removed: 0,
    completed: false,
    nextRunStartedAt: '2026-08-13T10:00:00.000Z',
  };

  const createJob = (payload: Record<string, unknown>): SyncJobEntity =>
    ({
      id: 'job-1',
      jobType: 'destination.taxonomy.sync',
      connectionId: 'conn-1',
      payload,
    }) as unknown as SyncJobEntity;

  beforeEach(() => {
    taxonomyService = {
      syncTaxonomy: jest.fn().mockResolvedValue(completedResult),
      resolveScope: jest.fn().mockResolvedValue(OWNER_SCOPE),
    };
    cursors = { getCursor: jest.fn().mockResolvedValue(null), advanceCursor: jest.fn() };

    handler = new DestinationTaxonomySyncHandler(taxonomyService as never, cursors as never);
  });

  it('should key the cursor by the resolved owner', async () => {
    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(cursors.getCursor).toHaveBeenCalledWith(
      'conn-1',
      'destination.taxonomy.frontier:owner:allegro',
    );
  });

  it('should key the cursor by the RESOLVED owner when the payload disagrees', async () => {
    // The #2063 hazard: an operator flips `environment` between enqueue and
    // execution. `syncTaxonomy` re-resolves and sweeps the sandbox scope, so
    // the frontier must be read from the sandbox key — resuming the production
    // walk here would complete a run that never visited the sandbox tree and
    // then sweep it away.
    taxonomyService.resolveScope.mockResolvedValue(SANDBOX_SCOPE);

    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(cursors.getCursor).toHaveBeenCalledWith(
      'conn-1',
      'destination.taxonomy.frontier:owner:allegro:sandbox',
    );
    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      'conn-1',
      'destination.taxonomy.frontier:owner:allegro:sandbox',
      '',
    );
  });

  it('should key the cursor by connection for a shop scope', async () => {
    taxonomyService.resolveScope.mockResolvedValue(SHOP_SCOPE);

    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: null }));

    expect(cursors.getCursor).toHaveBeenCalledWith(
      'conn-1',
      'destination.taxonomy.frontier:connection:conn-1',
    );
  });

  it('should clear the cursor when the run completes', async () => {
    // A completed run has already swept against its watermark; resuming it
    // would sweep a second time against a watermark nothing re-stamped.
    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      'conn-1',
      'destination.taxonomy.frontier:owner:allegro',
      '',
    );
  });

  it('should persist the run watermark as a SCALAR when the run is incomplete', async () => {
    // The point of #2061: the cursor holds one value, not an id list, so the
    // operator-facing Cursors page renders something meaningful.
    taxonomyService.syncTaxonomy.mockResolvedValue(partialResult);

    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      'conn-1',
      'destination.taxonomy.frontier:owner:allegro',
      '2026-08-13T10:00:00.000Z',
    );
  });

  it('should resume a stored run watermark', async () => {
    cursors.getCursor.mockResolvedValue('2026-08-13T10:00:00.000Z');

    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(taxonomyService.syncTaxonomy).toHaveBeenCalledWith('conn-1', {
      runStartedAt: '2026-08-13T10:00:00.000Z',
      pageLimit: undefined,
    });
  });

  it('should pass an empty cursor through as a fresh run', async () => {
    cursors.getCursor.mockResolvedValue('');

    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(taxonomyService.syncTaxonomy).toHaveBeenCalledWith('conn-1', {
      runStartedAt: null,
      pageLimit: undefined,
    });
  });

  it('should hand a Wave 1 JSON frontier to the service rather than parsing it here', async () => {
    // Validation lives in the core service — it is what has to act on the value
    // (restart vs resume). The handler stays a transport for the cursor.
    cursors.getCursor.mockResolvedValue('{"runStartedAt":"2026-08-13T10:00:00.000Z","pending":["x"]}');

    await handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' }));

    expect(taxonomyService.syncTaxonomy).toHaveBeenCalledWith('conn-1', {
      runStartedAt: '{"runStartedAt":"2026-08-13T10:00:00.000Z","pending":["x"]}',
      pageLimit: undefined,
    });
  });

  it('should return an ok outcome', async () => {
    await expect(
      handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' })),
    ).resolves.toEqual({ outcome: 'ok' });
  });

  it('should wrap a scope-resolution failure in SyncJobExecutionError', async () => {
    // Resolution moved inside the try block when the key started depending on
    // it; without that the throw would escape unwrapped.
    taxonomyService.resolveScope.mockRejectedValue(new Error('no taxonomy source'));

    await expect(
      handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' })),
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should wrap a sync failure in SyncJobExecutionError', async () => {
    taxonomyService.syncTaxonomy.mockRejectedValue(new Error('boom'));

    await expect(
      handler.execute(createJob({ schemaVersion: 1, taxonomyOwner: 'allegro' })),
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should throw when the payload is missing', async () => {
    await expect(
      handler.execute({ id: 'job-1', jobType: 'destination.taxonomy.sync', connectionId: 'conn-1', payload: null } as unknown as SyncJobEntity),
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
