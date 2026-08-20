/**
 * Redis Stream Retention Policy
 *
 * Single source of the retention bound for every Redis stream the system writes
 * (#2163). `XACK` removes an entry from a Pending Entries List, not from the
 * stream, so a fully-acked stream still holds every entry it ever received —
 * retention is entirely the producer's job, and before this module it was almost
 * entirely absent: one of seven streams was bounded.
 *
 * Two design points carry the fix.
 *
 * **The default is fail-safe, not fail-open.** Previously a stream with no map
 * entry was left unbounded. Here an unregistered stream resolves
 * {@link DEFAULT_STREAM_BOUND}; {@link resolveStreamBound} has no `undefined`
 * branch, so "unbounded" is not a reachable state.
 *
 * **The bound lives above the write sites, not inside one adapter.** The
 * previous map lived in `RedisStreamsEventPublisher`, but three of the five
 * writers (`jobs.sync` and both dead-letter streams) never call
 * `EventPublisherPort.publish`, so extending that map could not have reached
 * them. This module sits in `@openlinker/shared/redis` — the one place every
 * writer, in `libs/core` and in both host apps, can already reach.
 *
 * Written dependency-free (no imports) so it can move to a dedicated package
 * subpath later without any consumer change.
 *
 * Command floor: plain `MAXLEN` / `MINID` (Redis 6.2+). Redis 8.2's PEL-aware
 * trim modes are unavailable on `redis:7-alpine` (integration tests) and on
 * Valkey (#1396), so nothing here may depend on them.
 *
 * @module libs/shared/src/redis
 */

/**
 * Every stream the system writes.
 *
 * Keeping the names here rather than as private literals in six files is what
 * lets {@link STREAM_BOUNDS} be exhaustive at compile time.
 */
export const REDIS_STREAM_NAMES = {
  inboundWebhooks: 'events.inbound.webhooks',
  inboundWebhooksDead: 'events.inbound.webhooks.dead',
  masterDeletion: 'events.master.deletion',
  masterDeletionDead: 'events.master.deletion.dead',
  jobsSync: 'jobs.sync',
  healthcheck: 'healthcheck',
} as const;

export type RedisStreamName = (typeof REDIS_STREAM_NAMES)[keyof typeof REDIS_STREAM_NAMES];

/**
 * How a stream is bounded.
 *
 * `maxlen` bounds by entry count, `minid` by age. The choice is not cosmetic —
 * see {@link STREAM_BOUNDS} for why two streams must be age-bounded.
 *
 * `exact` forces `MAXLEN` instead of `MAXLEN ~`. Approximate trimming operates
 * on whole macro-nodes (`stream-node-max-entries`, default 100), so it cannot
 * trim below one full node: `MAXLEN ~ 1` really retains ~100 entries. Only a
 * threshold at or below that node size needs exact trimming.
 */
export type StreamBound =
  | { kind: 'maxlen'; threshold: number; exact?: boolean }
  | { kind: 'minid'; maxAgeMs: number };

/** Redis default for `stream-node-max-entries`; the floor `~` can trim to. */
export const STREAM_NODE_MAX_ENTRIES = 100;

/** One day in milliseconds, for the age-based bounds below. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `jobdedup:*` TTL in `RedisStreamsJobEnqueueService`.
 *
 * `jobs.sync`'s retention horizon must stay **above** it — see
 * {@link STREAM_BOUNDS}. Duplicated as a constant rather than imported because
 * this module is dependency-free by design; `stream-retention.spec.ts` asserts
 * the ordering that makes the duplication safe.
 */
export const JOB_DEDUP_TTL_MS = 7 * DAY_MS;

/**
 * Retention bound per stream. Exhaustive over {@link RedisStreamName}, so adding
 * a stream name without deciding its retention fails `pnpm type-check`.
 */
