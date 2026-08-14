/**
 * Taxonomy Sync Lock helpers (#2061)
 *
 * Lock key + TTL for serializing `destination.taxonomy.sync` per taxonomy
 * SCOPE. ADR-037 § Sequencing claims "at most one in-flight run per owner,
 * enforced by the idempotency key"; that key carries a minute timestamp, so it
 * collapses same-tick duplicates only — a run still going when the next tick
 * fires was never prevented. This lock is what makes the claim true.
 *
 * The key is built from the RESOLVED scope, never from the job payload. That is
 * the #2063 lesson applied to a second key: the owner derives from mutable
 * connection config, so a payload-built key would let two runs on one owner take
 * two different locks and defeat the point. The cursor key already resolves this
 * way, so both now read one authority.
 *
 * @module libs/core/src/listings/application/services
 */
import type { TaxonomyScope } from '../../domain/types/destination-category.types';

/**
 * Lock TTL (ms). Single-shot, no heartbeat — mirroring `orderCreateLock`.
 *
 * It needs to cover one PAGE, not one run: a page is at most `pageLimit`
 * browses (default 500), and a multi-page run releases and re-acquires per tick.
 *
 * **The margin is stated honestly rather than assumed.** At the shipped default
 * page limit, 500 sequential browses at ~1 s each is ~500 s — and Allegro's rate
 * limiting can make that optimistic. 1800 s therefore gives roughly 3.5x headroom
 * over that estimate, where the previous 600 s gave 1.2x and would have expired
 * mid-page on any slower-than-ideal run.
 *
 * If the TTL does expire mid-page, a second run can start and the behaviour
 * degrades to exactly the pre-#2061 overlap — safe, because expansion is stamped
 * only after a successful browse and `upsertMany` is idempotent. The lock is an
 * efficiency and honesty measure, never the thing correctness rests on; that is
 * why an under-sized TTL is a wasted-HTTP problem rather than a data problem.
 *
 * Operator-tunable via `OL_TAXONOMY_SYNC_LOCK_TTL_MS` (clamped to [1m, 60m]),
 * mirroring `OL_ORDER_CREATE_LOCK_TTL_MS`. Raise it if you also raise
 * `pageLimit`, or if the destination is slow enough that a page exceeds it.
 */
const DEFAULT_TAXONOMY_SYNC_LOCK_TTL_MS = 1_800_000;
const MIN_TAXONOMY_SYNC_LOCK_TTL_MS = 60_000;
const MAX_TAXONOMY_SYNC_LOCK_TTL_MS = 3_600_000;

function resolveTaxonomySyncLockTtlMs(): number {
  const raw = process.env.OL_TAXONOMY_SYNC_LOCK_TTL_MS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TAXONOMY_SYNC_LOCK_TTL_MS;
  }
  return Math.min(
    MAX_TAXONOMY_SYNC_LOCK_TTL_MS,
    Math.max(MIN_TAXONOMY_SYNC_LOCK_TTL_MS, parsed),
  );
}

export const TAXONOMY_SYNC_LOCK_TTL_MS = resolveTaxonomySyncLockTtlMs();

/**
 * Build the lock key for one taxonomy scope.
 *
 * Owner-keyed for a marketplace (every connection to it shares one tree, so the
 * lock must too) and connection-keyed for a shop — the same split the projection
 * itself uses, so the lock cannot be coarser or finer than the rows it protects.
 */
export function taxonomySyncLockKey(scope: TaxonomyScope): string {
  return scope.taxonomyOwner !== null
    ? `taxonomy:sync:owner:${scope.taxonomyOwner}`
    : `taxonomy:sync:connection:${scope.connectionId}`;
}
