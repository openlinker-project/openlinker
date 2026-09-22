/**
 * Pack-bench query keys (#2416, `W3b-3`)
 *
 * `all` is a valid invalidation ancestor of every key below, which is what the
 * expedite mutation invalidates so the list re-sorts immediately rather than at
 * the next poll.
 *
 * The work key carries NO filter object, unlike `fulfillmentQueryKeys.list`:
 * the read takes no parameters (the scope is the bench's, not the request's), so
 * there is exactly one entry and every consumer shares it.
 *
 * @module apps/web/src/features/bench/api
 */
export const benchQueryKeys = {
  all: ['bench'] as const,
  work: () => ['bench', 'work'] as const,
  // #2418. Keyed by work id, unlike `work()`: a bench holds one open box at a
  // time but a packer switching between two must not read the first one's lines
  // under the second one's key — that is a verified count shown against the
  // wrong box, which is the one thing this surface may never do.
  parcel: (workId: string) => ['bench', 'parcel', workId] as const,
  documents: (workId: string) => ['bench', 'documents', workId] as const,
  unlabelled: () => ['bench', 'unlabelled'] as const,
  // #3401 mockup-parity epic.
  activity: (workId: string) => ['bench', 'activity', workId] as const,
  packedToday: () => ['bench', 'packed-today'] as const,
  metrics: () => ['bench', 'metrics'] as const,
  /** #3406 — who else has this box open. Polled, never invalidated by hand. */
  presence: (workId: string) => ['bench', 'presence', workId] as const,
};
