# Pre-implement analysis: order-cancellation-record-state (#1984)

**Verdict: READY** (one non-blocking correction applied below)

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `OrderRecord.cancelledAt` field + `isCancelled` getter | NEW | `libs/core/src/orders/domain/entities/order-record.entity.ts` has no `cancelledAt`; last trailing field is `totalAmount`. |
| `deriveCancelledAt` pure helper | NEW | No `order-cancellation-projection.ts`, no `deriveCancelledAt` anywhere under `libs/core/src/orders/`. |
| `OrderRecordRepositoryPort.markCancelled` | NEW | Port currently ends at `updateItemResolutionFailure` (line 112); no `markCancelled`. |
| `OrderRecordOrmEntity.cancelledAt` column | NEW | Only pre-existing `cancelledAt` in the repo is `shipments.cancelledAt` (`1799000000000-add-shipments-table.ts`) — a different table, no collision. |
| `OrderRecordFilters.cancelled` | NEW | Current interface has 8 filter fields (`sourceConnectionId` … `slaState`); no `cancelled`. |
| `OrderRecordResponseDto.cancelledAt` | NEW | DTO's newest field is `dispatchByAt`/`sourceDeliveryMethodName`; no `cancelledAt`. |
| `handleSourceCancellation` write-through to `markCancelled` | PARTIAL — extend existing method | Method exists at `order-ingestion.service.ts:485-536`, currently ends at the relay call with no record write. |
| `persistOrder` / `persistIncomingSnapshot` cancellation preservation | PARTIAL — extend existing methods | Both exist in `order-record.service.ts`; neither reads or writes `cancelledAt` today. |

No reinvention risk: every new symbol the plan proposes is confirmed absent.

## Correction required before/during implementation

**Migration timestamp.** The plan's own § 5 "Open Questions" flagged this as unresolved until implementation time — now resolved: this worktree is branched from current `origin/main`, whose migration tail is `1832000000007-add-shipment-waybill-relayed-at.ts`. The order-analytics-read-model PR (#2014/#1985) that would add `1832000000008` **has not merged** — that file does not exist on this branch. The plan drafted `1832000000009` defensively; the correct filename/class suffix on this branch, right now, is **`1832000000008`**. If PR #2014 merges before this branch does, re-timestamp to sort after whatever #2014 lands as (re-run `git ls-tree origin/main -- apps/api/src/migrations/` immediately before finalizing).

**Domain-file precedent note.** The plan cites `order-analytics-projection.ts` (from #1985) as the naming precedent for `order-cancellation-projection.ts`. That file does not exist on `main` either (same reason — #1985 unmerged), so it is not literally available to copy from. Not a blocker: the plan's own inline code for `deriveCancelledAt` is fully self-contained and needs no sibling file to exist. Proceeding as specified.

## Backward-compatibility findings

| Surface | Check | Result |
|---|---|---|
| `@openlinker/core/orders` barrel | Any export removed/renamed? | No — plan only adds new optional trailing fields/methods. |
| `OrderRecordRepositoryPort` | Signature changed on an implemented method? | No — `markCancelled` is additive; no existing method signature changes. |
| `OrderRecordResponseDto` | Field removed/required/retyped? | No — `cancelledAt` is additive and optional. |
| `*.tokens.ts` | Token removed/renamed? | N/A — plan adds no new DI token; `markCancelled` is a plain interface method reached through the existing `ORDER_RECORD_REPOSITORY_TOKEN`. |
| ORM schema | Migration required? | Yes — covered by plan Phase 2 step 7, additive nullable column + index. |
| `check:invariants` | Cross-context imports, service-interface check, deep-barrel imports? | Clean — no new cross-context import, `OrderRecordService` keeps implementing `IOrderRecordService`, no deep imports introduced. |

No Critical items. No Warning items beyond the already-planned migration (expected, not a defect).

## Open questions carried into implementation

- Confirm final migration timestamp per the correction above before running `migration:generate`/committing the file.
- Everything else in the plan's own § 5 (KPI-bucket exclusion scope) remains a genuine open product question, not an implementation blocker — the plan's chosen default (leave health/SLA buckets untouched) is safe to proceed with.
