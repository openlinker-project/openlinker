/**
 * Sync Job Lane Types
 *
 * The concurrency-lane vocabulary of ADR-050: a lane is a WORKLOAD PROFILE,
 * chosen by what starving a job costs — never by its I/O shape or bounded
 * context. The authoritative jobType→lane mapping is deliberately NOT defined
 * here: lanes are declared at handler registration in the worker
 * (`HandlerRegistrationService`, ADR-050 decision 1), so the mapping and the
 * handlers cannot drift apart. Core owns only the vocabulary and the scope
 * rule.
 *
 * `resolveJobScope` is the ADR-050 decision-3 seam: per-lane caps are keyed by
 * a `scope`, not by `connectionId` — today the two coincide, and a future
 * multi-merchant install changes this one body (e.g. to a merchant id) without
 * touching the runner's slot accounting. Pure-rule exception per
 * engineering-standards § "types only": the function IS the rule for the type
 * it sits with.
 *
 * @module libs/core/src/sync/domain/types
 * @see docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md
 */

import type { JobType } from './sync-job.types';

/**
 * Lane values (ADR-050 decision 1).
 *
 * - `realtime` — someone or something waits on a single unit of work.
 * - `bulk` — paged/cursored sweeps plus operator-wave children (the waves are
 *   single-unit work, but starving one costs a slower batch an operator
 *   tolerates; letting the wave monopolise slots is the measured failure).
 * - `fiscal` — deadline-bearing, at-most-once.
 * - `fan-out` — near-zero HTTP of its own; output is child jobs.
 *
 * The list stays at four on purpose: ADR-050 decision 1 makes a fifth entry a
 * reversal gate, on the grounds that it would mean the axis is wrong. When one
 * unit of work has two costs of starvation depending on what triggered it, the
 * repo expresses that as two job types under one handler, not as a new lane —
 * `master.product.syncFromSweep` beside `master.product.syncByExternalId`
 * (#2594) is the worked example.
 */
export const SyncJobLaneValues = ['realtime', 'bulk', 'fiscal', 'fan-out'] as const;

/**
 * Lane union derived from {@link SyncJobLaneValues}.
 */
export type SyncJobLane = (typeof SyncJobLaneValues)[number];

/**
 * Webhook-driven product and inventory syncs (#3986, ADR-050 amendment).
 *
 * Only the `syncByExternalId` types: their sweep-triggered twins
 * (`...syncFromSweep`) are `bulk` and keep the plain connection scope. A burst
 * of these on one shop (a bulk edit firing a webhook per product) used to fill
 * the connection's `realtime` per-scope slots ahead of a buyer's
 * `marketplace.order.sync` on the same connection, because both shared one
 * scope.
 */
export const HOOK_SYNC_JOB_TYPES: readonly JobType[] = [
  'master.product.syncByExternalId',
  'master.inventory.syncByExternalId',
];

/**
 * Suffix that qualifies a connection id into the PRODUCT hook-sync workload
 * class. Shared by {@link resolveJobScope} (runner slot accounting) AND the
 * repository claim's SQL exclusion, which builds the same expression from
 * {@link HOOK_SYNC_SCOPE_SUFFIX_BY_JOB_TYPE}: a mismatch between the two would
 * silently stop excluding saturated scopes.
 */
export const HOOK_SCOPE_SUFFIX = ':hook-sync';

/**
 * Suffix of the INVENTORY hook-sync class. Its own class so a stock burst is
 * not queued behind a product burst on a shared slot (#3986 review): before the
 * change inventory webhook syncs ran two per connection.
 */
export const HOOK_INVENTORY_SCOPE_SUFFIX = ':hook-sync-inventory';

/** Job type -> scope suffix: the single table the runner and the claim SQL both read. */
export const HOOK_SYNC_SCOPE_SUFFIX_BY_JOB_TYPE: readonly {
  jobType: JobType;
  suffix: string;
}[] = [
  { jobType: 'master.product.syncByExternalId', suffix: HOOK_SCOPE_SUFFIX },
  { jobType: 'master.inventory.syncByExternalId', suffix: HOOK_INVENTORY_SCOPE_SUFFIX },
];

export type HookScopeClass = 'product' | 'inventory';

/** Which hook-sync class `scope` names, or null for a plain connection scope. */
export function hookScopeClass(scope: string): HookScopeClass | null {
  if (scope.endsWith(HOOK_INVENTORY_SCOPE_SUFFIX)) {
    return 'inventory';
  }
  if (scope.endsWith(HOOK_SCOPE_SUFFIX)) {
    return 'product';
  }
  return null;
}

/** True when `scope` names any hook-sync class of a connection. */
export function isHookScope(scope: string): boolean {
  return hookScopeClass(scope) !== null;
}

/**
 * Resolve the isolation scope a job's lane slots are accounted against
 * (ADR-050 decision 3, amended by #3986).
 *
 * A scope is a (connection, workload class) pair. The classes are `hook-sync`
 * (product) and `hook-sync-inventory`, for {@link HOOK_SYNC_JOB_TYPES}; every
 * other job type is unqualified, so on a single-merchant install it still
 * resolves to the bare connection id. A multi-merchant deployment changes this
 * one body, not its callers.
 */
export function resolveJobScope(job: { connectionId: string; jobType: JobType }): string {
  const entry = HOOK_SYNC_SCOPE_SUFFIX_BY_JOB_TYPE.find((e) => e.jobType === job.jobType);
  return entry ? `${job.connectionId}${entry.suffix}` : job.connectionId;
}
