/**
 * Destination Taxonomy Sync Handler (#1979, ADR-037)
 *
 * Thin delegate for jobs of type `destination.taxonomy.sync`. Refreshes one page
 * of a destination's category tree via core `DestinationTaxonomyService` and
 * persists the resumable frontier on the connection cursor so the next run
 * continues where this one stopped. Structurally mirrors
 * `ShopProductStatusSyncHandler`.
 *
 * The handler — not the core service — owns cursor I/O. A cross-context
 * repository-port import from `listings` into `sync` is forbidden (see
 * `docs/architecture-overview.md` § Cross-context dependencies in core), and
 * keeping the cursor here also leaves the core sync a pure function of the
 * frontier handed to it, so resumability is unit-testable with no cursor double.
 *
 * This is the worker's first taxonomy touch — the concrete reason the read model
 * could not stay in `apps/api`.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  DestinationTaxonomySyncPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, SYNC_CURSORS_SERVICE_TOKEN } from '@openlinker/core/sync';
import { ISyncCursorsService } from '@openlinker/core/sync';
import {
  IDestinationTaxonomyService,
  DESTINATION_TAXONOMY_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const CURSOR_KEY_PREFIX = 'destination.taxonomy.frontier';

/**
 * Scope the cursor key by taxonomy owner, not just by connection.
 *
 * A marketplace run's real subject is the OWNER, but the cursor row is keyed by
 * `(connectionId, cursorKey)` and the scheduler elects a source connection per
 * owner. Suffixing the key keeps two owners from sharing one frontier if a
 * connection's resolved owner ever changes. It does NOT make the frontier
 * portable across a re-election — that is bounded by the core service's
 * frontier-age guard, which restarts a stale run so the watermark sweep stays
 * effective (#2061 makes the run owner-portable). A connection-scoped (shop) run keeps its own suffix.
 *
 * The owner passed here MUST come from the same authority that scopes the
 * sweep — `IDestinationTaxonomyService.resolveScope`, never the job payload.
 * See `execute` for why (#2063).
 */
function cursorKeyFor(taxonomyOwner: string | null, connectionId: string): string {
  return taxonomyOwner !== null
    ? `${CURSOR_KEY_PREFIX}:owner:${taxonomyOwner}`
    : `${CURSOR_KEY_PREFIX}:connection:${connectionId}`;
}

@Injectable()
export class DestinationTaxonomySyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(DestinationTaxonomySyncHandler.name);

  constructor(
    @Inject(DESTINATION_TAXONOMY_SERVICE_TOKEN)
    private readonly taxonomyService: IDestinationTaxonomyService,
    // `ISyncCursorsService`, not `ConnectionCursorRepositoryPort`: a repository
    // port is an intra-context contract, and reaching across to `sync`'s would
    // trip `check-cross-context-imports`. The older handlers that do so are
    // allow-listed tech debt pending exactly this rewire (#718) — not a pattern
    // to copy.
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    try {
      // Resolve the scope FIRST, and key the cursor off THAT — not off
      // `payload.taxonomyOwner`, which is only what the scheduler resolved at
      // enqueue time (#2063).
      //
      // Until #2063 the owner derived from `platformType` and was effectively
      // immutable, so payload and resolution could not disagree. Now it derives
      // from mutable connection config (Allegro's `environment`), so an operator
      // flipping that between enqueue and execution — or a retry landing after
      // the flip — would have the handler resume the OTHER scope's frontier:
      // `syncTaxonomy` re-resolves the scope internally and sweeps it, so the
      // run would complete early against a frontier it never built and then
      // delete every row that truncated walk failed to re-stamp.
      //
      // Costs one extra capability resolution per job (memoised per connection
      // inside the service, hourly per owner) to keep key and sweep on one
      // authority.
      const scope = await this.taxonomyService.resolveScope(job.connectionId);
      const cursorKey = cursorKeyFor(scope.taxonomyOwner, job.connectionId);
      const stored = await this.cursors.getCursor(job.connectionId, cursorKey);
      // Scalar since #2061: the cursor holds only the run watermark, and the
      // per-node progress is derived from the projection. Validation of the
      // value (parseable, fresh enough) belongs to the core service, which is
      // the thing that has to act on it.
      const runStartedAt = stored !== null && stored.length > 0 ? stored : null;

      this.logger.log(
        `Executing destination.taxonomy.sync job ${job.id} for connection ${job.connectionId} ` +
          `(owner=${scope.taxonomyOwner ?? 'connection-scoped'}, resuming=${String(runStartedAt !== null)})`,
      );

      if (payload.taxonomyOwner !== null && payload.taxonomyOwner !== scope.taxonomyOwner) {
        // Not fatal — the resolved scope is authoritative and the run is correct
        // under it — but it means the connection's identity moved after the
        // scheduler elected it, which is worth seeing in the log.
        this.logger.warn(
          `Taxonomy owner changed since enqueue (job ${job.id}, connection ${job.connectionId}): ` +
            `payload=${payload.taxonomyOwner}, resolved=${scope.taxonomyOwner ?? 'connection-scoped'}`,
        );
      }

      const result = await this.taxonomyService.syncTaxonomy(job.connectionId, {
        runStartedAt,
        pageLimit: payload.pageLimit,
      });

      if (result.nextRunStartedAt === null) {
        // Completed: clear the cursor so the next tick starts a fresh run with
        // a new watermark, rather than resuming an already-swept one.
        await this.cursors.advanceCursor(job.connectionId, cursorKey, '');
      } else {
        await this.cursors.advanceCursor(job.connectionId, cursorKey, result.nextRunStartedAt);
      }

      this.logger.log(
        `destination.taxonomy.sync completed (connection=${job.connectionId}): ` +
          `upserted=${result.upserted}, removed=${result.removed}, done=${String(result.completed)}`,
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Destination taxonomy sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): DestinationTaxonomySyncPayloadV1 {
    const payload = job.payload as unknown as Partial<DestinationTaxonomySyncPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return {
      schemaVersion: 1,
      taxonomyOwner: typeof payload.taxonomyOwner === 'string' ? payload.taxonomyOwner : null,
      pageLimit:
        typeof payload.pageLimit === 'number' && payload.pageLimit > 0
          ? payload.pageLimit
          : undefined,
    };
  }

}
