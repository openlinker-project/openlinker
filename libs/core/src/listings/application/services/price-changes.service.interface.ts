/**
 * Price Changes Service Interface (#3145, ADR-072)
 *
 * @module libs/core/src/listings/application/services
 */
import type { PriceChangeEpisodeFilters } from '../../domain/types/price-change-episode.types';
import type { PriceChangeAutoAppliedLogEntry } from '../../domain/entities/price-change-auto-applied-log-entry.entity';
import type { PriceChangeQueuePage } from '../types/price-change-queue-item.types';

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

export interface BulkAcceptItemInput {
  id: string;
  optInAutomatic?: boolean;
}

export interface BulkAcceptResult {
  batchId: string;
  totalCount: number;
}

export interface IPriceChangesService {
  listOpen(filters: PriceChangeEpisodeFilters): Promise<PriceChangeQueuePage>;
  countOpen(filters: PriceChangeEpisodeFilters): Promise<number>;

  accept(episodeId: string, input: AcceptPriceChangeInput): Promise<void>;
  ignore(episodeId: string, resolvedByUserId: string | null): Promise<void>;
  /** Re-opens a previously-`ignored` episode (the review queue's row Undo). */
  unresolve(episodeId: string): Promise<void>;
  edit(episodeId: string, input: EditPriceChangeInput): Promise<void>;
  bulkAccept(items: BulkAcceptItemInput[], resolvedByUserId: string | null): Promise<BulkAcceptResult>;

  listAutoApplied(limit: number): Promise<readonly PriceChangeAutoAppliedLogEntry[]>;
}
