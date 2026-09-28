/**
 * Stream Dead Letter Repository Port
 *
 * Persistence contract for `stream_dead_letters` (#2301, D48). Implemented by
 * `StreamDeadLetterRepository`; consumed by `StreamDeadLettersService`.
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
