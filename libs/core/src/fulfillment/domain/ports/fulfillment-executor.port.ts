/**
 * Fulfillment Executor Port (#2398, DESIGN §5.4)
 *
 * The contract a fulfilment executor is called through: offer a work object to a holder, and
 * ask an accepting holder to give it back. #2393's `FulfillmentRouterPort` answers *"where is
 * this sourced from?"*; this answers *"who is doing it, and did they take it?"*.
 *
 * ## Three implementer shapes, one port
 *
 * DESIGN §5.4 names them: a 3PL adapter (API submit + webhook progress), the OL-OMS plugin
 * (auto-accept + pick-list UI, progress from the store-associate surface), and an enterprise
 * DOMS (the 3PL shape with a richer reject vocabulary). **Nothing in core knows which**,
 * which is why the reject reason is an opaque string and the progress read is optional.
 *
 * ## Four properties of the contract
 *
 * **(a) Both methods answer with the same type, and that is deliberate.** Cancelling work a
 * holder has ALREADY ACCEPTED is a request that holder may refuse — the state
 * `FulfillmentRequestStatus.cancellation_rejected` exists for, and ADR-054's whole reason for
 * two orthogonal axes. A `void` cancellation would assert a compliance the contract cannot
 * obtain, and a merged axis could not record "we asked and they said no".
 *
 * **(b) `blocking` on a rejection is what terminates the re-source loop.** See
 * `fulfillment-execution.types.ts` property (a): without it, re-source plus a deterministic
 * sort re-picks the refuser forever.
 *
 * **(c) The idempotency key is mandatory AND its replay guarantee is part of the contract** —
 * a repeat under the same key returns the ORIGINAL outcome and never creates a second
 * assignment. See property (d) of the types file for the format and why the counter is bumped
 * by a re-request rather than by a retry.
 *
 * **(d) Progress is INBOUND, so it is not on this port.** DESIGN §5.4's core-side seam
 * (`IFulfillmentProgressService.record`) is where a webhook-driven holder reports; the
 * pull-shaped `FulfillmentStatusSource` sub-capability beside this file serves a POLLING
 * vendor instead. Putting a progress *write* on the executor would point the wrong way — the
 * finding R1 recorded against the original adapter-method shape.
 *
 * ## A registry capability, unlike `FulfillmentRouter`
 *
 * `FulfillmentExecutor` **is** in `CoreCapabilityValues` (#2403), because A3
 * (`fulfillment-execution`) resolves by narrowing a *dispatched* adapter and its name must
 * therefore be assignable — whereas A2 (`sourcing`) is `config-only`, which is why
 * `FulfillmentRouter` was deliberately kept out.
 *
 * **But no shipped adapter manifest advertises it**, and both capability-checkbox surfaces
 * intersect an adapter's advertised list with the core set, so A3 is not assignable through
 * the UI today. That is a reachability gap rather than data loss — the value round-trips
 * through a direct `PATCH /connections/:id` — and it closes when the first executor adapter
 * declares the capability.
 *
 * ## Deferred, with owners
 *
 * Per-method error unions and wall-clock budgets are Wave-4 hardening (`W4-1`, `W4-2`),
 * exactly as #2393 left them — this port adds no error contract of its own. The accept
 * handshake and the `assignmentAttempt` counter are #2399; progress ingestion is #2400;
 * `supportedActions` is #2406. A partial cancellation is expressible as cancelling a
 * narrower work object (ADR-054), so no line-scoped cancellation ships.
 *
 * @module libs/core/src/fulfillment/domain/ports
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type {
  FulfillmentCancellationRequest,
  FulfillmentRequest,
  FulfillmentRequestResult,
} from '../types/fulfillment-execution.types';

export interface FulfillmentExecutorPort {
  /**
   * Offer a work object to the holder.
   *
   * `req.idempotencyKey` is REQUIRED. A repeat under the same key must return the original
   * outcome and must never create a second assignment.
   */
  requestFulfillment(req: FulfillmentRequest): Promise<FulfillmentRequestResult>;

  /**
   * Ask an accepting holder to give the work back.
   *
   * Answers `rejected` when the holder refuses — it is still theirs and still being worked.
   * That refusal is a normal outcome, not an error.
   */
  requestCancellation(req: FulfillmentCancellationRequest): Promise<FulfillmentRequestResult>;
}
