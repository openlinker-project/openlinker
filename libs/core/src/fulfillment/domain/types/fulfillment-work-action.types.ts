/**
 * Fulfillment Work Actions (#2391, ADR-054, DESIGN §5.2)
 *
 * The closed vocabulary of things that can be DONE to a `FulfillmentWork`.
 *
 * **This is the vocabulary only — it is never the answer to "what is legal
 * now".** DESIGN §5.2 computes `supportedActions` SERVER-SIDE on the read model
 * and makes it actionable only with an optimistic-concurrency token (a stale
 * action answers 409 with a refreshed set). That computation is #2406's. It is
 * kept off the aggregate deliberately: a field here would invite a client to
 * recompute legality locally, which is precisely the client-side
 * state-machine drift "actions yes, states no" exists to kill.
 *
 * ## Provenance — none of these is design-verbatim
 *
 * DESIGN names `supportedActions` and never enumerates it; §5.4 names the
 * negotiation OUTCOMES rather than action verbs. Every member below is
 * therefore INFERRED, and each is marked with the sentence it derives from —
 * the discipline `fulfillment-cancellation-reason.types.ts` established, for
 * its stated reason: a wrong string is cheap now and expensive once several
 * contexts import it.
 *
 * ## Two states are NOT reachable by any action, on purpose
 *
 * `incomplete` is entered by a `short_picked` progress event with
 * `releaseShortfall` (DESIGN §5.4), not by an operator or holder action —
 * progress is event-as-data through the core-side ingestion seam
 * (`IFulfillmentProgressService.record`, #2400), never a command. And
 * `on_hold` is entered by CREATING a hold row (`fulfillment_holds`, #2392);
 * `hold` / `release_hold` below name the acts that write and clear that row.
 * Both absences are stated rather than left to be discovered, because a closed
 * vocabulary that cannot reach one of its own declared states is the drift a
 * vocabulary leaf exists to prevent.
 *
 * ## Ruling on ADR-059's "actions yes, states no"
 *
 * That clause (`hold-reason.types.ts`: "Plugins may contribute **actions**;
 * they may never add a reason") is about a plugin widening an operator-facing
 * action surface. This union is **closed** and is a different axis: it is the
 * set of transitions CORE's own two state machines admit, every one of which a
 * core service must be able to apply and a SQL predicate must be able to match.
 * A plugin needing a verb of its own is evidence the CONTRACT is missing an
 * operation — the same rule `JobTypeValues` follows (DESIGN §9: "a plugin
 * needing an inexpressible job type is evidence the contract is missing an
 * operation; the fix is a core PR"). Do not reopen this as an open string set
 * without amending ADR-054.
 *
 * Spelling is `snake_case`, matching both state axes in this context and
 * `FulfillmentCancellationReasonValues`. It deliberately differs from
 * `HoldReasonValues`' kebab-case, which is a different leaf's settled
 * convention; a future FE mirror should follow this file, not that one.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */

export const FulfillmentWorkActionValues = [
  /**
   * INFERRED from §5.2's `open` → `scheduled` state pair: something must reach
   * `scheduled`, and no progress event does. Without this member the execution
   * axis declares a state nothing can enter.
   */
  'schedule',
  /**
   * INFERRED from §5.4: `requestFulfillment(req)` — offering the work to a
   * holder is what moves the negotiation axis off `unsubmitted`.
   */
  'submit',
  /**
   * INFERRED from ADR-054's "accept via conditional claim
   * (`WHERE acceptedAt IS NULL`)".
   */
  'accept',
  /**
   * INFERRED from ADR-054's "reject with `{reason, blocking}` (blocking
   * excludes the rejecter from re-sourcing)".
   */
  'reject',
  /**
   * INFERRED from §5.4's `requestCancellation(req)` — the negotiation, not the
   * command. This is the member that makes "cancel is a command" wrong.
   */
  'request_cancellation',
  /** INFERRED from the `cancellation_accepted` request state. */
  'accept_cancellation',
  /** INFERRED from the `cancellation_rejected` request state. */
  'reject_cancellation',
  /**
   * INFERRED from §5.2's "Holds are first-class rows (`fulfillment_holds`,
   * ≤10 active, shared reason vocabulary per adjudication #4)". Writes the hold
   * row; the resulting execution state is `on_hold`.
   */
  'hold',
  /** INFERRED from the same sentence — clearing an active hold row. */
  'release_hold',
  /** INFERRED from §5.2's `in_progress` state and §5.4's `picked`/`packed` progress vocabulary. */
  'mark_in_progress',
  /** INFERRED from §5.2's `closed` state. Completion, never a force-close. */
  'close',
  /**
   * INFERRED from ADR-054: "in-flight work is taken back by negotiated cancel
   * or an audited operator **force-close to `cancelled`** (reason
   * `operator_forced`)". Distinct from `close` precisely because ADR-054
   * requires the two to stay apart in the record, and distinct from
   * `request_cancellation` because it is unilateral — the stated exit when a
   * disabled holder connection cannot be resolved for negotiation at all.
   */
  'force_cancel',
] as const;

export type FulfillmentWorkAction = (typeof FulfillmentWorkActionValues)[number];

/** Narrow an untrusted value to a `FulfillmentWorkAction`. */
export function isFulfillmentWorkAction(value: unknown): value is FulfillmentWorkAction {
  return (
    typeof value === 'string' && (FulfillmentWorkActionValues as readonly string[]).includes(value)
  );
}
