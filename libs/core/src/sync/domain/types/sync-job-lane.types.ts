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

/**
 * Lane values (ADR-050 decision 1).
 *
 * - `realtime` — someone or something waits on a single unit of work.
 * - `bulk` — paged/cursored sweeps plus operator-wave children (the waves are
 *   single-unit work, but starving one costs a slower batch an operator
 *   tolerates; letting the wave monopolise slots is the measured failure).
 * - `fiscal` — deadline-bearing, at-most-once.
 * - `fan-out` — near-zero HTTP of its own; output is child jobs.
 */
export const SyncJobLaneValues = ['realtime', 'bulk', 'fiscal', 'fan-out'] as const;

/**
 * Lane union derived from {@link SyncJobLaneValues}.
 */
export type SyncJobLane = (typeof SyncJobLaneValues)[number];

/**
 * Resolve the isolation scope a job's lane slots are accounted against
 * (ADR-050 decision 3).
 *
 * The scope degenerates to the connection id on a single-merchant install;
 * a multi-merchant deployment changes this one body, not its callers.
 */
export function resolveJobScope(job: { connectionId: string }): string {
  return job.connectionId;
}
