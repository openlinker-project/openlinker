/**
 * Price Change Episode Repository Port (#3142, ADR-072)
 *
 * The persistence contract for `price_change_episodes`.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { PriceChangeEpisode } from '../entities/price-change-episode.entity';
import type {
  PriceChangeEpisodeFilters,
  PriceChangeResolution,
  UpsertOpenPriceChangeEpisodeInput,
} from '../types/price-change-episode.types';

export interface PriceChangeEpisodeRepositoryPort {
  findById(id: string): Promise<PriceChangeEpisode | null>;

  /** The one open episode for this key, or `null` if none exists. */
  findOpenByKey(
    productVariantId: string,
    destinationConnectionId: string,
    sourceConnectionId: string
  ): Promise<PriceChangeEpisode | null>;

  /**
   * The most recently RESOLVED episode for this key — the "last applied
   * price" baseline detection falls back to when no episode is currently open
   * (#3143's assumption).
   */
  findLastResolvedByKey(
    productVariantId: string,
    destinationConnectionId: string,
    sourceConnectionId: string
  ): Promise<PriceChangeEpisode | null>;

  /**
   * Open a new episode, or update the SAME open row if one already exists for
   * this key (the episode-pattern conflict-arm write, mirroring
   * `ReservationShortfallRepositoryPort.openEpisode`'s `ON CONFLICT DO UPDATE`
   * shape against the partial unique index).
   *
   * Returns the resulting row plus whether this call REFRESHED an
   * already-open episode (as opposed to opening a fresh one) — the caller
   * uses that to decide whether to stamp `refreshedAt` (#3143's staleness
   * marker), which only makes sense on the refresh path.
   */
  upsertOpen(
    input: UpsertOpenPriceChangeEpisodeInput
  ): Promise<{ episode: PriceChangeEpisode; wasRefresh: boolean }>;

  /** Every open episode for a destination connection, paged + filtered for the review queue. */
  findOpenForConnection(
    destinationConnectionId: string,
    filters?: PriceChangeEpisodeFilters
  ): Promise<readonly PriceChangeEpisode[]>;

  /** Every open episode across the install (no destination scope) for the review queue's "All" filter. */
  findOpenAll(filters?: PriceChangeEpisodeFilters): Promise<readonly PriceChangeEpisode[]>;

  /**
   * Resolve an OPEN episode. Guarded `WHERE "resolvedAt" IS NULL` so a
   * concurrent resolution cannot be overwritten; `false` means it was already
   * resolved (or never existed).
   */
  resolve(
    id: string,
    resolution: PriceChangeResolution,
    resolvedByUserId: string | null,
    manualPriceOverride: number | null,
    resolvedAt: Date
  ): Promise<boolean>;

  /**
   * Re-open a previously-`ignored` episode (the review queue's row-level
   * Undo, #3147/#3145). Guarded to only reverse an `'ignored'` resolution —
   * an already-published price is never un-published by this call.
   */
  reopenIgnored(id: string): Promise<boolean>;

  /** Count of open episodes matching the filters, for badge/tab counters. */
  countOpen(filters?: PriceChangeEpisodeFilters): Promise<number>;
}
