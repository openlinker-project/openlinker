/**
 * Stream Dead Letter Repository Port
 *
 * Persistence contract for `stream_dead_letters` (#2301, D48). Implemented by
 * `StreamDeadLetterRepository`; consumed by `StreamDeadLettersService`.
 *
 * **No retention method, deliberately deferred.** Nothing prunes this table,
 * unlike `sync_jobs` (`SyncJobRetentionService`), and that is a decision
 * rather than an omission. The table is bounded in practice by the retry
 * ceiling: a row exists only after one stream entry has failed
 * `MAX_RECOVERY_ATTEMPTS` (10) recovery passes, which is at least ~50 minutes
 * of continuous failure, and a re-write upserts the same row. So it grows with
 * the number of distinct poisoned entries, not with traffic, which is the
 * per-tick growth axis that made `sync_jobs` need a sweep. Add a sweep (an
 * age bound on `lastSeenAt`, which `IDX_stream_dead_letters_last_seen_at`
 * already serves) once rows arrive faster than operators triage them, e.g. a
 * handler bug that poisons a whole class of entries, or once a replay/resolve
 * action gives a row a handled state that a sweep could key on safely.
 *
 * @module libs/core/src/events/domain/ports
 */
import type { StreamDeadLetter } from '../entities/stream-dead-letter.entity';
import type {
  CreateStreamDeadLetterInput,
  PaginatedStreamDeadLetters,
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from '../types/stream-dead-letter.types';

export interface StreamDeadLetterRepositoryPort {
  /**
   * Write (or re-write) one dead-letter row, keyed by
   * `(stream, consumerGroup, entryId)`.
   *
   * An UPSERT, not a plain insert (#2301, D48 point 3): the write and the
   * `XACK` that follows it are two separate operations, and a crash between
   * them leaves the entry pending — Redis redelivers it, it fails again, and
   * the SAME `(stream, consumerGroup, entryId)` reaches this method a second
   * time. `firstSeenAt` is preserved across re-writes (only ever set on the
   * FIRST insert); `attempts`, `lastError` and `lastSeenAt` are overwritten
   * on every call, so the row always reflects the most recent attempt.
   *
   * The caller (the consumer) is what makes this safe to retry: it only
   * calls `XACK` — and thereby stops calling this method for that entry —
   * once this write has committed. See `RecoveryAttemptTracker`'s docblock
   * for the full write-then-ack ordering.
   */
  upsert(input: CreateStreamDeadLetterInput): Promise<StreamDeadLetter>;

  /** Paginated, most-recently-seen-first read for the Diagnostics surface. */
  findMany(
    filters: StreamDeadLetterFilters,
    pagination: StreamDeadLetterPagination
  ): Promise<PaginatedStreamDeadLetters>;

  /** Total count, same filters, no pagination — the Diagnostics count badge. */
  count(filters: StreamDeadLetterFilters): Promise<number>;
}
