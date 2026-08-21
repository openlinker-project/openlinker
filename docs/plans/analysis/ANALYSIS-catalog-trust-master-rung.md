# Pre-implement Analysis — Catalog Trust: master rung + reconcile recency (#2258)

**Plan**: `docs/plans/implementation-plan-catalog-trust-master-rung.md`
**Gate run**: 2026-08-21 (deep pass, 3 parallel audits against the live tree)

## Verdict: NEEDS-REVISION

No reuse collision and no unaddressed contract break — but five plan-level corrections are required before implementation. All are cheap to fix in the plan; none change the design's shape.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `libs/core/src/catalog-trust/` context (all names: `CatalogTrust*`, `CATALOG_TRUST_*`) | **NEW** | zero hits repo-wide |
| `MasterCatalogRung(Values)`, `ConnectionCatalogTrust` | **NEW** | "rung" exists only in prose; closest shape precedent `ReportingCurrencySource` (`currency/domain/types/reporting-currency.types.ts:7`) |
| `masterSweepCursorKey` / completedAt key builder in core | **PARTIAL** | key builders exist worker-side only: `apps/worker/src/sync/bounded-sweep.ts:87-95` (`SweepKind`, `sweepCursorKey`). Plan already migrates the worker to the core copy — audit confirms a **re-export from `bounded-sweep.ts` suffices**: no source file imports `SweepKind` by name elsewhere, and all 5 import sites (4 handlers + `bounded-sweep.spec.ts`) import from `'../bounded-sweep'`. Handler/e2e specs hard-code the key strings (`master-product-reconcile.handler.spec.ts:23-24`, `master-product-reconcile-e2e.int-spec.ts:171,181`) — core builder must stay byte-identical (`master.{kind}.sweep:connection:{id}`) |
| `master.product-reconcile.completedAt:connection:{id}` cursor key | **NEW** | `completedAt:connection` — zero occurrences; no reader of the reconcile cursor exists outside the handler |
| `ISyncJobsService.findEnabledTaskByJobType` | **NEW** (needed) | plan premise **confirmed and sharpened**: the delta + reconcile tasks are `CoreCapabilityTaskDescriptor`s converted to `SchedulerTaskConfig` with `connectionFilter` and **no `platformType`** (`apps/api/src/sync/application/services/scheduler.service.ts:507-548`), so `findEnabledPollTask` returns null for all three master tasks |
| `CatalogTrustModule` / `CatalogTrustApiModule` pair | **NEW** | mirrors `AnalyticsTrustModule` / `AnalyticsTrustApiModule` exactly, no clash |
| `GET /connections/:id/catalog-trust` | **NEW route, TAKEN prefix** | exactly one bare `@Controller('connections')` exists (`connection.controller.ts:77`); a second bare one in a new module is a Nest route-resolution ambiguity. The mappings module precedent uses nested prefixes (`connections/:connectionId/mappings/options`) — **use `@Controller('connections/:connectionId/catalog-trust')`** |

## Backward-compat findings

**Critical — none unaddressed.** One widening with a known blast radius:

1. **`ISyncJobsService` gains a required method** — breaks exactly one mock: `libs/core/src/invoicing/application/services/auto-issue-trigger.service.spec.ts:75-80` (bare object literal typed `jest.Mocked<ISyncJobsService>` → TS2739). Every other mock casts through `as unknown as`/`Pick<>`. Fix: add `findEnabledTaskByJobType: jest.fn()` there; implement in `SyncJobsService` (+ spec case). Keep the method **required** (repo convention: required + update mocks).

**Warnings / required edits the plan missed:**

2. **`libs/core/package.json` exports map** — `"./catalog-trust"` entry is a hard requirement; `tsc -b` emits `dist/catalog-trust/` automatically but Node runtime resolution fails at boot without the exports entry (silent in unit tests — jest/tsconfig are wildcard-mapped, zero config edits needed there).
3. **`libs/core/src/sync/index.ts`** — the new key builders are **values**: `export { … }`, not `export type { … }`, or the worker import fails at runtime.
4. **check-cross-context-imports**: verified **deny-first, default-allow** (`classifyName`, script lines 589-597) — camelCase pure functions pass with no ALLOW_LIST entry. Only failure mode: naming a helper `…Adapter/…Dto/…Port/…OrmEntity`. (Note: the plan's `readPricingRule` precedent was wrong in detail — those are only ever imported intra-context — but the conclusion holds via the script's default-allow.)
5. **check-service-interfaces**: passes structurally (no registration list); class must be named `CatalogTrustService`, interface `/^I…Service$/`, sibling interface file.
6. **barrel-purity spec** (`CONTEXT_BARRELS`) doesn't include `analytics-trust` either — adding `'catalog-trust'` is optional; do it (docblock asks) but nothing fails if omitted. Root `libs/core/src/index.ts` deliberately does **not** enumerate `analytics-trust` — omit `catalog-trust` too.
7. **No migration** — `connection_cursors` reused; `completed: true` in `runBoundedSweep` **implies `failed === 0` and `nextCursor === null`** (both branches derive from `page.exhausted`), so the completion write gates on `result.completed` alone. Handler spec assertions are key-filtered (`.mock.calls.find(call => call[1] === CURSOR_KEY)`) — a second `advanceCursor` under a distinct key breaks nothing.

## Plan corrections (frontend + service placement)

8. **FE template correction**: `RateLimitSection` is mounted in `EditConnectionForm.tsx:769`, not the detail page. The right structural template is `ConnectionDiagnosticsPanel` (mounted in the detail page's **health tab**, `connection-detail-page.tsx:347`). Capability-gating precedent already on the page: `connection.enabledCapabilities.includes('ProductMaster')` at `:242`.
9. **No zod in this feature**: `connections.types.ts` uses plain TS interfaces over `apiClient` — follow that, drop the plan's zod/`.nullish()` step.
10. **Scheduler-task registry is API-process-only** (worker has no scheduler; `SchedulerService` in apps/api populates it). The catalog-trust service reading task enablement is only correct in the API process — fine for the endpoint; document it on the service, and note the registry silently reads empty in a worker process.
11. **Versioning**: URI versioning is global (`main.ts:96-99`) — do not hand-prefix routes. `@Roles('admin','operator','viewer')` matches the diagnostics read.

## Open questions

None blocking. The `deltaPassEnabled` scope addition (user-approved) is confirmed feasible via the new `findEnabledTaskByJobType`.

## Required plan revisions before implementation

- Nested controller prefix `connections/:connectionId/catalog-trust` (finding 7 in reuse table)
- Worker refactor via re-export from `bounded-sweep.ts` (zero import-site churn)
- Add: exports-map edit, sync barrel **value** export, auto-issue-trigger mock fix, optional barrel-purity entry
- FE: template = `ConnectionDiagnosticsPanel` in health tab; plain TS types, no zod
- Document API-process-only semantics of the task-registry read
