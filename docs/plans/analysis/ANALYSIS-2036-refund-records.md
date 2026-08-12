# Pre-Implementation Analysis: Refund Records (#2036)

**Plan**: `docs/plans/implementation-plan-refund-records.md`
**Issue**: [openlinker-project/openlinker#2036](https://github.com/openlinker-project/openlinker/issues/2036)
**Date**: 2026-08-12
**Verdict**: **READY**

---

## Reuse Findings

| Plan Artifact | Classification | Evidence |
|---|---|---|
| `RefundRecord` domain entity (`libs/core/src/orders/domain/entities/refund-record.entity.ts`) | **NEW (confirmed absent)** | No file matching `*refund*` and no `class RefundRecord` anywhere in `libs/**`. |
| `RefundRecordRepositoryPort` (`libs/core/src/orders/domain/ports/refund-record-repository.port.ts`) | **NEW** | Not found under `libs/core/src/**/domain/ports/**`. Existing `orders` ports (`order-source.port.ts`, `order-processor-manager.port.ts`, `order-record-repository.port.ts`, and the five capability files under `domain/ports/capabilities/`) have no refund/return/withdrawal semantics. |
| `refund-record.types.ts` (`RefundReason`, `RefundReasonValues`, `RefundSummary`, `CreateRefundRecordInput`) | **NEW** | Not present in `libs/core/src/orders/domain/types/**`. |
| `RefundRecordOrmEntity` / `refund_records` table | **NEW** | No `.orm-entity.ts` file anywhere mentions "refund"; no existing migration references `refund_records`. |
| `RefundRecordRepository` (infra) | **NEW** | No corresponding class found. |
| `IOrderRefundService` / `OrderRefundService` | **NEW** | Not found under `libs/**/application/services/**` or `libs/**/application/interfaces/**`. |
| `ORDER_REFUND_RECORD_REPOSITORY_TOKEN`, `ORDER_REFUND_SERVICE_TOKEN` | **NEW** | Confirmed absent from `libs/core/src/orders/orders.tokens.ts`, whose current tokens are `ORDER_SYNC_SERVICE_TOKEN`, `ORDER_INGESTION_SERVICE_TOKEN`, `ORDER_RECORD_REPOSITORY_TOKEN`, `ORDER_RECORD_SERVICE_TOKEN`, `ORDER_DESTINATION_RETRY_SERVICE_TOKEN`, `ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN`, `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN`. |
| `RefundsController` (`apps/api/src/orders/http/refund.controller.ts`) | **NEW** | No controller named `RefundsController`/`RefundController` and no route containing `/refunds` anywhere under `apps/api/src/**`. |
| Request/response DTOs (`record-refund-request.dto.ts`, `refund-record-response.dto.ts`) | **NEW** | Not present under `apps/api/src/**`. |
| Migration `1833000000000-create-refund-records.ts` | **NEW, timestamp confirmed free** | Current migration tail is `1832000000007-add-shipment-waybill-relayed-at.ts` (94 files total); `1833000000000` sorts strictly after it and is unused. |

**Adjacent-but-distinct concept** (not a collision, noted for context): `PaymentStatusValues` already declares a `'refunded'` member (`libs/core/src/orders/domain/types/payment-status.types.ts`), used today only as a status enum value in `dispatch-payment-policy.types.ts` / `order-record.entity.ts`'s `paymentStatus` getter. This is a status flag, not a repository/entity/service, and the plan already documents (§ Scope, § Assumptions) that it deliberately leaves this enum untouched. No conflict.

**Verdict for this phase**: every artifact the plan proposes to create is confirmed **NEW** — no reuse collision, no partial-overlap requiring the plan to extend an existing port/service instead of adding a new one.

---

## Backward-Compatibility Findings

The plan is **purely additive** — it changes three existing files (`orders.tokens.ts`, `libs/core/src/orders/orders.module.ts`, `libs/core/src/orders/index.ts`) by appending new exports/providers, and registers one new controller in `apps/api/src/orders/orders.module.ts` alongside the existing `OrdersController`. No existing symbol is removed, renamed, or retyped.

| Surface | Check | Result |
|---|---|---|
| Top-level barrel `@openlinker/core/orders` | Existing exports enumerated (`OrderSourcePort`, `OrderProcessorManagerPort`, `IOrderRecordService`, `OrderRecord`, `OrderRecordRepositoryPort`, `OrdersModule`, …) — none of the plan's new symbol names (`RefundRecord`, `RefundReason`, `RefundReasonValues`, `RefundSummary`, `CreateRefundRecordInput`, `RefundRecordRepositoryPort`, `IOrderRefundService`, `OrderRefundService`) collide with any existing export. | ✅ No break — pure addition. |
| Port method signatures | No existing port (`OrderSourcePort`, `OrderProcessorManagerPort`, `OrderRecordRepositoryPort`, or any capability) is modified by this plan. | ✅ No break. |
| DTO shapes | Only new DTOs are added (`RecordRefundRequestDto`, `RefundRecordResponseDto`); no existing DTO is touched. | ✅ No break. |
| Symbol tokens | `orders.tokens.ts` gains two new `export const ..._TOKEN` lines; none of the seven existing tokens are removed or renamed. The sub-barrel's `export * from './orders.tokens'` in `index.ts` picks up the new tokens automatically, per the documented convention — no second edit needed there. | ✅ No break. |
| ORM schema | New table `refund_records`, no ALTER on any existing table. Migration is existence-guarded (`getTable()` check) and its `down()` is `IF EXISTS`-guarded, matching the `1808000000000-create-invoice-records.ts` template the plan cites. | ⚠️ Warning (expected, not a defect) — requires the new migration, which the plan already scopes correctly (`docs/migrations.md` workflow, timestamp `1833000000000` confirmed free of collision and strictly after the current tail `1832000000007`). |
| `check:invariants` — `check-service-interfaces.mjs` | Requires every `libs/core/src/<ctx>/application/services/*.service.ts` to `implements` either an `I*Service` with a sibling `*.service.interface.ts` (colocated in `application/services/` or `application/interfaces/`) or a `*Port`. The plan's Step 9 puts `IOrderRefundService` in `application/interfaces/order-refund.service.interface.ts` and Step 10 has `OrderRefundService implements IOrderRefundService` — satisfies the rule as written; matches the `OrderRecordService`/`IOrderRecordService` precedent exactly. | ✅ No trip. |
| `check:invariants` — `check-cross-context-imports.mjs` | Denies cross-context imports of `*RepositoryPort` and `*OrmEntity` from the bare `@openlinker/core/<ctx>` barrel. The plan's Step 12 barrel edit *does* add `RefundRecordRepositoryPort` to the main `orders/index.ts` barrel (mirroring the existing `OrderRecordRepositoryPort` export already there) — this is intra-context-safe (the rule only fires for *cross-context* importers), and the plan correctly keeps `RefundRecordOrmEntity` off the main barrel, routing it only through the host-only `orm-entities.ts` sub-barrel (Step 5). | ✅ No trip, but see Open Question below re: whether `RefundRecordRepositoryPort` needs to be on the main barrel at all. |
| Deep-barrel / sub-barrel imports | `orm-entities.ts`'s own doc comment says "Add new ORM entities here only when an external consumer needs them." The plan's Step 5 adds `RefundRecordOrmEntity` there unconditionally. | ⚠️ Minor — see Open Question below. |

No Critical items. One Warning is the expected, already-correctly-scoped migration. A second, smaller Warning is noted as an open question rather than a blocker, since it doesn't break anything — it's a "is this addition strictly necessary" question, not a compatibility risk.

---

## Open Questions

1. **Does `RefundRecordOrmEntity` actually need a spot on `orm-entities.ts`?** That sub-barrel exists so a *cross-context or plugin* consumer can reach an ORM entity directly (its own doc comment: "only when an external consumer needs them"). The plan's Step 11 (`orders.module.ts`) already registers `RefundRecordOrmEntity` via `TypeOrmModule.forFeature` using a same-module relative import — that doesn't need the sub-barrel. Nothing else in the plan (no integration test helper, no sibling-context module) is identified as needing direct ORM access. **Suggested resolution during implementation**: skip the `orm-entities.ts` edit unless a concrete consumer materializes (e.g. an integration-test fixture needing to seed rows directly); it's a one-line addition later if actually needed, and omitting it for now is a strictly safer default than exporting something with no consumer.

2. **Does `RefundRecordRepositoryPort` need to be on the main `index.ts` barrel at all?** The plan's own § 8 (Validation & Risks) notes the controller reaches `orders` only through `IOrderRefundService`/`IOrderRecordService`, never the repository port directly — and no cross-context consumer of the port is identified anywhere in the plan. `OrderRecordRepositoryPort` is exported today, but that's an existing precedent, not proof this new port needs the same treatment. **Suggested resolution during implementation**: export it from the barrel only if a concrete need for direct cross-context/test access to the port interface appears (e.g. a unit test importing the port type from the barrel rather than a relative path within `orders`); otherwise keep it off the main barrel and only reachable via relative import inside `libs/core/src/orders/**`, minimizing the published surface per the "the contract surface is what's published from the barrel" principle in `docs/architecture-overview.md § Cross-context dependencies in core`.

Neither question blocks implementation — both are "add the export now vs. defer it" calls with an obvious safe default (defer), not architecture mistakes. They're flagged so the plan's Steps 5 and 12 can be trimmed slightly during implementation rather than followed to the letter.

---

## Summary

All ten artifacts the refund-records plan proposes to create — the `RefundRecord` entity, its types file, `RefundRecordRepositoryPort`, `RefundRecordOrmEntity`, `RefundRecordRepository`, `IOrderRefundService`/`OrderRefundService`, two new DI tokens, `RefundsController`, and the `refund_records` migration — are confirmed genuinely new with zero collisions against the live repository, and the plan's proposed edits to `orders.tokens.ts`, `orders.module.ts` (core and API), and `orders/index.ts` are purely additive with no broken barrel export, port signature, DTO shape, token, or `check:invariants` rule. The migration timestamp `1833000000000` is confirmed free and correctly ordered past the current tail (`1832000000007`). Two minor, non-blocking open questions are noted about whether two of the barrel/sub-barrel exports (`RefundRecordOrmEntity` on `orm-entities.ts`, `RefundRecordRepositoryPort` on the main barrel) are strictly necessary given no identified consumer — both have a safe "defer until needed" resolution and don't change the verdict. **Verdict: READY** — implementation can proceed as planned.
