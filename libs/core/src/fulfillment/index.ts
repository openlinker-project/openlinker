/**
 * Fulfillment — public barrel (#2391)
 *
 * The `FulfillmentWork` vocabulary: the unit of fulfilment assignment, and the
 * two orthogonal state axes it carries.
 *
 * **Leaf posture.** This context follows ADR-053's types-and-pure-functions
 * shape, the same as `sales-documents` (#2100), `fulfillment-authority` (#2304)
 * and `order-lifecycle` (#2305). It ships a `fulfillment.tokens.ts` from day
 * one — unlike the other two — because its first DI binding is already named
 * (#2392); see that file.
 *
 * **The load-bearing property is ZERO SIBLING-CONTEXT VALUE EDGES, not
 * framework-freedom.** Framework-freedom ends the day this context gains a
 * module (#2392, ADR-053 says so explicitly). What must not lapse is that
 * nothing here creates a runtime edge to a sibling core context, which is what
 * keeps a consumer's value-import CJS-cycle-safe;
 * `libs/core/src/__tests__/barrel-purity.spec.ts` enforces it per leaf.
 *
 * **The one authorized cross-context import** is `FulfillmentCancellationReason`
 * from `@openlinker/core/fulfillment-authority`, **type-only** and therefore
 * erased at build time. See `fulfillment-work.types.ts` for the two conditions
 * that make it safe.
 *
 * **ADR-053's no-injection invariant, binding on everything under this
 * directory**: the `fulfillment` context injects **no** `orders` / `inventory`
 * service. Order data enters as ARGUMENTS (which is why `FulfillmentWork.orderId`
 * is a plain string); a type need goes through `@openlinker/core/orders/types`, which that guard permits by exact-specifier match. Note it is deliberately NOT in this leaf's `ZERO_SIBLING_EDGE_LEAVES` allow-set, so taking that route additionally requires a one-line registration there — per-leaf and deliberate, never a free ride.
 * Enforced as a prohibition by `scripts/check-no-injection-contracts.mjs`, whose
 * source-text scan cannot see `ModuleRef.get(TOKEN, { strict: false })` — the
 * complement is `apps/worker/test/integration/fulfillment-no-injection-boot.int-spec.ts`.
 *
 * | Published | What it answers |
 * |---|---|
 * | `FulfillmentWorkStatus` | how far the physical work has got (execution axis) |
 * | `FulfillmentRequestStatus` | what has been asked of a holder, and their answer (negotiation axis) |
 * | `FulfillmentWorkAction` | the closed set of things that can be done to a work object |
 * | `FulfillmentWork` / `FulfillmentWorkLine` / `FulfillmentWorkRef` | the aggregate, its counter-bearing lines, and the ref an executor is handed |
 * | `FulfillmentRouterPort` | how a router is asked where an order is sourced from |
 * | `RoutingInput` / `RoutingShipTo` | what a router is told — an explicit PII allowlist projection (ADR-062) |
 * | `RoutingPlan` / `RoutingEvaluation` | the committing answer, and the non-committing one |
 * | `FulfillmentExecutorPort` | how a holder is offered work, and asked to give it back |
 * | `FulfillmentRequest` / `FulfillmentCancellationRequest` | what an executor is told — the same ADR-062 allowlist discipline, reusing `RoutingShipTo` |
 * | `FulfillmentRequestResult` | `accepted` or `rejected{reason, blocking}` — `blocking` is what stops re-sourcing looping |
 * | `FulfillmentStatusSource` | the optional pull a POLLING holder is served by (guard-narrowed, never dispatched) |
 *
 * ## What consumes this
 *
 * Nothing yet — the vocabulary ships first so the contexts that adopt it adopt
 * one spelling (the #2304 posture). #2392 persists it, #2395 creates it in one
 * transaction with the routing decision, #2398/#2399 carry it across the
 * executor port, #2406 projects it with `supportedActions`.
 *
 * @module libs/core/src/fulfillment
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */
export * from './domain/types/fulfillment-work-status.types';
export * from './domain/types/fulfillment-request-status.types';
export * from './domain/types/fulfillment-work-action.types';
export * from './domain/types/fulfillment-work.types';
export * from './domain/types/routing-ship-to.types';
export * from './domain/types/routing.types';

