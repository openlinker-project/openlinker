# Pre-implement readiness gate — `implementation-plan-relay-hygiene.md` (#2401)

**Date**: 2026-08-31 · **Branch**: `2401-relay-hygiene-impl` (off `origin/oms-programme-wave-3a`)
**Scope**: read-only. No code, no plan edits.

## Verdict: **READY**

No Critical findings. Zero name collisions, zero contract-surface breaks, no migration
needed. Three MINOR notes below are worth folding in but none blocks implementation.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `FulfillmentRelayGateService` / `IFulfillmentRelayGateService` | **NEW** | No hit anywhere in `libs/`, `apps/`. |
| `FULFILLMENT_RELAY_GATE_SERVICE_TOKEN` | **NEW** | `fulfillment.tokens.ts:1-45` holds 5 tokens; none is this. |
| `FulfillmentDispatchRelayService` (orders) | **NEW** | No hit. Nearest names are `shipping`'s private `relayDispatched` / `relayDispatchedToSource` — different context, different grain, no collision. |
| `FulfillmentDispatchRelayClaim` | **NEW** | No hit. |
| `FulfillmentWorkRepositoryPort.releaseDispatchRelay` | **NEW** | Only a *forward reference* exists — `fulfillment-progress-event.types.ts:145` ("adds its `releaseDispatchRelay` counterpart"). Nothing implements it. |
| `claimDispatchRelay` | **ALREADY EXISTS → reuse** | Port `fulfillment-work-repository.port.ts:246-247`; impl `fulfillment-work.repository.ts:443-460`, already `WHERE "dispatchRelayedAt" IS NULL` **and** already bumping `version` via `applyGuardedUpdate`. Plan §4.6 correct: nothing to add. |
| `applyGuardedUpdate` helper | **ALREADY EXISTS → reuse** | `fulfillment-work.repository.ts:646-659`, private, returns `affected > 0`, wraps errors in `FulfillmentPersistenceError`. Exactly the shape §5.5 assumes. |
| `FulfillmentRelayIntent` `kind: 'dispatch'` | **ALREADY EXISTS → consume** | `fulfillment-progress-event.types.ts:149-153`; emitted today at `fulfillment-progress.service.ts:177-181` on the `shipped` branch. #2400 is merged on this branch. |
| `OrderLifecycleRelayInput.authoredByConnectionId` | **PARTIAL (extend)** | `order-lifecycle-relay.service.interface.ts` — the interface exists with `internalOrderId` / `originConnectionId` / `event`. Adding an optional field is additive. |
| `dispatched` `OrderLifecycleEvent` member | **ALREADY EXISTS** | `order-lifecycle-event.types.ts:24` + `:54-59`. Fields: `type`, `externalOrderId` (**stripped** by the relay's `OrderLifecycleRelayEvent` Omit), optional `trackingNumber`, optional `carrier`. **Plan §10 assumption (1) is confirmed: a work-dispatch fact can legitimately omit both optionals.** |
| No migration | **CONFIRMED** | `dispatchRelayedAt` in `1864000000000-create-fulfillment-works.ts:87`; ORM `fulfillment-work.orm-entity.ts:135`; `version` at `:203`. `fulfillment_progress_claims` = `1865000000000`. Nothing new. |

## Backward-compatibility findings

| Surface | Status |
|---|---|
| `OrderLifecycleRelayInput` — added OPTIONAL field | **No break.** All 6 production `.relay(` call sites keep compiling: `fulfillment-status-sync.service.ts:481,511`, `shipment-status-sync.service.ts:377`, `shipment-dispatch-notification.service.ts:184`, `relay-status-to-source-executor.service.ts:112`, `order-ingestion.service.ts:788`. (Plus 11 in `order-lifecycle-relay.service.spec.ts`.) None passes `authoredByConnectionId`, so AC2 (absent ⇒ byte-identical) is what they all exercise. |
| `FulfillmentWorkRepositoryPort` — added method | Intra-context port; **not** on the barrel (index.ts comments say so explicitly). Only in-tree implementer is `FulfillmentWorkRepository`. No plugin surface. |
| `@openlinker/core/fulfillment` barrel | Additive: one `export type { IFulfillmentRelayGateService }` line; the token rides the existing `export * from './fulfillment.tokens'`. |
| `orders → fulfillment` new edge | **Safe.** `check-cross-context-imports` allow-shapes cover `I*Service`, `*_TOKEN`, published type aliases. `FulfillmentModule.imports` is only its own `TypeOrmModule.forFeature` — no sibling, so no Nest cycle from `OrdersModule` importing it. `FulfillmentModule` is already in `apps/api/src/app.module.ts:89` and `apps/worker/src/app.module.ts:73`, so the int-spec is reachable. |
| `barrel-purity.spec.ts` | Not tripped. The new gate service/type import nothing from a sibling; `fulfillment`'s allow-set (`fulfillment-authority`, `order-lifecycle`) is untouched. |
| `check-no-injection-contracts.mjs` | Not tripped — forbids `@openlinker/core/orders` / `/inventory` **inside** `libs/core/src/fulfillment`, and matches exact specifiers. The plan deliberately keeps the relay call in `orders`. |
| `apps/worker/test/integration/fulfillment-no-injection-boot.int-spec.ts` | Still green: it asserts `FulfillmentModule.imports` names no `OrdersModule` and no provider injects an orders/inventory token. The gate injects only `FULFILLMENT_WORK_REPOSITORY_TOKEN`. |
| `check-service-interfaces` | Both new services declare `implements I*Service` with a sibling `*.service.interface.ts` — compliant as planned. |

## Minor notes (fold in; not blocking)

1. **§4.4's contrast with the shipping precedent is factually correct.** `ShipmentRepository.releaseWaybillRelay` (`shipment.repository.ts:191-195`) really is an unconditional `update({id}, {waybillRelayedAt: null})` with a comment saying only the claim holder calls it. The fulfilment twin's added `AND "dispatchRelayedAt" IS NOT NULL` is a real divergence for a real reason (version-counter honesty), so state it as such in the method docblock rather than as "mirrors shipping".
2. **`holderConnectionId` can move between claim and relay.** `FulfillmentWork.assignedConnectionId` is `string | null` **and** re-routing moves it (`fulfillment-work.types.ts:45,117`). §4.5's read-then-claim ordering means the projected holder is the value at read time. Worth one sentence in the claim's docblock: the holder reported is a snapshot, not a lock.
3. **The `dispatch` intent carries only `workId`** (`fulfillment-progress-event.types.ts:151-152`) — no `orderId`, no holder. So the gate's read is not an optimisation, it is the only source of both; the plan already reads first, but the interface docblock should say the read is load-bearing, not defensive.

## Open questions

None blocking. §10's flagged judgement call (`authoredByConnectionId` == `originConnectionId` for this issue's only consumer) is confirmed accurate against the live tree: `ShipmentDispatchNotificationService` really does pass the **carrier** connection as `originConnectionId`, so the two fields genuinely diverge there and the new field is not redundant.
