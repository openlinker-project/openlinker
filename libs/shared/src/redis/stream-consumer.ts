/**
 * Redis Stream Consumer Primitives
 *
 * Recovery primitives shared by every Redis Streams consumer group in the system
 * (#2164). Three consumers — the webhook-to-job handler in `apps/api`, the
 * master-deletion handler and the job-intake consumer in `apps/worker` — each
 * ran a structurally identical `XREADGROUP ... '>'` loop that could never reach
 * its own Pending Entries List. A process killed between read and ACK lost its
 * in-flight message permanently, and on the webhook path the `webhook_deliveries`
 * row still read `published`, so a dropped order looked like a delivered one.
 *
 * This module supplies only the three primitives that fix it — stable identity,
 * own-history drain, and orphan reclaim — deliberately NOT a base class or a
 * unified loop. The three consumers differ materially (job-intake dead-letters
 * to a database row rather than a stream; the webhook handler runs a shutdown
 * drain; batch sizes and ACK semantics differ), so extracting the shared
 * primitives fixes the defect at single-source without rewriting three live
 * consumers.
 *
 * Written dependency-free (Node built-ins only, structural client typing) so it
 * can move to a dedicated package subpath later without any consumer change.
 *
 * Command floor: `XPENDING` / `XCLAIM` / `XRANGE` (Redis 6.2+). The dev stack
 * runs `redis:8.4-alpine`, integration tests run `redis:7-alpine`, and #1396
 * proposes `valkey/valkey:8-alpine` — 6.2 is the intersection, so nothing here
 * may depend on a newer primitive.
 *
 * @module libs/shared/src/redis
 */
import { hostname } from 'os';

/**
 * The subset of a Redis client this module needs.
 *
 * Structural rather than `RedisClientType` so the file stays dependency-free;
 * callers pass their existing injected client unchanged.
 */
export interface StreamConsumerClient {
  xPendingRange(
    key: string,
    group: string,
    start: string,
    end: string,
    count: number,
    options?: { consumer?: string; IDLE?: number }
  ): Promise<unknown>;
  xRange(key: string, start: string, end: string, options?: { COUNT?: number }): Promise<unknown>;
  xClaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    id: string | string[]
  ): Promise<unknown>;
  xAck(key: string, group: string, id: string): Promise<number>;
}

/**
 * One entry recovered from a Pending Entries List.
 *
 * `trimmed` is a first-class outcome, not an error. Once a stream carries a
 * retention bound (#2163), an entry can be removed while its id remains in the
 * PEL. Routing that into a handler's normal error path is actively harmful:
 * `job-intake` would persist a bogus dead `sync_jobs` row and the webhook
 * handler would write a spurious dead-letter entry plus a `deadlettered`
 * delivery row — inventing an operator-facing failure that never happened. So it
 * is classified here, once, and never reaches a handler.
 */
export type StreamEntry =
  | { kind: 'entry'; id: string; fields: Record<string, string> }
  | { kind: 'trimmed'; id: string };

/** Environment variable that pins a worker's stable identity. */
export const WORKER_ID_ENV = 'OL_WORKER_ID';

/**
 * Lower bound for any reclaim idle threshold.
 *
 * A reclaim that fires while a handler is still working steals live work and
 * double-runs it, so the threshold must exceed p99 handler duration. No
 * measurement exists yet (the k6 harness, #1134, is not built), so the value is
 * chosen defensible-by-construction rather than guessed: never below five
 * minutes, with callers expected to pass at least 10x their longest handler
 * timeout. Every reclaim logs its observed idle time, so the first production
 * reclaim reveals whether the threshold is sane.
 */
export const MIN_RECLAIM_IDLE_MS = 5 * 60 * 1000;

/**
 * How often a consumer should run an orphan-reclaim pass.
 *
 * Shared rather than redeclared per consumer: the three loops tick at different
 * rates, and a per-consumer literal would let them drift apart for no reason.
 */
export const RECLAIM_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Hard cap on pages a startup drain will read before giving up.
 *
 * The drain loops until a page comes back empty, which terminates only because
 * every handler path either ACKs or throws (the throw is caught and ends the
 * drain). That invariant lives in three separate consumer files, so a future
 * branch that neither ACKs nor throws would hang `onModuleInit` and with it
 * application boot. The cap turns that regression into a logged warning.
 */
