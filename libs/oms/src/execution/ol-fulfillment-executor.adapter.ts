/**
 * OL-OMS Fulfillment Executor Adapter (#2409, `W3a-18`, ADR-055, DESIGN §9)
 *
 * The first real implementation of `FulfillmentExecutorPort`. It auto-accepts every work object
 * offered to it, because the holder is OpenLinker itself: there is no third party to negotiate
 * with, no wire to cross, and no vendor-side record to reconcile against. DESIGN §9's whole claim
 * is that the plugin descriptor IS the OMS's adapter to OpenLinker, and that the only asymmetry
 * sits below the port line — this file is that asymmetry.
 *
 * ## Why it holds no state, and why that is the STRONGER guarantee
 *
 * `FulfillmentRequest.idempotencyKey` carries a stated contract: *a repeat under the same key must
 * return the ORIGINAL outcome and must never create a second assignment.*
 *
 * A vendor adapter honours the second half by remembering keys. This one honours it **vacuously and
 * more strongly: it creates no assignment at all.** The assignment is the work row's holder
 * assignment, which CORE owns (`assignHolder` / `claimDispatchAttempt` / `recordAcceptance` in
 * `FulfillmentHandshakeService`). There is no vendor-side order here for a second call to duplicate,
 * so there is nothing a second call could create.
 *
 * The first half then follows **by construction** rather than by memory — the answer is a pure
 * function of nothing at all. That is stronger than a store gives, because a store can be lost.
 *
 * The practical consequence is that this package needs no `oms_*` table, no TypeORM dependency and
 * no migration; and, because the class takes no constructor dependencies, `OmsModule` stays on
 * `createNestAdapterModule` rather than paying the ADR-051 cost #2405 predicted (a hand-written
 * `@Module` would drag `ShippingModule` / `MappingsModule` providers into the `events`, `scheduler`
 * and `maintenance` worker roles, breaching the guarantee that a role which is off contributes none).
 *
 * ## Auto-accept still goes THROUGH the real handshake claim, never around it
 *
 * Nothing here writes a row. `FulfillmentHandshakeService` claims the attempt
 * (`claimDispatchAttempt`, a conditional UPDATE whose attempt reaches the caller only via
 * `RETURNING`, so minting a key ahead of its row is inexpressible), calls this adapter, and records
 * the answer through the guarded `recordAcceptance`. "Auto-accept" describes the ANSWER, not a
 * shortcut past the negotiation.
 *
 * ## `acceptedAt` is `null`, and that is forced rather than chosen
 *
 * The port declares a holder-reported instant to be the HOLDER's, `null` when it reports none,
 * "never `new Date()`". Here OpenLinker *is* the holder, so its clock would be a legitimate witness
 * — but the contract's replay rule settles it anyway: `describeFulfillmentExecutorContract` calls
 * `requestFulfillment` twice under one key and requires a byte-identical outcome, so a fresh `Date`
 * per call **fails the contract**. The only replay-stable acceptance instant an executor without its
 * own store can offer is `null`, which the aggregate documents as a first-class value ("accepted by a
 * holder that reported no instant of its own", told apart from "never accepted" by `requestStatus`).
 *
 * **One consequence is reported rather than buried**: `recordAcceptance` is guarded on
 * `"requestStatus" = 'submitted' AND "acceptedAt" IS NULL`, and core documents the second conjunct as
 * the guard that still holds if a future writer moves `requestStatus` without coming through there.
 * Writing `acceptedAt = null` makes that conjunct non-narrowing for OL-executed work — the common
 * case this wave creates — so at-most-once acceptance rests on the `requestStatus` conjunct alone.
 * Not a live defect (nothing else writes `requestStatus = 'accepted'`), but a defence-in-depth layer
 * thinned, and widening a CORE guard for one adapter's benefit is not this adapter's call.
 *
 * ## `externalWorkId` is `null`
 *
 * The holder assigns no reference of its own: the work row IS the record. Echoing `workId` back would
 * put a copy of core's own primary key into a column meaning "the holder's foreign reference", which
 * #2400 correlates inbound progress on.
 *
 * ## No `FulfillmentStatusSource`, deliberately
 *
 * That sub-capability is the pull-shaped read serving a POLLING holder — a vendor offering no webhook.
 * This holder is in-process. Implementing it would be actively wrong rather than merely redundant:
 * `getWorkFulfillmentStatus` would read `fulfillment_works`' own counters and report them back as
 * *observed progress*, which `IFulfillmentProgressService.record()` then writes to those same
 * counters. That closed loop is the second-source-of-truth this design exists to avoid, and every poll
 * would be either a no-op or a burnt duplicate claim. The absence is asserted positively in the spec
 * beside this file, not left to be inferred.
 *
 * Progress for OL-executed work therefore arrives from the operator pick-list surface (#2406/#2410).
 *
 * @module libs/oms/src/execution
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4, §9
 */
