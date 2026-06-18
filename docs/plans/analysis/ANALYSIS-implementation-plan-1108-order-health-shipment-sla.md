# Pre-implement analysis — #1108 (order-health: shipment state + ship-by SLA)

**Plan:** `docs/plans/implementation-plan-1108-order-health-shipment-sla.md`
**Gate date:** 2026-06-18 · **Verdict: `NEEDS-REVISION`**

One reuse collision (fulfillment-state vocabulary) must be reconciled in the plan before coding. Everything else is additive and clean; the migration is an expected Warning.

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `SlaStateValues` / `SlaState` (`none\|on_track\|at_risk\|overdue`) | **NEW (absent)** | No `SlaState`/`slaState`/`at_risk` anywhere in `libs/core` or `apps/web`. |
| `deriveSlaState(...)` helper (core + FE) | **NEW (absent)** | Not found. |
| `FulfillmentStateValues` / `FulfillmentState` (core, new) | **⚠ COLLISION → revise** | Core orders **already exports** `FulfillmentStatus` (`['delivered','dispatched','cancelled']`, the OMP read-back view) from the top-level barrel (`orders/index.ts:32,36`, `fulfillment-status-snapshot.types.ts:36`). FE **already** has `FulfillmentStateValues` (`['not-shipped','dispatched','delivered','failed','unavailable']`, hyphenated) in `apps/web/.../order-health.ts:124`. The plan's new core `FulfillmentState` (`not_shipped\|dispatched\|delivered\|failed`) is a **third, near-identical vocabulary** and is one character off the existing exported `FulfillmentStatus`. |
| `order_records.fulfillmentState` column | **NEW (absent)** | No fulfillment column on `order-record.orm-entity.ts` (only `recordStatus`, `syncStatus`, `dispatchByAt`). |
| `IOrderRecordService.updateFulfillmentState(orderId, state)` | **PARTIAL (extend)** | Interface exists (`order-record.service.interface.ts:19`, methods: `persistOrder`, `updateSyncStatus`, `persistIncomingSnapshot`, `getOrderRecord`). Method is new/additive — mirror `updateSyncStatus`. **Only one impl** (`order-record.service.ts`) to update. |
| shipping `recomputeOrderFulfillment(orderId)` + write-path calls | **NEW (absent)** | No order-level fulfillment rollup in shipping today. |
| `slaState` / `fulfillmentState` on list/summary DTOs + filters | **PARTIAL (extend)** | `dispatchByAt` already on `OrderRecordResponseDto`; new fields are additive. |

## Backward-compatibility findings

- **Warning — migration required.** New `order_records.fulfillmentState` column + index. Latest migration is `1808000000000-create-invoice-records.ts`; the new file MUST sort **after** it (e.g. `1809000000000-...`) to satisfy the migration-ordering guard (#1020). Provide up + down; verify `migration:show`.
- **Low (additive) — `IOrderRecordService` gains a method.** It's consumed cross-context by `shipping` (imports `IOrderRecordService` from `@openlinker/core/orders` — confirmed in shipment-dispatch/status-sync specs). Adding a method is additive and the *sanctioned* push-direction (`shipping → orders`); **no `orders → shipping` edge is introduced** (good — that would be a cross-context cycle). Update the single impl + any inline `jest.Mocked<IOrderRecordService>` test objects.
- **Low (additive) — response DTO fields.** `slaState` + `fulfillmentState` are new optional fields; no removed/retyped field → no break.
- **`check:invariants`: expected clean.** No deep-barrel imports planned; cross-context surface stays `IOrderRecordService` + token; `as const` unions in `*.types.ts`; service keeps its `implements` clause. Confirm the FE↔core type alignment doesn't tempt a deep import.

## Open questions (resolve in the plan before coding)

1. **Fulfillment-state naming + vocabulary (blocking-for-clarity).** Pick a name that doesn't collide with the existing exported `FulfillmentStatus`. Options: (a) reuse/rename to something explicit like `OrderFulfillmentRollup`/`FulfillmentRollupState`; (b) align the **value spelling** with the FE (`not-shipped` hyphen vs `not_shipped` underscore) and decide whether `unavailable` (FE-only render state from shipping-capability) belongs in the stored vocab (recommend: **no** — keep it FE-render-only, store `not_shipped`/null). Whatever is chosen, the FE `FulfillmentState` and the new core type should share one spelling to avoid a translation layer.
2. **Rollup precedence ownership.** Confirm the rollup derivation (N shipments → one state) lives in **shipping** (it owns shipment status) and orders only *stores* the pushed value — the plan says this; keep it so (orders must not import shipping).
3. **SLA × fulfillment interaction.** Confirm the "overdue clears once shipped" rule is computed where both signals are available (FE has both off the row post-change; or define an `effectiveSla` that the BE leaves raw and the FE combines). Plan leans FE-combine — make it explicit.

## Bottom line
`NEEDS-REVISION`: the design is sound and almost entirely additive (no contract breaks; migration is expected and acknowledged; cross-context direction is correct). The one must-fix before coding is the **fulfillment-state vocabulary collision** — three overlapping types (`FulfillmentStatus` core / `FulfillmentState` FE / proposed `FulfillmentState` core). Reconcile the name + spelling in the plan, then proceed.
