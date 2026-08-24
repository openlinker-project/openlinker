/**
 * Order Lifecycle — public barrel (#2305)
 *
 * The **second dependency-free vocabulary leaf** (ADR-053 names it as such;
 * ADR-059 requires it). It owns the vocabulary the OMS lifecycle projection
 * speaks — the derived `OrderLifecyclePhase` and its precedence, the merged
 * `HoldReason` union, `OrderAmendmentKind`, `LifecycleAuthority` and its pure
 * coercer, the internal-only `OmsLifecycleFact` union, and the one-way
 * `phaseToOrderStatus` projection.
 *
 * **Leaf posture.** No NestJS module, no service, no repository, no tokens
 * file. Per ADR-053 that is the **starting** posture, not a permanent vow: the
 * load-bearing property is **zero sibling-core-context VALUE edges** (which is
 * what makes cross-context value-imports CJS-cycle-safe, and what
 * `barrel-purity.spec.ts` enforces after #2170 narrowed it to exactly that).
 * Framework-freedom is incidental and **ends the day the concern needs a
 * binding** — `sales-documents` began here in #2100 and outgrew it in #2170,
 * gaining a module and a `sales-documents.tokens.ts` while keeping the
 * sibling-edge property intact. This leaf will do the same when its first
 * binding arrives; that is the designed evolution, not a violation of it.
 *
 * **The one authorized cross-context import** is `OrderStatus`, imported
 * TYPE-ONLY from the `@openlinker/core/orders/types` cycle-breaker sub-barrel
 * by `phaseToOrderStatus`. It erases at build time, so it adds no runtime edge
 * — the same carve-out `sales-documents` already holds for `Order` (ADR-041
 * decision 2). When #2308 generalizes the barrel-purity leaf walker, this leaf
 * must be registered with that exception. Restating the six status strings
 * locally was considered and rejected: two sources of truth for a transport
 * vocabulary is the drift the mapping exists to prevent.
 *
 * **Relationship to the existing canonical vocabularies** (ADR-059's Decision,
 * restated here because it is the revert precondition ADR-043 failed to meet):
 * `OrderStatus` (`pending|processing|shipped|delivered|cancelled|refunded`)
 * stays the **transport** vocabulary for `OrderCreate` /
 * `OrderFulfillmentUpdater`; the phase projects **one-way** onto it for
 * writeback via `phaseToOrderStatus` and **never reads back** from it.
 * `order_state_mappings` — the operator-configured destination status
 * translation — remains the transport-layer translation and **never feeds the
 * derivation**.
 *
 * **Nothing consumes this leaf yet.** #2307 adds `deriveOrderLifecyclePhase`,
 * #2309 the SQL twin and API projection, #2310 the FE mirror, #2311 the
 * mirror-check scripts. This issue is vocabulary only — zero behaviour change.
 *
 * **Naming note (REVIEW H14):** the design prose says `OrderHoldReason`; the
 * shipped identifier is `HoldReason`, because the union is used at both the
 * order and fulfilment-work grains. Do not "correct" it back.
 *
 * @module libs/core/src/order-lifecycle
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
export * from './domain/types/order-lifecycle-phase.types';
export * from './domain/types/hold-reason.types';
export * from './domain/types/order-amendment-kind.types';
export * from './domain/types/lifecycle-authority.types';
export * from './domain/types/oms-lifecycle-fact.types';
export * from './domain/domain-services/phase-to-order-status';
export * from './domain/domain-services/derive-order-lifecycle-phase';
