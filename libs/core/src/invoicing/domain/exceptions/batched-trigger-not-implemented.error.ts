/**
 * BatchedTriggerNotImplementedError
 *
 * Thrown by `AutoIssueTriggerService` when a connection's trigger model is
 * `batched` — a mode DEFERRED to its own future issue (OL #1120). Surfacing a
 * named error (vs. silently skipping) keeps the deferral explicit and operator-
 * visible. PII-clean: the message cites only `connectionId` / `order.id`.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class BatchedTriggerNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchedTriggerNotImplementedError';
  }
}