export const MAX_DRAIN_PAGES = 1_000;

/** Start sentinel for an `XPENDING` id range. */
const PEL_RANGE_START = '-';

/** End sentinel for an `XPENDING` id range. */
const PEL_RANGE_END = '+';

/**
 * Build a consumer name that is stable across restarts of the same logical
 * worker and distinct across replicas.
 *
 * Replaces `${prefix}-${process.pid}`, which was wrong in both directions: in a
 * container PID is typically 1, so replicas collided on one PEL, while outside a
 * container the name changed on every restart, so a restarted process could
 * never reach its own history. Stable identity is the precondition for draining
 * at all.
 *
 * Resolution order: `OL_WORKER_ID` (the explicit override for deployments where
 * hostname is neither stable nor unique), then the container/host hostname.
 */
export function resolveConsumerName(prefix: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[WORKER_ID_ENV]?.trim();
  return `${prefix}-${configured || hostname()}`;
}

/** One row of an `XPENDING` range reply. */
export interface PendingRow {
  id: string;
  owner: string;
  millisecondsSinceLastDelivery: number;
}

/**
 * Narrow an `XPENDING ... START END COUNT` reply, tolerating shape drift.
 *
 * Exported for unit testing: the parsing, not the I/O, is where a reply-shape
 * change would silently strand messages.
 */
export function toPendingRows(reply: unknown): PendingRow[] {
  if (!Array.isArray(reply)) {
    return [];
  }

  const rows: PendingRow[] = [];
  for (const row of reply) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const { id, owner, millisecondsSinceLastDelivery } = row as Record<string, unknown>;
    if (typeof id !== 'string') {
      continue;
    }
    rows.push({
      id,
      owner: typeof owner === 'string' ? owner : '',
      millisecondsSinceLastDelivery:
        typeof millisecondsSinceLastDelivery === 'number' ? millisecondsSinceLastDelivery : 0,
    });
  }
  return rows;
}

/**
 * Read the body of one pending id, or report it as trimmed.
 *
 * Resolving each id with `XRANGE id id` rather than re-reading the group is a
 * deliberate choice, not a detour. node-redis (v1.5.x) transforms an
 * `XREADGROUP` reply through `transformTuplesReply`, which calls `.length` on
 * the field array — so an entry whose data was trimmed while its id stayed in
 * the PEL makes the **client library throw a `TypeError`** before any of our
 * code runs. That aborts the drain and leaves the dangling id unackable,
 * permanently blocking that consumer's own recovery. `XRANGE` returns an empty
 * array for a missing id, which is an answer rather than a crash.
 */
async function resolvePendingEntry(
  client: StreamConsumerClient,
  streamName: string,
  id: string
): Promise<StreamEntry> {
  const reply = await client.xRange(streamName, id, id, { COUNT: 1 });

  if (Array.isArray(reply) && reply.length > 0) {
    const fields = (reply[0] as { message?: unknown })?.message;
    if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {
      return { kind: 'entry', id, fields: fields as Record<string, string> };
    }
  }

  return { kind: 'trimmed', id };
}

/**
 * Read one page of this consumer's own pending history.
 *
 * Entries already delivered to this consumer and never ACKed are exactly the
 * messages a previous incarnation was holding when it died. The steady-state
 * loop reads `'>'`, which returns only never-delivered entries, so without this
 * they would sit in the PEL forever.
 *
 * Callers loop until this returns empty. A `trimmed` result must be ACKed rather
 * than processed — see {@link ackTrimmed}.
 */
export async function readOwnPending(
  client: StreamConsumerClient,
  streamName: string,
  group: string,
  consumer: string,
  count: number
): Promise<StreamEntry[]> {
  const pending = toPendingRows(
    await client.xPendingRange(streamName, group, PEL_RANGE_START, PEL_RANGE_END, count, {
      consumer,
    })
  );

  const entries: StreamEntry[] = [];
  for (const row of pending) {
    entries.push(await resolvePendingEntry(client, streamName, row.id));
  }
  return entries;
}

