/**
 * Fulfillment Persistence Error (#2392)
 *
 * Repositories must not let a TypeORM `QueryFailedError` escape through a port —
 * the application layer would then be branching on infrastructure types
 * (`docs/engineering-standards.md § Repository Error Handling`). Mirrors
 * `ReturnPersistenceError`.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentPersistenceError extends Error {
  constructor(
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    super(
      `Fulfillment persistence failed during ${operation}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'FulfillmentPersistenceError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentPersistenceError);
    }
  }
}
