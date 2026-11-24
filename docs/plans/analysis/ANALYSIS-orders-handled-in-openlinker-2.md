# Pre-implement gate - implementation-plan-orders-handled-in-openlinker-2 (#3482 part 2)

Plan: `docs/plans/implementation-plan-orders-handled-in-openlinker-2.md`. Tree: worktree `3482-orders-handled-in-openlinker-2`, head `50be3164f` (PR #3797, stacked on #3014). Read-only gate; nothing in the plan or source was edited.

## Verdict: READY

No Critical finding. Every contract change is additive. The warnings below are things the implementation must do, not reasons to revise the plan.

## Reuse findings

| Plan artifact | Result | Evidence |
|---|---|---|
| `WaitingFulfillmentBlockReasonValues` (3 reasons) | **NEW**, related | `fulfillment-block-reason.types.ts` has `FulfillmentBlockReasonValues` and `REROUTABLE_FULFILLMENT_BLOCK_REASONS` (`routing-refused`, `routing-failed`). The waiting set adds `routing-no-shipping-address`, so it cannot reuse the reroutable list. Declare it beside them with `satisfies readonly FulfillmentBlockReason[]` |
| `OrderRecordFilters.waitingInOpenLinker`, `.onPackBench` | **NEW** | `order-record.types.ts:412` has `packed?: boolean` (#2997, `packedAt IS [NOT] NULL`). Different axis; name must stay `onPackBench`, never `packed*`, to avoid confusion |
| `IS_HANDLED_IN_OPENLINKER` / `IS_ON_PACK_BENCH` SQL | **NEW** | No existing raw `fulfillment_works` read in `libs/core/src/orders` (only comments). First ADR-036 read of that table from `orders` |
| Summary counts `waitingInOpenLinker`, `waitingInOpenLinkerOldestAt`, `onPackBench` | **NEW** | `OrderHealthSummary` (`order-record.types.ts` ~107-140) precedent `salesDocumentBlocked` / `destinationRoutingBlocked` |
| `fulfillmentBlockedAt` for "oldest" | **EXISTS → reuse** | `order-record.orm-entity.ts:565`; already selected by `listOrderIdsByFulfillmentBlockReasons` |
| Verification read for "Packing" | **PARTIAL → extend** | `FulfillmentWorkVerificationOrmEntity` (`fulfillment-work-verification.orm-entity.ts`, same context, registered in `fulfillment.module.ts`); no repository port of its own. Extend `findProgressByOrderIds` with an `EXISTS` via the entity, not raw SQL |
| Packer name | **EXISTS → reuse** | `usePackersQuery` on the `users` barrel (`apps/web/src/features/users/index.ts`), already used by `fulfillment-work-packer-section.tsx` |
| `oldestAgeSuffix` for the chip | **EXISTS → reuse** | `order-list-filter-bar.tsx` (sales-documents chip) |
| Mockup assets | **EXISTS → reuse** | `docs/plans/mockups/oms-mvp/ol-kit.css` + `ol-kit.js`. The repo `ol-kit.js` is a **superset** of the downloaded one (adds the `hashchange` re-render), so the downloaded kit and the 740 KB `ol.css` must NOT be committed; link `../../../../apps/web/src/index.css` like m4b |
| Mirror check script for waiting reasons | **NEW** | Pattern: `scripts/check-destination-routing-reason-mirror.mjs` (with the #3002 comment-order fix and the empty-array guard) |

## Backward-compatibility findings

### Critical
None.

### Warning
1. **Health partition is changed in two places that must move together** (FE `deriveOrderHealth`, SQL `countByHealth` / `applyHealthFilter` / `HEALTH_ORDINAL`). No invariant script guards the twin; the predicate-parity spec covers filter-vs-count, not FE-vs-SQL. The implementation should add a shared fixture or an explicit spec on both sides for the four cases (handled + shipped, handled + not shipped, not handled + shipped, synced).
2. **Stale documentation** of the partition: `order-record.types.ts` (~lines 69-92, "awaiting_dispatch — the residual"), `ListOrdersQueryDto` health description, and the `status-summary` `@ApiOperation` description. Update them with the handled-and-shipped clause.
3. **ADR-036 checklist** (`docs/code-review-guide.md`) applies to the two raw `fulfillment_works` subqueries: read-only, parameter-free constants, justified by filter/count, commented in place naming the columns (`orderId`, `status`, `parcelClosedAt`). The architecture doc's cross-context map already has `orders --> fulfillment`, so no new edge.
4. **`OrderHealthSummary` gains required numeric fields.** Every spec/mock that builds a full summary object (api controller specs, web fixtures) will fail type-check until updated - expected, mechanical.
5. **`findProgressByOrderIds` row shape widens** (`hasVerification`, `assignedToUserId`). Only implementer is `FulfillmentWorkRepository`; unmerged (PR #3797), so no external break. The service-spec mocks need the new fields.
6. **`check-ui-vocabulary`** scans new copy (chip labels, "Unassigned", "Assigned").
7. **No migration** - confirmed: no ORM entity field is added.

## Open questions

None blocking. Two to keep in mind:
- The health change moves shipped handled orders from "Awaiting dispatch" to "Synced" on OMS installs; the PR description must say so (user decision 1).
- For a split order with works assigned to different packers, the plan reports `mixed` with no name; the FE must render something sensible (e.g. nothing, or "Several packers") - pick one during implementation.
