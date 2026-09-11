/**
 * Price Changes Service Interface (#3145, ADR-072)
 *
 * @module libs/core/src/listings/application/services
 */
import type { PriceChangeEpisodeFilters } from '../../domain/types/price-change-episode.types';
import type { PriceChangeAutoAppliedLogEntry } from '../../domain/entities/price-change-auto-applied-log-entry.entity';
import type { PriceChangeQueueItem, PriceChangeQueuePage } from '../types/price-change-queue-item.types';

export interface AcceptPriceChangeInput {
  /**
   * The version token last read by the caller (staleness guard) —
   * REQUIRED (#3162 re-review, BLOCKING): `accept` publishes
   * `episode.computedNewAmount`, a value that MOVES on re-detection, so a
   * caller that omitted this could publish a price the operator never
   * actually saw, stamped with THAT operator's `resolvedByUserId`. #2610's
   * rule is that the refusal must be server-side, never only in a form —
   * enforced here at the DTO (`AcceptPriceChangeDto.expectedVersion` is no
   * longer `@IsOptional()`), which is what makes this field genuinely
   * mandatory by the time it reaches this interface rather than merely
   * documented as such.
   */
  expectedVersion: string;
  /** Also set this (destination, source) pair to `automatic` (ADR-072 decision 3). */
  optInAutomatic?: boolean;
  resolvedByUserId: string | null;
}

export interface EditPriceChangeInput {
  manualPriceOverride: number;
  /**
   * Deliberately OPTIONAL, unlike `AcceptPriceChangeInput.expectedVersion`
   * (#3162 re-review, BLOCKING finding's stated exception): `edit` publishes
   * `manualPriceOverride`, an ABSOLUTE number the OPERATOR typed, not a
   * value that can silently drift out from under them the way `accept`'s
   * `computedNewAmount` can — so omitting the staleness check here cannot
   * publish a price the operator never intended. The `isOpen`/`blockReason`
   * checks in `assertActionable` still apply unconditionally either way.
   */
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
  /**
   * The version token last read by the caller (staleness guard) — mirrors
   * `AcceptPriceChangeInput.expectedVersion` and is REQUIRED for the same
   * reason (#3162 re-review, BLOCKING): every bulk item publishes its
   * episode's `computedNewAmount`, never an operator-typed absolute number.
   */
  expectedVersion: string;
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

  /**
   * Open-episode count per source connection, for a single destination
   * (#3163 review — the connection Pricing & Sync page's `sources[]` read).
   * One `GROUP BY`, never one `countOpen` call per source in a loop.
   */
  countOpenBySource(destinationConnectionId: string): Promise<ReadonlyMap<string, number>>;

  /**
   * Distinct destination connection ids with an open episode sourced from
   * `sourceConnectionId` (#3163 review — the "as source" read-only rollup,
   * ADR-072 decision 2). Ids only, never hydrated episode rows.
   */
  listOpenDestinationConnectionIds(sourceConnectionId: string): Promise<readonly string[]>;

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
