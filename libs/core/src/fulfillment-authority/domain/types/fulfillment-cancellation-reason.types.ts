/**
 * Fulfillment Cancellation Reasons (#2304, REVIEW §3 H14)
 *
 * Why an in-flight fulfillment work object was cancelled rather than closed.
 * The distinction is load-bearing: DESIGN §2.2 requires a force-close to land on
 * `cancelled`, "never `closed`-as-completed", so a reason accompanies every
 * cancellation to keep the two apart in the record.
 *
 * **Revocation is prospective-only.** Clearing a config flag changes the next
 * resolution and never an in-flight object; taking back in-flight work requires
 * cancelling that specific work object. Every member below names one way that
 * happens.
 *
 * **Provenance — one member is design-verbatim, four are inferred.** Only
 * `operator_forced` is written literally in the design. The other four are
 * derived from §2.2's revocation prose and are marked as such per member with
 * the sentence they derive from. They are surfaced for review rather than
 * silently invented: a wrong string is cheap now and expensive once several
 * contexts import it. Spelling is snake_case because the design writes
 * `operator_forced` that way, and a union with one member in a different case
 * from its four siblings is worse than either convention.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §2.2
 */

export const FulfillmentCancellationReasonValues = [
  /**
   * DESIGN-VERBATIM (§2.2, DESIGN-oms-authority-model:162-163): "an audited
   * operator **force-close to `cancelled`** with reason `operator_forced`".
   * Also the stated exit where the holder connection is disabled and therefore
   * cannot be resolved for negotiation at all.
   */
  'operator_forced',
  /**
   * INFERRED from §2.2 (:155-157): the holder "**rejects** with
   * `{reason, blocking}`". A rejected grant ends that work object's assignment
   * to that holder; the rejecter's own reason rides in `detail`.
   */
  'holder_rejected',
  /**
   * INFERRED from §2.2 (:156): "on rejection/**timeout** re-route excluding the
   * rejecter", read together with (:164-165) "A disabled holder connection
   * cannot be resolved for negotiation at all (`getCapabilityAdapter` is
   * active-only)". The timeout half and the unresolvable-connection half are one
   * observable condition: the holder did not answer.
   */
  'holder_unreachable',
  /**
   * INFERRED from §2.2 (:156-157): "re-route excluding the rejecter → exhausted
   * candidates leave the work `unassigned`". Where re-routing SUCCEEDS the
   * original work object ends because its replacement carries the assignment —
   * distinct from `holder_rejected`, which records why routing re-ran at all.
   */
  'rerouted',
  /**
   * INFERRED from §3 adjudication 1 ("stays open until its order terminates")
   * and the `WHERE cancelledAt IS NULL` gate on re-routing (:566). A cancelled
   * commercial order cancels its outstanding work; nothing about the holder is
   * at fault.
   */
  'order_cancelled',
] as const;

export type FulfillmentCancellationReason = (typeof FulfillmentCancellationReasonValues)[number];

/** Narrow an untrusted string to a `FulfillmentCancellationReason`. */
export function isFulfillmentCancellationReason(
  value: unknown,
): value is FulfillmentCancellationReason {
  return (
    typeof value === 'string' &&
    (FulfillmentCancellationReasonValues as readonly string[]).includes(value)
  );
}
