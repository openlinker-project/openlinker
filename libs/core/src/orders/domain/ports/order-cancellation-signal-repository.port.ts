/**
 * Order Cancellation Signal Repository Port (#2069)
 *
 * Defines the contract for durably recording a source cancellation that
 * arrived for an order OpenLinker has not yet ingested. `OrderRecordRepository
 * .markCancelled` is a bare `UPDATE ... WHERE "internalOrderId" = $2` with no
 * insert fallback, so it has nothing to write against when no internal order
 * id exists yet — and minting one via `getOrCreateInternalId` from the
 * cancellation path would point every downstream trigger at a phantom order
 * before any real order data arrives (the #2328 lesson for returns
 * attribution). The signal is keyed instead on the one durable identity that
 * exists before ingestion: `(sourceConnectionId, externalOrderId)`.
 *
 * No FK to `order_records` — the `order_holds` / `order_changes` /
 * `refund_records` precedent of an indexed reference by value, since there is
 * nothing yet to reference.
 *
 * @module libs/core/src/orders/domain/ports
 * @see {@link OrderCancellationSignalRepository} for the TypeORM implementation
 */
export interface OrderCancellationSignalRepositoryPort {
  /**
   * Durably record that a cancellation arrived for an order OL has not yet
   * ingested. Called by `OrderIngestionService.handleSourceCancellation` when
   * `IIdentifierMappingService.getInternalId` resolves nothing.
   *
   * First-write-wins: `ON CONFLICT DO NOTHING` against the unique
   * `(sourceConnectionId, externalOrderId)` index, so a redelivered cancel
   * event (at-least-once delivery is a platform-wide invariant) is a harmless
   * no-op rather than a second row or an error.
   */
  record(sourceConnectionId: string, externalOrderId: string, cancelledAt: Date): Promise<void>;

  /**
   * Atomically read-and-clear the signal for `(sourceConnectionId,
   * externalOrderId)`, if one exists — one `DELETE ... RETURNING` statement,
   * so two concurrent ingestion attempts for the same external order can
   * never both apply it and the signal is applied at most once.
   *
   * Called unconditionally by `OrderRecordService.persistIncomingSnapshot` on
   * EVERY call, not only the first — which is what makes the design
   * self-healing against the narrow race where `record()` and `consume()`
   * interleave: a signal that misses this call's `consume()` is picked up by
   * the very next poll/webhook for the same order, rather than lost forever.
   *
   * @returns the recorded cancellation instant, or `null` when no signal
   *   exists for this pair.
   */
  consume(sourceConnectionId: string, externalOrderId: string): Promise<Date | null>;
}
