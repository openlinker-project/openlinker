# Pre-implementation Analysis: `implementation-plan-analytics-page-shell.md` (#1986)

**Date**: 2026-08-14
**Gate run against**: branch `1986-analytics-page-shell`, based on the current `1985-order-analytics-read-model` (`e1556c23`, itself main + #1985's changes merged in) — per explicit user instruction that this implementation should build off #1985's current state, not plain `main`.
**Verdict**: **READY**

---

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `apps/web/src/features/analytics/**` | **NEW (confirmed absent)** | `apps/web/src/features/analytics` does not exist on this branch |
| `apps/web/src/pages/analytics/analytics-page.tsx` | **NEW (confirmed absent)** | `apps/web/src/pages/analytics` does not exist |
| `apps/web/src/app/routes/analytics.route.tsx` | **NEW (confirmed absent)** | file does not exist |
| `analyticsTrust` namespace on `ApiClient` | **NEW (confirmed absent)** | no `analyticsTrust`/`analytics-trust` hit in `apps/web/src/app/api/api-client.ts` |
| `/analytics` nav item, `Operations` group | **NEW** | nav-registry.ts:34 confirms `Dashboard` is the group's first item; no `/analytics` entry exists yet — plan's insertion point (after Dashboard) is valid |
| Backend `GET /analytics/trust` (consumed, not created) | **EXISTS, unchanged** | `apps/api/src/analytics-trust/http/analytics-trust.controller.ts:26,33` — `@Controller('analytics')` / `@Get('trust')`, identical to what the plan documents |
| `ConnectionIngestionTrust` shape (consumed, not created) | **EXISTS, unchanged by #1985** | `connection-ingestion-trust.types.ts:78` — interface present; the `coverageStartAt` → renamed-field comment (line 115) the plan cites is still there verbatim. **Confirms #1985 did not touch the `analytics-trust` context** — the plan's Decisions 3/3a/4 (which explicitly defer to a future #2083, not to #1985 itself) remain accurate against this branch's actual state. No `earliestOrderDate` field exists yet, as expected. |
| `shared/ui` primitives the plan reuses (`PageLayout`, `SegmentedControl`, `Chip`, `StatusBadge`, `Popover`/`PopoverTrigger`/`PopoverContent`, `Alert`, `Button`, `KeyValueList`, `LoadingState`/`ErrorState`/`EmptyState`) | **EXISTS** | all nine files present under `apps/web/src/shared/ui/` |
| `features/cursors/api/cursors.api.ts` (cited as the structural reference) | **EXISTS, matches plan's description** | verified content — `createCursorsApi(request)` factory shape is exactly what the plan asks Phase 1 Step 2 to mirror |
| `dashboard.route.tsx` (cited as the structural reference for the new route module) | **EXISTS, matches plan's description** | verified content — `index: true` + `handle.crumb` + `lazy()` shape is exactly what Phase 4 Step 3 asks to mirror (note: `analyticsRoute` is NOT `index: true`, it needs `path: 'analytics'` as the plan already specifies) |
| `useApiClient()` DI hook | **EXISTS** | `apps/web/src/app/api/api-client-provider.tsx:14` |
| `createMockApiClient` / `renderWithProviders` test helpers | **EXISTS** | `apps/web/src/test/test-utils.tsx:87,650` |

No artifact the plan proposes to create already exists under a different name. No collision found.

---

## Backward-compatibility findings

| Surface | Check | Result |
|---|---|---|
| `apps/web/src/app/routes/root.route.tsx` `coreChildren` array | Plan inserts `analyticsRoute` between `dashboardRoute` and `ordersRoute` | **Warning (mechanical, not a break)** — confirmed both symbols still adjacent at lines 53–54; insertion is a one-line array edit, no reordering risk |
| `route-lazy.test.ts` `EXPECTED_LAZY_ROUTE_COUNT` | Plan says "bumped by 1" | **Warning (expected, already handled)** — current value is `50` (line 72); must become `51`. Plan already lists this as an acceptance criterion (Phase 4 Step 3) |
| Feature-barrel cross-import ESLint allowlist (`.eslintrc.js` `features/**` pattern group) | Docs' "Feature Public Surface" convention says a new cross-feature-consumed slug must be added to two enumerated pattern groups | **Not applicable — confirmed, not a gap.** `features/analytics` has exactly one consumer, `pages/analytics/analytics-page.tsx` — a page, not another feature or a plugin. Per `docs/frontend-architecture.md`: *"pages/ and app/ remain free to deep-import from features for now."* The enumerated-slug enforcement only fires for feature→feature and plugin→feature imports, neither of which this plan introduces. No `.eslintrc.js` edit needed. |
| `orders-list-page.tsx` line citations (day-boundary widening) | Plan cites `orders-list-page.tsx:268-273` for the UTC-widening pattern | **Warning (cosmetic drift)** — actual lines are `272-273` on this branch (main has moved since the plan was written; off by ~4 lines, same code, same pattern). Not a contract break; just re-cite the line numbers when writing `toUtcRangeInstants` docs/comments rather than trusting the plan's citation verbatim. |
| Top-level barrel (`@openlinker/core/analytics-trust`) | Plan does not modify it | No change proposed — N/A |
| DTO shapes (`AnalyticsTrustResponseDto`) | Plan does not modify it | No change proposed — N/A |
| Symbol tokens | Plan does not add/remove any | N/A — FE has no token convention; BE tokens untouched |
| ORM schema / migrations | Plan explicitly declares none | Confirmed — no `*.orm-entity.ts` touched, no migration needed |
| `check:invariants` (`check-cross-context-imports`, `check-service-interfaces`, deep-barrel-import bans) | All plan changes are FE-only; none of these scripts walk `apps/web/**` | N/A |

No Critical findings.

---

## Open questions (unresolved, non-blocking)

1. **Design PR #2018 merge state** — still `REVIEW_REQUIRED` as of the plan's last revision. Plan's Alternative 3 already accepts this risk and isolates the mockup-derived rules in small, independently-testable pure functions specifically so a late contract change is a localized diff. No action needed before starting.
2. **Nav group placement** ("Operations" vs. a new "Analytics" group) — plan's Assumption 2 picks "Operations" as a safe default; still unconfirmed with the user/design but low-cost to change later (one array entry).

Neither question blocks starting Phase 1 (feature module scaffolding), which touches none of the ambiguous surfaces.

---

## Summary

The plan is implementation-ready against the current branch state. Every artifact it proposes to create is confirmed absent (no reuse collisions), every artifact it proposes to reuse is confirmed present with the exact shape the plan describes, and — most importantly for this branch's specific basis — **#1985's changes (now merged into this branch) do not touch the `analytics-trust` context at all**, so the plan's central risk-mitigation move (deferring the coverage-window and banner-rule refinements to the separately-tracked #2083, rather than building against #1985's schema directly) is confirmed still accurate. Only cosmetic drift was found (a stale line-number citation, an already-anticipated test-count bump); neither requires revising the plan. **Verdict: READY.**