export * from './domain/types/fulfillment-execution.types';

export * from './domain/ports/fulfillment-router.port';
export * from './domain/ports/fulfillment-executor.port';
export * from './domain/ports/capabilities/fulfillment-status-source.capability';

export * from './domain/exceptions/pending-routing-plan-not-supported.error';
export * from './domain/exceptions/unrecognised-fulfillment-request-result.error';

export * from './domain/types/fulfillment-hold.types';
export * from './domain/types/fulfillment-work-rejection.types';

export type { IFulfillmentHandshakeService } from './application/services/fulfillment-handshake.service.interface';
export * from './application/types/fulfillment-handshake.types';

// The INPUT shapes are exported; `FulfillmentWorkRepositoryPort` itself is
// deliberately NOT — a `*RepositoryPort` is an intra-context persistence
// contract, and `check-cross-context-imports` rejects it by deny pattern (the
// `ReservationRepositoryPort` / `OrderHoldRepositoryPort` precedent). A sibling
// context reaches this aggregate through an `I*Service`; a host-side test
// resolves the token against a local structural type (the
// `diagnostic-holds-are-inert.int-spec.ts` shape).
export type {
  CancelFulfillmentWorkInput,
  ClaimFulfillmentDispatchInput,
  CreateFulfillmentWorkInput,
  CreateFulfillmentWorkLineInput,
  FulfillmentWorkTransaction,
  PlaceFulfillmentHoldInput,
  RecordFulfillmentAcceptanceInput,
  RecordFulfillmentLineProgressInput,
  RecordFulfillmentRejectionInput,
  ReleaseFulfillmentHoldInput,
  TransitionFulfillmentRequestStatusInput,
  TransitionFulfillmentWorkStatusInput,
} from './domain/ports/fulfillment-work-repository.port';

export { DuplicateFulfillmentWorkLineError } from './domain/exceptions/duplicate-fulfillment-work-line.error';
export { FulfillmentHoldAlreadyReleasedError } from './domain/exceptions/fulfillment-hold-already-released.error';
export { FulfillmentHoldLimitExceededError } from './domain/exceptions/fulfillment-hold-limit-exceeded.error';
export { FulfillmentHoldNotFoundError } from './domain/exceptions/fulfillment-hold-not-found.error';
export { FulfillmentPersistenceError } from './domain/exceptions/fulfillment-persistence.error';
export { FulfillmentWorkNotFoundError } from './domain/exceptions/fulfillment-work-not-found.error';
export { FulfillmentWorkUnassignedError } from './domain/exceptions/fulfillment-work-unassigned.error';

export * from './domain/types/fulfillment-progress-event.types';
export * from './domain/types/routing-decision.types';

// `IFulfillmentProgressService` (#2400) — the single core-side progress ingress
// seam. Its `FulfillmentProgressClaimRepositoryPort` is deliberately NOT here,
// for the same reason `FulfillmentWorkRepositoryPort` is not: a
// `*RepositoryPort` is an intra-context persistence contract that
// `check-cross-context-imports` rejects by deny pattern.
export type { IFulfillmentProgressService } from './application/interfaces/fulfillment-progress.service.interface';

export { RoutingDecision } from './domain/entities/routing-decision.entity';
export { RoutingDecisionAlreadyLiveError } from './domain/exceptions/routing-decision-already-live.error';
// Same rule one table over: the INPUT shapes are exported, while
// `RoutingDecisionRepositoryPort` itself is not. #2395 injects it by token from
// inside this context.
export type {
  ClaimRoutingIntentInput,
  TerminaliseRoutingDecisionInput,
} from './domain/ports/routing-decision-repository.port';

export { FulfillmentModule } from './fulfillment.module';

export * from './fulfillment.tokens';
