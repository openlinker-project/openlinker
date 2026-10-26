/**
 * Bench presence types (#3406; widened to a named roster by #3415,
 * mockup-parity epic #3401)
 *
 * A packer opening a parcel another packer already has open sees a collision
 * banner naming who that is. This is presence, not a durable fact - losing
 * the signal on a Redis restart is acceptable, because nothing downstream
 * depends on it (it warns, it never gates a write; `BenchParcelService`'s
 * `verifyUnit`, `reopenParcel` and `undoLastScan` each enforce the ADR-074
 * assignment lock independently of whether anyone else's tab is open).
 *
 * @module apps/api/src/bench/application/types
 */

/**
 * One OTHER packer who currently has this parcel open.
 *
 * Carries a masked display name and NOTHING else — no user id, no username,
 * no email, no role. The bench's own PII posture is an explicit allowlist
 * (see the response-DTO module docblock), and "who else is looking at this
 * box" needs a name a colleague can recognise, not an identity.
 */
export interface BenchPresenceViewer {
  /**
   * The packer's name, already masked by the shared
   * `common/format/mask-name` rule — "Anna Kowalska" reads "A. Kowalska".
   *
   * Masking happens at WRITE time, so the unmasked name is never stored and
   * this value cannot be un-masked by any later reader. A single-token
   * account name (`admin`) passes through whole: there is no surname to keep
   * and no first name to reduce.
   */
  readonly displayName: string;
}

/** What a presence ping answers. */
export interface BenchPresenceView {
  /**
   * Whether anyone OTHER than the caller has this parcel open right now —
   * exactly `others.length > 0`, carried as its own field because it is what
   * the banner's visibility keys on. `false` on the caller's own ping (self
   * is never a collision) and `false` once every other packer's own window
   * has lapsed: the TTL is the same mechanism that clears the signal on
   * navigation-away or a dead session, so there is no separate "leave" call
   * to make or forget.
   */
  readonly collision: boolean;

  /**
   * Everyone else who has it open, most recently seen first, NEVER including
   * the caller.
   *
   * An EMPTY array is a first-class answer meaning "nobody else" — it is not
   * how a failed read looks. A read that fails throws, and the route answers
   * a non-2xx; it never degrades to an empty roster, because "nobody else is
   * in this box" is a reassurance a failed read has no standing to give.
   */
  readonly others: readonly BenchPresenceViewer[];
}