const STREAM_BOUNDS: Record<RedisStreamName, StreamBound> = {
  // Highest-volume stream in the system, consumed within milliseconds. The cap
  // is a crash-backlog buffer, not storage, and the fact of every delivery is
  // durable in `webhook_deliveries` regardless.
  [REDIS_STREAM_NAMES.inboundWebhooks]: { kind: 'maxlen', threshold: 50_000 },

  // Unchanged from the pre-#2163 value. Authority for a deletion is the
  // persisted `product_variants.isStale` flag, never the event.
  [REDIS_STREAM_NAMES.masterDeletion]: { kind: 'maxlen', threshold: 10_000 },

  // AGE-bounded, deliberately, and NOT by count. A job becomes durable only when
  // `job-intake` writes its `sync_jobs` row; until then the stream entry IS the
  // job, and the group is created at '$' so nothing replays. `enqueueJob` also
  // sets `jobdedup:{key}` BEFORE the XADD with a 7-day TTL, so a
  // trimmed-but-unconsumed entry would be both permanently lost AND
  // un-re-enqueueable for a week — every retry returning `{isExisting: true}`
  // and silently doing nothing. Webhook-derived keys are stable
  // (`{platformType}:{connectionId}:{sourceEventId}`), so that is a lost order
  // while `webhook_deliveries` still reads `job_enqueued`.
  //
  // An AGE bound is chosen because a COUNT bound discards under exactly the
  // load spike it was sized for: volume-correlated, and therefore most likely
  // precisely when the backlog is legitimate. An age bound discards only after
  // sustained intake failure, which is a condition an operator can alert on.
  //
  // The horizon is also longer than JOB_DEDUP_TTL_MS, so a trimmed entry's dedup
  // key has certainly expired. Note carefully what that does and does not buy:
  // it makes a trimmed job **un-blocked**, not **recovered**. A re-enqueue will
  // no longer no-op with `{isExisting: true}` — but nothing in the system
  // re-enqueues one. The consumer's recovery is PEL-based and a trimmed,
  // never-delivered entry was never in a PEL; a source redelivering the same
  // webhook is stopped at the durable `webhook_deliveries` gate, which outlives
  // every TTL here. Recovery is operator-driven; see
  // docs/operations/redis-stream-retention.md. Closing the gap for real is
  // ADR-049 decision 1 (work row inside the business transaction).
  [REDIS_STREAM_NAMES.jobsSync]: { kind: 'minid', maxAgeMs: 14 * DAY_MS },

  // Diagnostic, but the *fact* of dead-lettering is durable in
  // `webhook_deliveries.status='deadlettered'`. Losing old payload detail is
  // acceptable, so a count bound is fine here.
  [REDIS_STREAM_NAMES.inboundWebhooksDead]: { kind: 'maxlen', threshold: 10_000 },

  // AGE-bounded, unlike its sibling above, because it has NO durable
  // counterpart: `master-deletion-to-job.handler.ts` writes the stream entry and
  // nothing else, inside a non-fatal catch. It is the sole record that a
  // deletion event was discarded. FIFO-drop is backwards on a diagnostic
  // surface — in the incident that matters (a bad deploy dead-lettering a whole
  // wave) entries 1..N identify the trigger, and MAXLEN discards exactly those.
  [REDIS_STREAM_NAMES.masterDeletionDead]: { kind: 'minid', maxAgeMs: 30 * DAY_MS },

  // Liveness probe only, written once per health poll and never read back.
  // EXACT because `~` cannot trim below one macro node (~100 entries).
  [REDIS_STREAM_NAMES.healthcheck]: { kind: 'maxlen', threshold: 1, exact: true },
};

/**
 * Bound applied to a stream not present in {@link STREAM_BOUNDS}.
 *
 * Conservative on purpose: the point is that "unbounded" is unreachable, not
 * that this value is right for any particular stream. A new stream should get
 * its own entry — {@link xAddBounded} makes that a compile-time requirement at
 * the call site.
 */
export const DEFAULT_STREAM_BOUND: StreamBound = { kind: 'maxlen', threshold: 10_000 };

/**
 * Resolve a stream's bound. Never returns `undefined`.
 *
 * `Object.hasOwn` rather than a plain index: an inherited key (`'constructor'`,
 * `'toString'`) would return a function, skip the `??` fallback, and reach
 * node-redis as `threshold: undefined`. Only reachable through
 * {@link xAddBoundedDynamic} with an absurd name, but the whole point of this
 * module is that no input yields an unbounded or malformed write.
 */
