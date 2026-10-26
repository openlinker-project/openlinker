/**
 * Price Change Episode Persistence Error (#3142, ADR-072)
 *
 * Repositories must not let a TypeORM `QueryFailedError` escape through a port
 * — the application layer would then be branching on infrastructure types
 * (`docs/engineering-standards.md § Error Handling`). Mirrors
 * `FulfillmentPersistenceError` / `ReturnPersistenceError`: the generic
 * catch-all for any constraint violation on `price_change_episodes` that is
 * NOT the specific open/reopen race `PriceChangeEpisodeSupersededError`
 * exists for.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class PriceChangeEpisodePersistenceError extends Error {
  constructor(
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    super(
      `Price change episode persistence failed during ${operation}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'PriceChangeEpisodePersistenceError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PriceChangeEpisodePersistenceError);
    }
  }
}
