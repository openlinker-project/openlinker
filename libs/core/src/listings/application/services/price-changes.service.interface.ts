/**
 * Price Changes Service Interface (#3145, ADR-072)
 *
 * @module libs/core/src/listings/application/services
 */
import type { PriceChangeEpisodeFilters } from '../../domain/types/price-change-episode.types';
import type { PriceChangeAutoAppliedLogEntry } from '../../domain/entities/price-change-auto-applied-log-entry.entity';
import type { PriceChangeQueueItem, PriceChangeQueuePage } from '../types/price-change-queue-item.types';

export interface AcceptPriceChangeInput {
  /** The version token last read by the caller (staleness guard). */
  expectedVersion?: string;
  /** Also set this (destination, source) pair to `automatic` (ADR-072 decision 3). */
  optInAutomatic?: boolean;
  resolvedByUserId: string | null;
}

export interface EditPriceChangeInput {
  manualPriceOverride: number;
  expectedVersion?: string;
  optInAutomatic?: boolean;
  resolvedByUserId: string | null;
}

/**
 * The (destination, source) pair a caller must flip to `automatic` when
 * `optInAutomatic` was requested (#3162 review).
 *
 * This service NEVER writes `Connection.config` itself — that write must go
 * through `IConnectionService` (validation: `validateStockAndPricingConfig`
 * / `validateConfigShape`; concurrency-safety against a full-row
 * read-modify-write `save()`), which is an APP-LAYER construct
 * (`apps/api/src/integrations`) this CORE service may not depend on without
 * inverting the core→app dependency direction. So `accept`/`edit`/
 * `bulkAccept` only REPORT which pair(s) requested the opt-in; the caller
 * (the HTTP controller, which already sits in `apps/api` and can inject
 * `IConnectionService`) performs the actual mutation, locked per connection.
 */
export interface PriceChangeConnectionPair {
  destinationConnectionId: string;
  sourceConnectionId: string;
}

export interface PriceChangeResolutionResult {
  /** Present only when `optInAutomatic` was requested on this call. */
  optInPair?: PriceChangeConnectionPair;
}

export interface BulkAcceptItemInput {
  id: string;
  optInAutomatic?: boolean;
  /** The version token last read by the caller (staleness guard) — mirrors the single-accept path (#3162 review: bulk previously skipped this entirely). */
  expectedVersion?: string;
}

export interface BulkAcceptResult {
  batchId: string;
  totalCount: number;
  /**
   * Deduplicated (destination, source) pairs across every item that
   * requested `optInAutomatic` — the caller flips each pair exactly once
   * via `IConnectionService`, never once per episode (#3162 review).
   */
  optInPairs: readonly PriceChangeConnectionPair[];
}

export interface IPriceChangesService {
  listOpen(filters: PriceChangeEpisodeFilters): Promise<PriceChangeQueuePage>;
  countOpen(filters: PriceChangeEpisodeFilters): Promise<number>;

  accept(episodeId: string, input: AcceptPriceChangeInput): Promise<PriceChangeResolutionResult>;
  ignore(episodeId: string, resolvedByUserId: string | null): Promise<void>;
  /** Re-opens a previously-`ignored` episode (the review queue's row Undo). */
  unresolve(episodeId: string): Promise<void>;
  edit(episodeId: string, input: EditPriceChangeInput): Promise<PriceChangeResolutionResult>;
  bulkAccept(items: BulkAcceptItemInput[], resolvedByUserId: string | null): Promise<BulkAcceptResult>;

  /**
   * Acknowledge a re-detection on an open episode — clears the sticky
   * `needsRefresh` marker and returns the enriched row as it now stands
   * (#3162 review: the mockup's per-row Refresh action, `#refresh-{id}`).
   */
  refresh(episodeId: string): Promise<PriceChangeQueueItem>;

  listAutoApplied(limit: number): Promise<readonly PriceChangeAutoAppliedLogEntry[]>;
}
