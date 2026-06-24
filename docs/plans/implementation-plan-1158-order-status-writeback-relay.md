# Implementation Plan — #1158 OrderStatusWriteback capability + lifecycle-relay (inbound cancel → destination)

**Issue:** #1158 (Part of #1157; realises ADR-027). Closes #1132.
**Branch:** `1158-order-status-writeback-relay`
**Layer:** CORE (`orders`) + Integration (PrestaShop) + Worker (thin handler edit).

---

## 1. Goal (restated)

Lay the foundation of the Posture-A lifecycle relay:
1. A **role/platform-neutral, event-as-data** `OrderStatusWriteback` capability (per ADR-027).
2. **PrestaShop implements it**, delegating to its existing `updateFulfillment` internals.
3. A **core lifecycle-relay service** that propagates a lifecycle event to an order's other participants via the `isOrderStatusWriteback` guard — **zero platform-type branching**.
4. **Wire inbound cancel → destination**: a source `cancelled` event routes through the relay to each destination; an already-shipped destination surfaces an **operator-visible** outcome, never a silent no-op (the #1132 fix).

**Non-goals (this slice):** source-side writeback / Allegro impl (#1159); branch-1 shop-fulfilled → source (#1160); shop-as-source cancel detection (#1161); OL-owned canonical status / per-axis schema (#1032). No new `OrderStatus` values.

## 2. Key existing facts (researched)

- Capabilities live in `libs/core/src/orders/domain/ports/capabilities/` = interface + co-located `is{Capability}` guard, exported from `orders/index.ts`.
- `OrderStatus` = `pending|processing|shipped|delivered|cancelled|refunded` (`domain/types/order.types.ts`). `DispatchCarrierHint = { platformType }`.
- To subsume: `OrderDispatchNotifier.notifyDispatched(...)` (on `OrderSourcePort`) and `OrderFulfillmentUpdater.updateFulfillment({externalOrderId,status,trackingNumber?})` (on `OrderProcessorManagerPort`).
- PrestaShop `PrestashopOrderProcessorManagerAdapter` already implements `OrderFulfillmentUpdater`; `updateFulfillment` resolves a PS state id, writes tracking, then `order_histories` state change w/ `sendmail` (idempotent — skips if already in state).
- Inbound flow: `marketplace-order-sync.handler` carries `eventType` in the payload **but never uses it**; calls `OrderIngestionService.syncOrderFromSource(connId, externalOrderId, sourceEventId)` (no eventType). Job enqueue already dedups on `marketplace:${connId}:order:${eventKey}`.
- Destinations of an order = `identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Order, internalOrderId)` minus the source connection (pattern used by `shipment-dispatch-notification.service`).
- Adapter resolution: `IIntegrationsService.getCapabilityAdapter<T>(connId, capability)` + narrow with guard.

## 3. Design

### 3.1 Capability (event-as-data)

`domain/types/order-lifecycle-event.types.ts` (NEW):
```ts
export const OrderLifecycleEventTypeValues = ['dispatched', 'cancelled'] as const;
export type OrderLifecycleEventType = (typeof OrderLifecycleEventTypeValues)[number];

export type OrderLifecycleEvent =
  | { type: 'dispatched'; externalOrderId: string; trackingNumber?: string; carrier?: DispatchCarrierHint }
  | { type: 'cancelled'; externalOrderId: string; reason?: string };

export const OrderWritebackOutcomeValues = ['applied', 'unsupported', 'rejected'] as const;
export type OrderWritebackOutcome = (typeof OrderWritebackOutcomeValues)[number];
export interface OrderWritebackResult { outcome: OrderWritebackOutcome; detail?: string }
```

`domain/ports/capabilities/order-status-writeback.capability.ts` (NEW):
```ts
export interface OrderStatusWriteback {
  write(event: OrderLifecycleEvent): Promise<OrderWritebackResult>;
}
export function isOrderStatusWriteback<T extends object>(a: T): a is T & OrderStatusWriteback {
  return typeof (a as Partial<OrderStatusWriteback>).write === 'function';
}
```
Role-agnostic guard (generic `T`) — same adapter object may be resolved as `OrderProcessorManager` (this slice) or `OrderSource` (later slices). Both exported from `orders/index.ts`.

### 3.2 PrestaShop implements `OrderStatusWriteback`

`PrestashopOrderProcessorManagerAdapter` adds `OrderStatusWriteback` to its `implements` + a `write(event)` that **delegates to existing internals**:
- `dispatched` → `updateFulfillment({externalOrderId, status:'shipped', trackingNumber})` → `{outcome:'applied'}`.
- `cancelled` → read the order; if `current_state` is already a **past-cancellable** state (shipped/delivered) → `{outcome:'rejected', detail:'already shipped'}` (do **not** force state 6); else `updateFulfillment({status:'cancelled'})` → `{outcome:'applied'}`.
- Wrap PS exceptions → `{outcome:'rejected', detail}`. `OrderFulfillmentUpdater` **retained** (order provisioning / dispatch path unchanged).

> The "already shipped" check lives in the **adapter** because the destination shop is authoritative for its own live state — more correct than the relay guessing from OL's source-derived snapshot.

### 3.3 Core lifecycle-relay service

`application/interfaces/order-lifecycle-relay.service.interface.ts` (NEW):
```ts
export interface OrderLifecycleRelayInput {
  internalOrderId: string;
  originConnectionId: string;          // excluded from targets (self-echo at participant level)
  event: { type: 'dispatched'; trackingNumber?: string; carrier?: DispatchCarrierHint }
       | { type: 'cancelled'; reason?: string };
}
export interface OrderLifecycleRelayTargetResult { connectionId: string; outcome: OrderWritebackOutcome; detail?: string }
export interface OrderLifecycleRelayResult { targets: OrderLifecycleRelayTargetResult[] }
export interface IOrderLifecycleRelayService { relay(input: OrderLifecycleRelayInput): Promise<OrderLifecycleRelayResult> }
```
`application/services/order-lifecycle-relay.service.ts` (NEW): for each target participant —
1. `getExternalIds(Order, internalOrderId)` → targets = entries with `connectionId !== originConnectionId`.
2. Resolve adapter `getCapabilityAdapter<OrderProcessorManagerPort>(connId, 'OrderProcessorManager')`; **narrow `isOrderStatusWriteback`** → if absent, `outcome:'unsupported'` (log debug, continue).
3. `write({ ...event, externalOrderId })`; collect `{connectionId, outcome, detail}`.
4. **Explicit failure surfacing:** `rejected`/`unsupported` logged at `warn` with order+connection; `applied` at `log`. Per-target isolation (one failure doesn't block siblings).

**Guardrails in this slice (unidirectional source→destination):**
- *Re-delivery* → existing **job dedup** (`marketplace:…:eventKey`) + **idempotent adapter writes** (PS skips if already in state). No duplicate writes.
- *Regression / "already shipped"* → adapter-reported `rejected` (§3.2), surfaced visibly.
- *Self-echo across participants* → **not reachable in this direction** (destinations aren't ingested as sources until #1161); the durable relay-log + cross-participant echo suppression lands with the bidirectional slices (#1160/#1161). **Deliberately deferred — see §6 scope decision.**

### 3.4 Wire inbound cancel → destination

- `OrderIngestionService.syncOrderFromSource(connId, externalOrderId, sourceEventId?, eventType?)` — add `eventType`. If `eventType === 'cancelled'`:
  - resolve `internalOrderId = getInternalId(Order, externalOrderId, connId)`; if null → log warn ("cancel for unknown order") + return (can't cancel what we never created).
  - update the OrderRecord snapshot status → `cancelled` (projection of source truth; reuse repository update path).
  - `relay.relay({ internalOrderId, originConnectionId: connId, event: { type:'cancelled', reason } })`.
  - return a result distinguishing this from the create/update path.
  - **else** (created/updated/paid) → existing create/update path unchanged.
- `marketplace-order-sync.handler` → pass `payload.eventType` into the call. (Handler stays thin; branching lives in core.)

### 3.5 Wiring / tokens

- `orders.tokens.ts`: `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN = Symbol('IOrderLifecycleRelayService')`.
- `orders.module.ts`: provide `OrderLifecycleRelayService` + `useExisting` token binding + export. (No new TypeOrm entity in the deferred-ledger scope.)
- `orders/index.ts`: export capability, guard, event/result types, relay interface.

## 4. Step-by-step

1. `order-lifecycle-event.types.ts` + export. **AC:** types compile; `as const` unions.
2. `order-status-writeback.capability.ts` (interface + guard) + export. **AC:** guard narrows; unit test for guard.
3. PrestaShop `write()` + `implements`. **AC:** unit tests — dispatched→applied(+tracking); cancelled(not-shipped)→applied; cancelled(shipped)→rejected; PS error→rejected.
4. Relay interface + service + token + module wiring. **AC:** unit tests — fans out to destinations; excludes origin; unsupported when guard fails; per-target outcomes; warn on rejected.
5. `OrderIngestionService` eventType branch (+ interface) + handler passes eventType. **AC:** unit tests — cancelled routes to relay (not create); unknown order → warn+skip; non-cancel unchanged. **Closes #1132.**
6. Integration test: source `cancelled` event → destination order transitioned to cancelled (happy path) + already-shipped → rejected surfaced. (`pnpm test:integration`, full suite — capability ripples into routing int-specs.)
7. Quality gate: `pnpm lint` / `type-check` / `test` / `test:integration`.

## 5. Validation (architecture / standards)

- Capability + guard follow the established pattern; types in `*.types.ts`; relay is an app service implementing an interface via Symbol token (check-service-interfaces passes).
- No platform-type branching in the relay (capability-guard dispatch) — ADR-027 invariant.
- `OrderFulfillmentUpdater` retained for provisioning (ADR-027 migration); `OrderDispatchNotifier` fold-in completes in #1159 (Allegro) — not this slice.
- No `any`; `Logger` from shared; cross-context only via barrels.

## 6. Scope decision for the ⏸️ gate

**Recommended:** ship the relay **without** a durable relay-log table this slice. Rationale: #1158 is unidirectional (source cancel → destination write); OL never ingests its own writes here, so cross-participant echo is not yet possible, and re-delivery is already covered by job-dedup + idempotent adapter writes. A durable `(order,event,source-event-id)` ledger + full self-echo suppression is additive guardrail infra that belongs with the **bidirectional** slices (#1160/#1161) where it is actually exercised — adding it now is speculative (a migration + ORM entity + repo for a flow that doesn't exist yet).

**Alternative:** build the durable relay-log now (adds a migration + ORM entity + repository) for at-most-once + audit from day one.

**Open question:** the "already shipped" guard is adapter-reported (§3.2). Acceptable, or do you want the relay to also consult Shipment state (adds an orders→shipping read dependency)?

## 7. Risks

- **Dependency ordering:** #1158 depends on ADR-027/spec landing via #1162 (cosmetic — no code import). Real dependency is #1159/#1160/#1161 consuming this capability.
- **OL snapshot not updated on cancel (deliberate):** the relay owns **no canonical status** (ADR-027), so the cancel path does **not** mutate the `order_records` snapshot — it only propagates to destinations. OL's own record reflecting source-cancel is the deferred #1032 canonical-status axis; order-health already derives from `recordStatus` + `syncStatus[]`, not the snapshot status.
- **Out-of-order cancel-before-create (known residual, #1160):** a `cancelled` event processed before the order's create/sync job leaves no destination to cancel; the later create then provisions the order as active. This slice **narrows** the prior total no-op but does not fully close the race — that needs the deferred monotonic / relay-log machinery (ADR-027 guardrails). Documented in code (`handleSourceCancellation`) and surfaced via warn-logging of non-`applied` relay outcomes; full resolution tracked with the bidirectional slices.