/**
 * Read the body an `XCLAIM` actually transferred, or `null` if it did not.
 *
 * node-redis maps the reply through `transformStreamMessagesNullReply`, which
 * returns one element per requested id and `null` where the claim did not
 * transfer. Both non-transfer cases matter and both must be honoured:
 *
 * - the original owner ACKed between the `XPENDING` and the `XCLAIM`, or it
 *   touched the entry so it is no longer idle past the threshold — the entry is
 *   not ours and must not be processed;
 * - the entry's data was trimmed, which on Redis 7+ also drops it from the PEL.
 *
 * Exported for unit testing: trusting the claim is the property that stops this
 * function re-running work another live consumer still owns.
 */
export function toClaimedMessage(reply: unknown): Record<string, string> | null {
  if (!Array.isArray(reply)) {
    return null;
  }

  const first: unknown = (reply as unknown[])[0];
  if (!first || typeof first !== 'object') {
    return null;
  }

  const fields = (first as { message?: unknown }).message;
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    return null;
  }
  return fields as Record<string, string>;
}

/**
 * Claim one page of entries idle beyond `minIdleMs`, whichever consumer holds
 * them.
 *
 * This recovers work stranded by a replica that never came back — the case
 * stable identity alone cannot fix, since a drain only ever reaches the
 * consumer's *own* history.
 *
 * Built from `XPENDING ... IDLE` + `XCLAIM` rather than `XAUTOCLAIM` for the
 * same reason {@link resolvePendingEntry} avoids `XREADGROUP`: it keeps every
 * reply on a shape node-redis can transform without throwing, and it holds the
 * module to the Redis 6.2 floor that Valkey also provides.
 *
 * **The claim reply is the source of truth, not the `XPENDING` listing.** An
 * `XCLAIM` that does not transfer returns a `null` element, and ownership is
 * the only thing separating recovery from re-running work a live consumer is
 * still processing — `XRANGE` would happily return the body either way, because
 * ACK removes an entry from the PEL but not from the stream.
 *
 * `minIdleMs` is floored rather than trusted, so a caller cannot accidentally
 * configure work-stealing.
 */
export async function reclaimOrphans(
  client: StreamConsumerClient,
  streamName: string,
  group: string,
  consumer: string,
  minIdleMs: number,
  count = 10,
  /**
   * Lower bound applied to `minIdleMs`. Exists solely so an integration test can
   * exercise reclaim without waiting out the safety floor; production callers
   * must never pass it. Overriding it in production re-enables work-stealing.
   */
  floorMs: number = MIN_RECLAIM_IDLE_MS
): Promise<StreamEntry[]> {
  const idle = Math.max(minIdleMs, floorMs);

  const pending = toPendingRows(
    await client.xPendingRange(streamName, group, PEL_RANGE_START, PEL_RANGE_END, count, {
      IDLE: idle,
    })
  ).filter((row) => row.owner !== consumer);

  const entries: StreamEntry[] = [];
  for (const row of pending) {
    // Re-assert the threshold on the claim itself: XCLAIM transfers ownership
    // only while the entry is still idle, so an owner that woke up between the
    // XPENDING and here keeps its message.
    const claimed = toClaimedMessage(
      await client.xClaim(streamName, group, consumer, idle, row.id)
    );

    if (claimed) {
      entries.push({ kind: 'entry', id: row.id, fields: claimed });
      continue;
    }

    // No transfer. Either the entry is gone (trimmed — report it so the caller
    // clears the dangling id) or another consumer still owns it, in which case
    // it is emphatically not ours to process. XRANGE separates the two: an
    // empty result means the data is gone, anything else means we lost the race.
    const stillInStream = await client.xRange(streamName, row.id, row.id, { COUNT: 1 });
    if (!Array.isArray(stillInStream) || stillInStream.length === 0) {
      entries.push({ kind: 'trimmed', id: row.id });
    }
  }
  return entries;
}

/**
 * ACK a trimmed entry so its dangling id leaves the Pending Entries List.
 *
 * Separate from the ordinary ACK path to keep the call site self-documenting:
 * this is cleanup of an id whose data no longer exists, never acknowledgement of
 * processed work.
 */
export async function ackTrimmed(
  client: StreamConsumerClient,
  streamName: string,
  group: string,
  id: string
): Promise<void> {
  await client.xAck(streamName, group, id);
}
