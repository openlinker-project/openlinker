/**
 * Bench presence types (#3406, mockup-parity epic #3401)
 *
 * A packer opening a parcel another packer already has open sees a collision
 * banner. This is presence, not a durable fact — losing the signal on a Redis
 * restart is acceptable, because nothing downstream depends on it (it warns,
 * it never gates a write; `BenchParcelService.verifyUnit` and `undoLastScan`
 * enforce their own rules independently of whether anyone else's tab is open).
 *
 * @module apps/api/src/bench/application/types
 */

/** What a presence ping answers. */
export interface BenchPresenceView {
  /**
   * Someone OTHER than the caller pinged this same parcel within the presence
   * window. `false` on the caller's own most recent ping (self is never a
   * collision), and `false` once the other packer's own window has lapsed —
   * the TTL is the same mechanism that clears the signal on navigation-away or
   * a dead session, so there is no separate "leave" call to make or forget.
   */
  readonly collision: boolean;
  /** Who else has it open, when `collision` is true. `null` otherwise. */
  readonly otherUserId: string | null;
}
