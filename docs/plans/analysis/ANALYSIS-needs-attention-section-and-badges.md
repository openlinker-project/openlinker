# Readiness gate — "Needs attention" section and cross-surface badges (#2356)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-needs-attention-section-and-badges.md`
**Branch**: `2351-authority-read-model` (body C)

## Verdict: **READY**

No Critical finding. Three Warnings, all addressed inside the plan or explicitly out of scope.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `lib/attention-entry.ts` (+ `toAttentionEntryView`) | **NEW** | no `attention-entry` / `AttentionEntryView` anywhere under `apps/web/src` |
| `components/attention-section.tsx` | **NEW** | no `AttentionSection` identifier in the tree |
| `components/oms-attention-badges.tsx` | **NEW** | no `OmsAttentionBadges` identifier in the tree |
| `hooks/use-oms-attention-query.ts` | **NEW** | no `useOmsAttentionQuery`; wraps the EXISTING `useWhoDecidesStatusQuery` |
| Reason → badge → tone mapping | **ALREADY EXISTS → reuse** | `lib/attention-reason.ts` (`ATTENTION_REASON_MIRROR`, `attentionBadgeTone`, `isAuthorityAttentionReason`) |
| Title production | **ALREADY EXISTS → reuse** | `lib/attention-reason.copy.ts` (`attentionTitle`, `listAttentionReasonCopy`) |
| Section / unknown / badge copy | **ALREADY EXISTS → reuse** | `ATTENTION_SECTION_COPY`, `ATTENTION_UNKNOWN_COPY`, `ATTENTION_BADGE_COPY` |
| Attention payload | **ALREADY EXISTS → reuse** | `AuthorityStatus.attention` (`counted` + `affectedOrderCount`), served by `AuthorityStatusService.buildAttention` |
| `?attention=` backend axis | **ALREADY EXISTS → reuse** | `OrdersController` maps `attention` → `omsAttention`; `OrderHealthSummaryResponseDto.omsAttention` |
| `order_records.omsAttention` column + entity field | **ALREADY EXISTS → reuse** | migration `1853000000000`, `OrderRecordOrmEntity.omsAttention`, `OrderRecord.omsAttention` |
| `OrderRecordResponseDto.omsAttention` | **NEW (additive)** | absent from the DTO and from `OrdersController.toDto` |
| Shared desktop/mobile cell pattern | **ALREADY EXISTS → follow** | `features/orders/components/order-invoicing-cell.tsx` (`layout: 'stack' \| 'row'`, `emptyFallback`) |
| Present-only chip pattern | **ALREADY EXISTS → follow** | `toggleInvoicingBlocked` + the `invoicingBlocked \|\| summary?.salesDocumentBlocked` mount rule |
| Connections list surface | **PARTIAL** | no `ConnectionCard` component — the list is a module-level `COLUMNS` const + `cardView.meta` in `pages/connections/connections-list-page.tsx` |

No port, service, repository, DI token, ORM entity, capability or migration is created. `CoreCapabilityValues` is untouched.

---

## Backward-compatibility findings

**Critical: none.**

| Severity | Surface | Finding | Path |
|---|---|---|---|
| Warning | `OrderRecordResponseDto` | One **added optional** field (`omsAttention`). No field removed, retyped or made required. A client on the old shape is unaffected; a UI on the new shape against an old API renders no badges. | additive only |
| Warning | `apps/web` mirror gates | `check-attention-reason-mirror.mjs` parses `AuthorityAttentionReasonValues` / `ATTENTION_REASON_MIRROR` / `ATTENTION_REASON_COPY` / `ATTENTION_BADGE_COPY` **textually**. The plan adds no member and edits none of those literals, so all six mirrors stay green. Any consumer must keep reading them rather than restating a value. | `scripts/check-attention-reason-mirror.mjs` |
| Warning | `who-decides-styles.test.ts` | The coverage test scans `features/fulfillment-authority/**/*.tsx` + `pages/settings/who-decides-page.tsx` and requires a rule in `index.css` for every class **starting `who-decides`**. New classes must therefore use the `who-decides-attention*` prefix, or the guard silently does not cover them. The plan already specifies this. | `apps/web/src/features/fulfillment-authority/who-decides-styles.test.ts` |

Not tripped: `check-cross-context-imports` (no `libs/core` change), `check-service-interfaces` (no new core service), deep-barrel import rules (all cross-feature imports go through `features/fulfillment-authority/index.ts`), migration timestamp guards (no migration).

---

## Open questions / notes for the implementer

1. **`buildQuery` never serialises `taxRateConflict`** (`features/orders/api/orders.api.ts`) even though `OrderFilters.taxRateConflict` exists and `orders-list-page.tsx` sets it — so `?taxRate=conflict` narrows nothing server-side today. A **pre-existing** defect, out of scope for #2356. The new `attention` param must use the `!== undefined` guard (the `salesDocumentBlocked` shape), not a truthy check, or it repeats the same class of gap.
2. **The connections surface has no card component**, so the badge lands in the `COLUMNS` const plus `cardView.meta` rather than in a shared cell. That is one file, not a refactor.
3. **`StatusBadgeTone` has seven members** and `attentionBadgeTone` already returns a subset of it — no tone widening is needed.
4. **`attention.routine` is structurally always empty** and `AuthorityAttention`'s own docblock forbids a client-side split; the section must iterate `counted` only.
5. **Nothing writes `omsAttention` yet** (#2352 shipped the columns undriven), so every badge surface must be correct against an empty array and the PR body should say the order badge is invisible in practice until a producer lands.
