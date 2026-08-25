/**
 * Return Persistence Error
 *
 * The domain-level wrapper for an infrastructure failure raised while writing
 * the return aggregate.
 *
 * Repositories must not let a TypeORM `QueryFailedError` escape through a port —
 * the application layer would then be branching on infrastructure types
 * (`docs/engineering-standards.md § Repository Error Handling`). The original is
 * kept on `cause` so the driver's own message survives into the log.
 *
 * Unlike `ReturnObservationMissingExternalIdError` this one IS retryable: a
 * deadlock, a lost connection or a transient constraint race all arrive here and
 * all resolve on a re-run.
 *
 * @module libs/core/src/returns/domain/exceptions
 */
export class ReturnPersistenceError extends Error {
  constructor(
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    super(
      `Return persistence failed during ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = 'ReturnPersistenceError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnPersistenceError);
    }
  }
}