export function resolveStreamBound(streamName: string): StreamBound {
  return Object.hasOwn(STREAM_BOUNDS, streamName)
    ? STREAM_BOUNDS[streamName as RedisStreamName]
    : DEFAULT_STREAM_BOUND;
}

/** node-redis `XADD` TRIM options. */
export interface StreamTrimOptions {
  TRIM: {
    strategy: 'MAXLEN' | 'MINID';
    strategyModifier?: '=' | '~';
    threshold: number;
  };
}

/**
 * Build the `XADD` TRIM options for a stream. Always defined.
 *
 * `now` is injectable because a `minid` bound resolves its threshold from the
 * current time: a Redis stream id is `{ms}-{seq}`, so `now - maxAgeMs` is a
 * valid `MINID` threshold.
 *
 * Note that this is the **application's** clock, while the ids it is compared
 * against were minted by the **Redis server's**. The exposure is negligible by
 * construction: trimming an entry that is actually recent would need the server
 * to lag the app by more than the margin between the horizon and the dedup TTL
 * (7 days), and skew above a few seconds already breaks the far tighter
 * `OL_WEBHOOK_SKEW_WINDOW_MS` replay guard, so it would surface there first.
 */
export function streamTrimOptions(streamName: string, now: number = Date.now()): StreamTrimOptions {
  const bound = resolveStreamBound(streamName);

  if (bound.kind === 'minid') {
    return {
      TRIM: {
        strategy: 'MINID',
        strategyModifier: '~',
        threshold: Math.max(0, now - bound.maxAgeMs),
      },
    };
  }

  return {
    TRIM: {
      strategy: 'MAXLEN',
      // `~` lets Redis stop at a macro-node boundary rather than walking the
      // radix tree entry by entry — the right trade for a bound that only needs
      // to prevent growth. `exact` opts out where the threshold is below one node.
      strategyModifier: bound.exact ? '=' : '~',
      threshold: bound.threshold,
    },
  };
}

/** The subset of a Redis client {@link xAddBounded} needs. */
export interface StreamWriteClient {
  xAdd(
    key: string,
    id: string,
    fields: Record<string, string>,
    options?: StreamTrimOptions
  ): Promise<string | null>;
}

/**
 * The single write seam for every stream in the system.
 *
 * `streamName` is typed as {@link RedisStreamName}, so writing to a stream with
 * no declared retention is a **type error at the call site** — which is the
 * guarantee the map alone cannot give, since `resolveStreamBound` must accept a
 * plain `string` (`EventPublisherPort.publish` takes a dynamic stream name).
 * `scripts/check-stream-writes.mjs` bans bare `.xAdd(` outside this function, so
 * the two together make an unbounded stream unreachable rather than unlikely.
 */
export async function xAddBounded(
  client: StreamWriteClient,
  streamName: RedisStreamName,
  fields: Record<string, string>,
  now?: number
): Promise<string | null> {
  return client.xAdd(streamName, '*', fields, streamTrimOptions(streamName, now));
}

/**
 * {@link xAddBounded} for a caller whose stream name is genuinely not known at
 * compile time.
 *
 * Exactly one caller qualifies: `RedisStreamsEventPublisher`, because
 * `EventPublisherPort.publish(streamName: string, …)` is dynamic by contract.
 * Everything else must use {@link xAddBounded} and get the call-site type check.
 *
 * The write is still **bounded** — an unregistered name resolves
 * {@link DEFAULT_STREAM_BOUND} — but it is bounded by a default rather than by a
 * deliberate decision, which is why this door is deliberately narrow. A new
 * stream published through this path should still be added to
 * {@link REDIS_STREAM_NAMES} so its retention is chosen rather than inherited.
 */
export async function xAddBoundedDynamic(
  client: StreamWriteClient,
  streamName: string,
  fields: Record<string, string>,
  now?: number
): Promise<string | null> {
  return client.xAdd(streamName, '*', fields, streamTrimOptions(streamName, now));
}
