/**
 * Price Change Episode Superseded (#3142, ADR-072)
 *
 * Raised by `reopenIgnored` when a rival episode has already been opened for
 * the same `(productVariantId, destinationConnectionId, sourceConnectionId)`
 * key since the one being reopened was ignored — the `UQ_price_change_episodes_open`
 * partial index refuses the reopen because it would create a second open row
 * for that key.
 *
 * Reachable sequence: operator ignores episode E → E leaves the open index →
 * a later detection opens a fresh episode F for the same key → operator
 * clicks Undo on E. The `NOT EXISTS` conjunct in `reopenIgnored`'s SQL closes
 * the common ordering; this error is the fallback for the residual race where
 * a concurrent `upsertOpen` commits between the `NOT EXISTS` check and the
 * `UPDATE`'s own constraint enforcement — Postgres always re-checks a unique
 * index against the latest committed state when applying the write, so the
 * 23505 still surfaces even though the guard clause read `false` a moment
 * earlier.
 *
 * The caller must not proceed as if the reopen succeeded: E's superseder (F)
 * is the row now representing this key, and reopening E would create a
 * second live episode for it.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class PriceChangeEpisodeSupersededError extends Error {
  constructor(public readonly episodeId: string) {
    super(
      `Price change episode ${episodeId} cannot be reopened: a newer episode already exists for its key`
    );
    this.name = 'PriceChangeEpisodeSupersededError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PriceChangeEpisodeSupersededError);
    }
  }
}
