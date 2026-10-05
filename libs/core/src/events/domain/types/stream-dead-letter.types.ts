/**
 * Stream Dead Letter Types
 *
 * The durable record a Redis Streams consumer writes when one entry has
 * failed recovery `MAX_RECOVERY_ATTEMPTS` times (#2301, D48). See
 * `RecoveryAttemptTracker` in `@openlinker/shared/redis` for the Redis-backed
 * counter that decides when this record is written, and
 * `StreamDeadLetterRepositoryPort` for the persistence contract this type
 * serves.
 *
 * `rawFields` is deliberately `Record<string, string>` — exactly the shape
 * `XRANGE`/`XPENDING` hand back — never a typed payload. A typed payload is
 * precisely what could NOT be built from a raw pending entry (job-intake
 * needs a parsed job request, the master-deletion handler a decoded domain
 * event), which is the whole reason auto-dead-lettering was previously
 * rejected (see ADR-049's Known-gap section). Storing the raw fields removes
 * that objection: nothing needs to be parsed to persist them.
 *
 * @module libs/core/src/events/domain/types
 */

/** One durable dead-letter record, as read back from storage. */
export interface StreamDeadLetter {
  readonly id: string;
  /** The Redis stream key, e.g. `jobs.sync` or `events.master.deletion`. */
  readonly stream: string;
  /**
   * The consumer group that owned the entry.
   *
   * Named `consumerGroup`, never `group` — a bare `group` column needs
   * quoting everywhere in Postgres (`GROUP` is a reserved keyword), which is
   * exactly the kind of friction a schema should not carry when a
   * non-reserved name says the same thing.
   */
  readonly consumerGroup: string;
  /** The stream entry id (`<ms>-<seq>`), unique within `stream`. */
  readonly entryId: string;
  /** The raw field/value pairs as read from the stream — never parsed. */
  readonly rawFields: Record<string, string>;
  /** How many recovery attempts had failed when this row was last written. */
  readonly attempts: number;
  /** The most recent failure's error message. */
  readonly lastError: string;
  /** When this entry first crossed the dead-letter threshold. */
  readonly firstSeenAt: Date;
  /**
   * The most recent write to this row.
   *
   * Distinct from `firstSeenAt` because the write is a retriable upsert
   * (#2301, D48 point 3): if the XACK following a successful insert fails —
   * a crash between the two — the entry stays in the Pending Entries List,
   * gets redelivered, and a later failure re-attempts the SAME insert-then-
   * ack sequence. `lastSeenAt` moves on every such attempt; `firstSeenAt`
   * never does.
   */
  readonly lastSeenAt: Date;
}

/** What a consumer supplies when writing (or re-writing) a dead-letter row. */
export interface CreateStreamDeadLetterInput {
  readonly stream: string;
  readonly consumerGroup: string;
  readonly entryId: string;
  readonly rawFields: Record<string, string>;
  readonly attempts: number;
  readonly lastError: string;
}

/** Filters for the operator-facing read (Diagnostics > Jobs & Logs). */
export interface StreamDeadLetterFilters {
  readonly stream?: string;
}

/** `{ limit, offset }` in, matching `SyncJobPagination`. */
export interface StreamDeadLetterPagination {
  readonly limit: number;
  readonly offset: number;
}

/** `{ items, total }` out, matching `PaginatedSyncJobs`. */
export interface PaginatedStreamDeadLetters {
  readonly items: readonly StreamDeadLetter[];
  readonly total: number;
}
