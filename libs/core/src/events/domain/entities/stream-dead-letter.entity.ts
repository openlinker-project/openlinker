/**
 * Stream Dead Letter Domain Entity
 *
 * The durable record of a Redis Streams entry that failed recovery past
 * `MAX_RECOVERY_ATTEMPTS` (#2301, D48). Anemic by construction (ADR-011) —
 * nothing here decides WHEN a dead letter is written; that decision belongs
 * to the consumer holding the Redis-backed attempt counter
 * (`RecoveryAttemptTracker`, `@openlinker/shared/redis`).
 *
 * @module libs/core/src/events/domain/entities
 */

export class StreamDeadLetter {
  constructor(
    public readonly id: string,
    public readonly stream: string,
    public readonly consumerGroup: string,
    public readonly entryId: string,
    public readonly rawFields: Record<string, string>,
    public readonly attempts: number,
    public readonly lastError: string,
    public readonly firstSeenAt: Date,
    public readonly lastSeenAt: Date
  ) {}
}
