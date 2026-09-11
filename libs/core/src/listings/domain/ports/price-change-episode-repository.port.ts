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

  /**
   * Batched `findById` (#3162 review — `bulkAccept` previously called
   * `findById` once per item in a loop; `docs/engineering-standards.md §
   * When A Paginated Total Is Expensive` / the #2083 rule: a batched read
   * happens ONCE, before the per-row loop, never inside it). Ids with no
   * matching row are simply absent from the result — never a thrown error,
   * since the caller (`loadActionable`) still needs its own not-found check
   * per id to report which one.
   */
  findByIds(ids: readonly string[]): Promise<readonly PriceChangeEpisode[]>;

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
   * **The conflict arm's write set IS the contract** (the
   * `ReturnRepositoryPort.upsertFromSource` precedent): it updates
   * `sourceNewAmount`, `computedNewAmount`, `sourceCurrency`, `blockReason`
   * and `updatedAt` — and DELIBERATELY never touches `sourceOldAmount`,
   * `computedOldAmount`, or `detectedAt`, which stay pinned to the episode's
   * ORIGINAL detection for the life of the row (#3159 depends on this by
   * name: those three describe when/at-what-price the condition first
   * arose, not its current state).
   *
   * Returns the resulting row plus whether this call's WRITE was the conflict
   * arm (an existing open row was updated) rather than a fresh INSERT —
   * `wasRefresh: true` does **not** by itself mean `episode.refreshedAt` was
   * (re-)stamped. `refreshedAt` is stamped by this SAME write, and only when
   * the conflict arm's incoming `sourceNewAmount` genuinely differs from what
   * was already stored — i.e. the price changed again while the episode
   * stood open, unreviewed (#3143's staleness marker). A conflict-arm write
   * that repeats an already-stored `sourceNewAmount` (e.g. the same source
   * price re-observed on the next poll) reports `wasRefresh: true` but leaves
   * `refreshedAt` exactly as it was.
   */
  upsertOpen(
    input: UpsertOpenPriceChangeEpisodeInput
  ): Promise<{ episode: PriceChangeEpisode; wasRefresh: boolean }>;

  /**
   * Open episodes for a destination connection, filtered for the review
   * queue. Bounded by `filters.limit`/`filters.offset` (#3162) — see
   * `countOpen` / `countOpenBySource` for the operator-facing counts.
   */
  findOpenForConnection(
    destinationConnectionId: string,
    filters?: PriceChangeEpisodeFilters
  ): Promise<readonly PriceChangeEpisode[]>;

  /**
   * Open episodes across the install (no destination scope) for the review
   * queue's "All" filter. Bounded, same as `findOpenForConnection`.
   */
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
   *
   * `false` means the row was not an ignored, resolved episode (already
   * accepted, still open, or unknown). A rival episode already open for the
   * same key — an operator ignoring E, then a later detection opening a
   * fresh F for the same key, then the operator clicking Undo on E — raises
   * `PriceChangeEpisodeSupersededError` rather than either returning `true`
   * (which would leave two open episodes for one key) or letting a raw
   * unique-violation escape the port.
   */
  reopenIgnored(id: string): Promise<boolean>;

  /**
   * Acknowledge a re-detection (#3162 review — `needsRefresh` must not be
   * sticky forever): clears `refreshedAt` back to `null` on an OPEN episode,
   * so the row's `version` collapses back onto `detectedAt` and the caller's
   * NEXT read reports `needsRefresh: false` for whatever it just re-fetched.
   *
   * Guarded `WHERE "resolvedAt" IS NULL` — a resolved episode's `refreshedAt`
   * is historical, not an actionable flag, and must not be touched here.
   *
   * Returns the refreshed row, or `null` if it does not exist or is no
   * longer open.
   */
  acknowledgeRefresh(id: string): Promise<PriceChangeEpisode | null>;

  /** Count of open episodes matching the filters, for badge/tab counters. */
  countOpen(filters?: PriceChangeEpisodeFilters): Promise<number>;

  /**
   * Open-episode count per source connection, for a single destination — one
   * `GROUP BY` read rather than one `countOpen` call per source in a loop
   * (`docs/engineering-standards.md § When A Paginated Total Is Expensive`;
   * the #2083 batched-read rule). Sources with zero open episodes are absent
   * from the map, never present with `0`.
   */
  countOpenBySource(destinationConnectionId: string): Promise<ReadonlyMap<string, number>>;
}
