# Pre-Implementation Analysis: `/analytics` "needs attention" section

**Plan**: `docs/plans/implementation-plan-analytics-needs-attention.md`
**Issue**: #1989
**Date**: 2026-08-14

## Verdict: READY (with one plan correction noted below — non-blocking, applied during implementation)

---

## Reuse Findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `GET /analytics/needs-attention` backend | ALREADY EXISTS → reuse as-is | `apps/api/src/analytics/http/needs-attention.controller.ts`, `dto/needs-attention-response.dto.ts` — shape matches the plan's §4 contract exactly, including `coverageGapsTotalCount`/`stockAtRiskTotalCount` |
| `features/analytics/*` module scaffolding | ALREADY EXISTS → extend (sibling files) | `apps/web/src/features/analytics/{api,hooks,components,lib}/analytics-trust.*`, `ingestion-trust.lib.ts`, `date-range.lib.ts` from #1986 (PR #2115) |
| `analyticsTrust` API-client namespace | ALREADY EXISTS → extend | `apps/web/src/app/api/api-client.ts:109,264`; `AnalyticsTrustApi` interface in `analytics-trust.api.ts:12-14` — adding `getNeedsAttention` is a 2-line addition, confirms Assumption 1 |
| `useConnectionsQuery` | ALREADY EXISTS → reuse | `apps/web/src/features/connections/index.ts:41` — confirms Assumption 2 (connection-name resolution) is viable without new plumbing |
| `needs-attention.*` FE files (api/types/query-keys/hook/component/lib) | NEW (confirmed absent) | `find apps/web/src -iname "*needs-attention*"` → no matches |
| `.attention-list*` CSS classes | NEW (confirmed absent) | `grep -n "attention-list" apps/web/src/index.css` → no matches |
| `StatusBadge`, `LoadingState`, `ErrorState`, `Button` | ALREADY EXISTS → reuse | `shared/ui` catalog, already used by #1986's components |

No collision with any existing port, service, DI token, or ORM entity — this is a pure frontend consumer of an already-shipped, unmodified backend contract. The classic Phase B reuse-audit categories (ports/capabilities, core services, DI tokens, ORM entities) don't apply to this plan; the equivalent FE-layer audit above covers the same intent (don't reinvent what's already shipped).

---

## Backward-Compatibility Findings

No Critical items — the plan changes no backend contract, no port signature, no DTO shape, no Symbol token, and no ORM schema. All findings below are informational, surfaced because the plan's Decision 2 left one sub-question open.

| Severity | Surface | Finding |
|---|---|---|
| Informational | DTO shape (`FailedSyncValueSummaryDto`) | Confirmed **no currency field exists anywhere in the chain** — not on the DTO (`apps/api/src/analytics/http/dto/needs-attention-response.dto.ts`), not on the domain type (`libs/core/src/orders/domain/types/order-record.types.ts:101-105`, `FailedSyncValueSummary`). This resolves the plan's open sub-question in Decision 2: it is not merely the non-mixed case that lacks a currency — **no case** has one today. **Plan correction**: the non-mixed-currency row must render `"{money(totalValue)} of orders never reached a destination"` using a currency-neutral number formatter (no symbol), not `(unspecified currency)` as a fallback guess — this is the *only* code path, not a fallback branch. This is a copy-only correction inside Phase 2/3 of the existing plan; it does not change scope, file list, or the `mixedCurrency` interim story (Decision 2's core point — that #2049 eventually fixes this — still holds; #2049 also gives a path to add a real currency to this DTO). No backend change is required or in scope. |
| Warning (non-blocking) | `check:invariants` — cross-feature import | `apps/web/src/index.css` and `apps/web/src/app/api/api-client.ts` changes are additive-only edits to files #1986 already extended with the exact same pattern (the `analyticsTrust` block, the `.trust-header`/`.analytics-toolbar__*` CSS sections) — no new invariant risk. Confirmed no ESLint cross-feature-deep-import risk: `useConnectionsQuery` is consumed via the `features/connections` barrel (`index.ts`), not a deep path. |

No migration required (§5 of `docs/migrations.md` doesn't apply — zero ORM/schema changes).

---

## Open Questions

- None blocking. The plan's own Q1/Q2 (separate query vs. combined; date-range scoping) are already resolved with documented assumptions and don't require backend coordination.
- The one open sub-question from Decision 2 (currency field on `FailedSyncValueSummaryDto`) is now closed by this gate's finding above — proceed with the currency-neutral number format, not a placeholder string.

---

## Summary

The plan is a pure frontend consumer of the already-shipped, unmodified `GET /analytics/needs-attention` (#1983) contract, extending the `features/analytics` module #1986 already established with sibling files (`needs-attention.*`) that don't collide with anything on disk today. No backend, port, DI-token, or ORM changes are proposed or needed, so there is no Critical or blocking finding. One informational correction: the DTO carries no currency field at all (not just in the mixed-currency branch), so the plan's Decision 2 non-mixed-currency row should use a currency-neutral number format rather than a placeholder string — a copy-only tweak inside the plan's existing Phase 2/3 scope. **Verdict: READY** — proceed to implementation.