import type {
  FulfillmentCancellationRequest,
  FulfillmentExecutorPort,
  FulfillmentRequest,
  FulfillmentRequestResult,
} from '@openlinker/core/fulfillment';

/**
 * The dispatch answer, frozen at module scope.
 *
 * A shared frozen constant rather than a fresh literal per call, so replay-stability is a property of
 * the MODULE rather than of each call site agreeing to build the same object — and so a caller cannot
 * mutate what a later call will return.
 */
const AUTO_ACCEPTED_DISPATCH: FulfillmentRequestResult = Object.freeze({
  status: 'accepted',
  externalWorkId: null,
  acceptedAt: null,
} as const);

/**
 * The cancellation answer.
 *
 * Structurally identical to the dispatch answer today and deliberately a SEPARATE constant: they are
 * two independent decisions that happen to coincide, and sharing one would let a future change to
 * either silently change both.
 *
 * Answering `accepted` is honest here, where a `void` return would not be. The port warns that a
 * `void` cancellation "would assert a compliance the contract cannot obtain" — true in the general
 * case, where a third party is physically committed. This holder's work is OpenLinker's own and no
 * third party is committed, so the compliance genuinely can be obtained. Answering `rejected` instead
 * would invent a refusal from a holder that has no independent will, and `blocking: true` would then
 * exclude the OL-OMS from re-sourcing its own work.
 *
 * **Known gap, made reachable by this change rather than pre-existing it**: neither this adapter nor
 * `FulfillmentHandshakeService` checks the EXECUTION axis before cancelling — that guard is
 * `requestStatus === 'accepted'`, and for OL-executed work `requestStatus` stays `accepted` for the
 * life of the work because completion moves the other axis. So a cancellation against work already
 * picked, packed and shipped answers `accepted` and core persists `cancellation_accepted`. The path
 * was unreachable until now because no executor existed anywhere in the tree. **Owner: #2738**,
 * which prefers the core-side `FulfillmentWorkStatus` guard over the operator surface (#2406/#2410)
 * — a surface-only fix would leave the API path open, and the guard covers every future executor,
 * including a vendor whose own API would accept the cancellation just as readily.
 */
const AUTO_ACCEPTED_CANCELLATION: FulfillmentRequestResult = Object.freeze({
  status: 'accepted',
  externalWorkId: null,
  acceptedAt: null,
} as const);

export class OlFulfillmentExecutorAdapter implements FulfillmentExecutorPort {
  /**
   * Take the work. Unconditional, and a pure function of nothing — see this file's header for why
   * that is what makes the port's replay guarantee true rather than merely claimed.
   *
   * `Promise.resolve` rather than `async`: there is genuinely nothing to await, and an `async` body
   * with no `await` would need an `@typescript-eslint/require-await` suppression to say so.
   */
  requestFulfillment(_req: FulfillmentRequest): Promise<FulfillmentRequestResult> {
    return Promise.resolve(AUTO_ACCEPTED_DISPATCH);
  }

  /** Give the work back. See `AUTO_ACCEPTED_CANCELLATION` for why this may honestly comply. */
  requestCancellation(_req: FulfillmentCancellationRequest): Promise<FulfillmentRequestResult> {
    return Promise.resolve(AUTO_ACCEPTED_CANCELLATION);
  }
}
