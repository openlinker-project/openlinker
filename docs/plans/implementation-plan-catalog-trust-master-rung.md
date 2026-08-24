# Implementation Plan — Catalog Trust: master capability rung + deletion-reconcile recency (#2258)

**Issue**: #2258 (Wave 2e of ADR-048, split out of #2222/#2242)
**Layers**: CORE (new `catalog-trust` context + small `sync` additions) · Worker (one cursor write) · Interface (one endpoint) · Frontend (one connection-detail panel)
**Gate**: revised per `docs/plans/analysis/ANALYSIS-catalog-trust-master-rung.md` (pre-implement deep pass, all findings applied)

## 1. Goal

Give the operator three facts per `ProductMaster`-capable connection:

1. **Which capability rung the master is on** — `modified-since` (adapter declares `ModifiedProductLister`) vs `full-enumeration` (base rung: whole-catalog re-enumeration every tick, delta impossible), resolved by **guard-narrowing a dispatched adapter** (`isModifiedProductLister`), never a manifest name (the rung is deliberately absent from manifests and `CoreCapabilityValues`, #2220).
2. **Whether the delta pass is actually running** — the rung is a declaration; the delta scheduler task is opt-in (`OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED`, default off), so `modified-since` declared + pass disabled means the deployment still full-enumerates. Reported as `deltaPassEnabled`.
3. **When deletion reconciliation last completed** — after #2242 this is the real deletion-detection latency. Requires a **new completion-timestamp cursor**: today cycle completion is an *absence* (sweep cursor cleared to `''`) carrying no timestamp; `runBoundedSweep`'s `completed: true` is log-only.

**Non-goals** (from the issue): no cadence changes, no delta-paging changes, no new rung, no folding into `ConnectionDiagnosticsResponseDto` (sync static DTO — can't take an async adapter resolve), no folding into the analytics-trust banner's `worstStatus`.

## 2. Existing seams reused (verified by the gate)

- **Shape to copy**: `libs/core/src/analytics-trust/` — no persistence of its own, composes `IIntegrationsService` + sync services via published tokens; per-connection `try/catch` → distinct `'unknown'` degradation; module exports only its token; concrete service NOT exported from the barrel.
- **Rung guard**: `isModifiedProductLister` (`@openlinker/core/products`); resolve-then-narrow per `master-product-sync-delta.handler.ts:137-156`. Only WooCommerce implements it; PrestaShop is the base-rung case (correct, not degraded — ADR-048 §7/#2221).
- **Cursor read seam**: `ISyncCursorsService` (`SYNC_CURSORS_SERVICE_TOKEN`, exported by `SyncModule`).
- **Cursor storage**: `connection_cursors` already stores ISO timestamps — **no migration**.
- **Task-enablement read**: `SchedulerTaskRegistryService` via `ISyncJobsService` (the #1982 seam). The existing `findEnabledPollTask(platformType, jobType)` **cannot** serve capability-scoped tasks: the delta + reconcile descriptors are `CoreCapabilityTaskDescriptor`s converted to `SchedulerTaskConfig` with `connectionFilter` and no `platformType` (`scheduler.service.ts:507-548`) — hence a new jobType-only finder.
- **Completion site**: `master-product-reconcile.handler.ts` — sweep-cursor `''`-clear then log branch. `runBoundedSweep`'s `completed: true` **implies `failed === 0` and `nextCursor === null`** (both derive from `page.exhausted`), so the timestamp write gates on `result.completed` alone.
- **Key formats** (worker-local today, `bounded-sweep.ts:87-95`): `sweepCursorKey(kind, id)` → `master.{kind}.sweep:connection:{id}`; strings are also hard-coded in handler/e2e specs (`master-product-reconcile.handler.spec.ts:23-24`, `…-e2e.int-spec.ts:171,181`), so the core builder must stay **byte-identical**.

## 3. Design

### 3.1 Shared sweep-key vocabulary moves to core (single source of truth)

New `libs/core/src/sync/domain/types/master-sweep-cursor.types.ts` (pure-rule exception, `engineering-standards.md`):

- `MasterSweepKindValues = ['product', 'inventory', 'product-delta', 'product-reconcile'] as const` + `MasterSweepKind`
- `masterSweepCursorKey(kind, connectionId)` → `master.{kind}.sweep:connection:{connectionId}` (byte-identical to today's worker format)
- `masterSweepCompletedAtCursorKey(kind, connectionId)` → `master.{kind}.completedAt:connection:{connectionId}` (new fact; deliberately a **separate key** — the sweep cursor's `''`-clear fires unconditionally every run and `parseSweepCursor` rejects a 3-part composite)

Export from `libs/core/src/sync/index.ts` as a **value** export (`export { … }`, not `export type` — the builders are functions the worker calls at runtime).

`apps/worker/src/sync/bounded-sweep.ts` deletes its local `SweepKind` + `sweepCursorKey` and **re-exports the core ones under the existing names** (`export { masterSweepCursorKey as sweepCursorKey }`, `export type { MasterSweepKind as SweepKind }`) — the zero-churn claim depends on the aliasing: gate-verified that no source file imports `SweepKind` by name and all 5 import sites (4 handlers + `bounded-sweep.spec.ts`) import from `'../bounded-sweep'`, so the aliased re-export means **zero changes at any import site**. `sweepLockKey`/`formatSweepCursor`/`parseSweepCursor` stay worker-local (core needs key names + presence, not composite parsing). Gate-verified: camelCase pure-function imports pass `check-cross-context-imports` (deny-first, default-allow — no ALLOW_LIST entry).

### 3.2 Worker: write the completion timestamp

In `master-product-reconcile.handler.ts`, after the existing sweep-cursor advance, when `result.completed`:

```ts
await this.cursors.advanceCursor(
  job.connectionId,
  masterSweepCompletedAtCursorKey('product-reconcile', job.connectionId),
  new Date().toISOString(),
);
```

`advanceCursor` is non-monotonic; the per-connection sweep lock makes overlapping completions effectively unreachable, and for a display fact last-writer-wins is acceptable — stated in a comment rather than paying read-compare-write. **The same comment covers the write ordering (tech-review)**: the timestamp is deliberately written *after* the sweep-cursor `''`-clear, so a crash between the two leaves a completed-but-unstamped cycle (acceptable for a display fact); do not "fix" this by moving the write before the clear — stamping a completion whose cursor write then fails is the worse direction. Scoped to the reconcile handler only (the issue's fact); other sweeps can adopt the same key later. Handler-spec assertions are key-filtered (`.mock.calls.find(call => call[1] === CURSOR_KEY)`), so the added write under a distinct key breaks nothing; new assertions cover completed → written / resumed → not written.

### 3.3 Core sync: `ISyncJobsService.findEnabledTaskByJobType`

```ts
findEnabledTaskByJobType(jobType: JobType): SchedulerTaskConfig | null;
```

Same enablement semantics as `findEnabledPollTask` (shared private `isTaskEnabled`), no `platformType` filter. **Contract (tech-review)**: the registry permits multiple tasks per `jobType`; the method returns the **first enabled match** and is intended for capability-scoped (platform-less) tasks — stated in the **interface docblock**, together with the API-process-only caveat (the scheduler-task registry is populated only where `SchedulerService` runs; it silently reads empty in the worker) — the trap belongs on the method every future consumer reads, not only on this consumer. **Required** method (repo convention: required + update mocks). Known blast radius (gate-verified): one bare-literal mock must gain `findEnabledTaskByJobType: jest.fn()` — `libs/core/src/invoicing/application/services/auto-issue-trigger.service.spec.ts:75-80`; all other mocks cast through `as unknown as`/`Pick<>`. Add impl + spec case in `sync-jobs.service.{ts,spec.ts}`.

**Process caveat (documented on the service)**: the scheduler-task registry is populated only in the **API process** (`SchedulerService` in apps/api; the worker has no scheduler). The catalog-trust read is served by the API, so this is correct — but the registry silently reads empty elsewhere, which the service docblock states.

### 3.4 New core context: `libs/core/src/catalog-trust/`

```
catalog-trust/
├── index.ts                        # types + token + module; concrete service NOT exported
├── catalog-trust.tokens.ts         # CATALOG_TRUST_SERVICE_TOKEN = Symbol('ICatalogTrustService')
├── catalog-trust.module.ts         # imports: [IntegrationsModule, SyncModule]; exports only the token
├── domain/types/catalog-replication-trust.types.ts
└── application/services/
    ├── catalog-trust.service.interface.ts
    ├── catalog-trust.service.ts    # class CatalogTrustService implements ICatalogTrustService
    └── catalog-trust.service.spec.ts
```

Types:

```ts
export const MasterCatalogRungValues = ['modified-since', 'full-enumeration', 'unknown'] as const;
export type MasterCatalogRung = (typeof MasterCatalogRungValues)[number];

export interface ConnectionCatalogTrust {
  connectionId: string;
  rung: MasterCatalogRung;                      // capability terms only, never platformType
  deltaPassEnabled: boolean;                    // deployment-wide scheduler-task enablement
  lastReconcileCompletedAt: Date | null;        // null = no cycle has ever completed
  reconcileCycleOpen: boolean;                  // a cycle started and has not completed — see below
}
```

**`reconcileCycleOpen` semantics (tech-review)**: a non-empty sweep cursor means a cycle is **open**, not *running* — the failure branch retains the cursor (retries back off up to 6 h), and the cursor survives the scheduler task being disabled. The field is named for what the read supports; its docblock states "a cycle has started and not yet completed — it advances only when the hourly tick runs and may be stalled by failures". FE copy: "cycle open — resumes on the next hourly tick", never "running".

`ICatalogTrustService.getConnectionCatalogTrust(connectionId): Promise<ConnectionCatalogTrust | null>`:

1. `listCapabilityAdapters<ProductMasterPort>({ capability: 'ProductMaster', lazy: true, includeAllStatuses: true })`, find the entry for `connectionId`. Absent → **`null`** ("not applicable"). `includeAllStatuses` because a `needs_reauth` master is exactly the one under investigation.
2. Rung: access `entry.adapter` (lazy → constructed on first access) inside `try/catch`; success → `isModifiedProductLister(adapter) ? 'modified-since' : 'full-enumeration'`; any throw → `'unknown'` + `warn` log. Never assert a rung the adapter didn't answer for (AC 5).
3. `deltaPassEnabled`: `syncJobs.findEnabledTaskByJobType('master.product.syncDelta') !== null`.
4. `lastReconcileCompletedAt`: `cursors.getCursor(id, masterSweepCompletedAtCursorKey('product-reconcile', id))`, parsed defensively — missing/empty/malformed → `null` (+ warn on malformed).
5. `reconcileCycleOpen`: `getCursor(id, masterSweepCursorKey('product-reconcile', id))` → `value !== null && value !== ''`.

Cross-context surface: `INTEGRATIONS_SERVICE_TOKEN`/`IIntegrationsService`, `SYNC_CURSORS_SERVICE_TOKEN`/`ISyncCursorsService`, `SYNC_JOBS_SERVICE_TOKEN`/`ISyncJobsService`, `ProductMasterPort` + `isModifiedProductLister` (`@openlinker/core/products`), pure key builders (`@openlinker/core/sync`) — all allowed shapes.

**Manual edits the build needs** (gate findings): `libs/core/package.json` exports map gains the `"./catalog-trust"` three-key block (hard requirement — `tsc -b` emits `dist/catalog-trust/` automatically, but Node boot resolution fails without the exports entry; jest/tsconfig are wildcard-mapped, no edits). Add `'catalog-trust'` to `barrel-purity.spec.ts` `CONTEXT_BARRELS` (optional per the gate; the docblock asks for it). Root `libs/core/src/index.ts` deliberately not touched (analytics-trust precedent: omitted).

### 3.5 API: `GET /connections/:connectionId/catalog-trust`

`apps/api/src/catalog-trust/`:

- `catalog-trust.module.ts` — `CatalogTrustApiModule`, imports core `CatalogTrustModule` (aliased `CoreCatalogTrustModule`).
- `http/catalog-trust.controller.ts` — **`@Controller('connections/:connectionId/catalog-trust')`** with `@Get()` — gate finding: a second bare `@Controller('connections')` would be a Nest route-resolution ambiguity; the mappings module's nested-prefix precedent applies. `@Roles('admin','operator','viewer')` (matches the diagnostics read). Service `null` → `NotFoundException`; the 404 deliberately conflates "connection does not exist" with "connection lacks ProductMaster" (stated in the controller docblock — the FE gates on `enabledCapabilities`, so the 404 is unreachable from the shipped UI, and distinguishing would cost a second read for nothing). Explicit field-by-field projection, `Date` → ISO string. No hand-prefixing — global URI versioning applies.
- `dto/catalog-trust-response.dto.ts` — enum fed from `MasterCatalogRungValues`.
- Register `CatalogTrustApiModule` in `app.module.ts` beside `AnalyticsTrustApiModule` (import + array entry with route comment).

Per-connection (not a global snapshot): the sole consumer is the connection detail page; a fleet snapshot can be added later on the same service.

### 3.6 Frontend: `CatalogTrustPanel` on the connection detail page (health tab)

Gate corrections applied: the structural template is **`ConnectionDiagnosticsPanel`** (mounted in the detail page's health tab at `connection-detail-page.tsx:347`), not `RateLimitSection` (which lives in `EditConnectionForm`). The feature uses **plain TS interfaces** over `apiClient` — no zod.

`apps/web/src/features/connections/`:

- `api/connections.types.ts`: `CatalogTrust` interface (`lastReconcileCompletedAt: string | null`).
- `api/connections.api.ts`: `getCatalogTrust(connectionId)` (declared + implemented, matching `getRateLimitStatus`'s shape).
- `api/connections.query-keys.ts`: `catalogTrust: (connectionId) => ['connections', 'catalog-trust', connectionId] as const`.
- `hooks/use-catalog-trust-query.ts` — `enabled` gated by the caller.
- `components/catalog-trust-panel.tsx` (+ test) — mounted in the **health tab** beside `ConnectionDiagnosticsPanel`, rendered only when `connection.enabledCapabilities.includes('ProductMaster')` (existing gating precedent on the page at `:242`). Copy in **capability terms**:
  - `modified-since` → "Declares modified-since enumeration — scheduled syncs can pull only what changed." When `deltaPassEnabled === false`, append the dormancy hint: "The delta pass is currently disabled (`OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED`), so full re-enumeration still applies."
  - `full-enumeration` → "Full re-enumeration only — this master cannot report changes since a point in time; every catalog sync re-reads the whole catalog."
  - `unknown` → "Could not resolve this connection's adapter to determine its catalog sync capability." (distinct muted/warn state — the 404/error path renders nothing new, matching the rate-limit section's "no false claims" posture)
  - Reconcile: "Deletion reconciliation last completed: {relative time}" / "has not completed a full cycle yet", plus a "cycle open — resumes on the next hourly tick" indicator when `reconcileCycleOpen`.
  - **Honest latency note** (AC 3): the hourly cron is the *tick*, not the cycle — a cycle spans `ceil(N / budget)` ticks, so large catalogs take hours-to-days per cycle. Static explanatory copy.
  - Test setup: `createMockApiClient` + `renderWithProviders` from `apps/web/src/test/test-utils` (rate-limit-section.test.tsx pattern, minus the RHF harness).
  - Responsive: plain stacked section consistent with the health tab's existing panels (mobile/tablet in scope by default).

## 4. Step-by-step

| # | Step | Files | Acceptance |
|---|---|---|---|
| 1 | Shared sweep-key vocabulary in core sync | `libs/core/src/sync/domain/types/master-sweep-cursor.types.ts`, `libs/core/src/sync/index.ts` (**value** export) | Keys byte-identical to worker format (unit spec asserts the exact strings the handler specs hard-code) |
| 2 | Worker re-exports core keys | `apps/worker/src/sync/bounded-sweep.ts` | Zero changes at the 5 import sites; existing specs green |
| 3 | Completion-timestamp write | `master-product-reconcile.handler.ts` + spec | `completed` → ISO cursor written under the completedAt key; resumed/failed run → not written |
| 4 | `findEnabledTaskByJobType` | `sync-jobs.service.interface.ts`, `sync-jobs.service.ts` + spec, `auto-issue-trigger.service.spec.ts` mock fix | Returns capability-scoped tasks; respects `enabledEnvVar`/`enabledDefault` |
| 5 | `catalog-trust` core context | files in §3.4 | Service spec: rung modified-since / full-enumeration / resolve-failure→unknown / non-ProductMaster→null; deltaPassEnabled both ways; cursor parse (valid, malformed, empty, missing); cycle-open derivation |
| 6 | exports map + barrel-purity | `libs/core/package.json`, `libs/core/src/__tests__/barrel-purity.spec.ts` | `@openlinker/core/catalog-trust` resolves at Node runtime |
| 7 | API endpoint | `apps/api/src/catalog-trust/*`, `app.module.ts` | Controller spec: 200 projection, 404 on null |
| 8 | FE panel | files in §3.6 | Component test: three rung states, dormant-delta hint, never-completed, cycle-open; page gates on capability |
| 9 | Docs | `docs/architecture-overview.md` (short § beside Analytics Trust), ADR-048 amendment paragraph (decision-2 operator-facing half shipped) | |

## 5. Validation

- **Architecture**: read-only composition over published seams — no repository port, no ORM entity, no platform names in core. Rung never derived from `platformType` or manifests (AC 1/4).
- **Invariant scripts** (gate-verified): `check-cross-context-imports` passes (default-allow for the helpers; no deny-suffix names used); `check-service-interfaces` passes (`CatalogTrustService implements ICatalogTrustService`, sibling interface file); no jest/tsconfig/ESLint edits needed.
- **No migration**: `connection_cursors` reused; `migration:show` must report none pending.
- **Security**: endpoint behind global `JwtAuthGuard` + `@Roles`; response contains no credentials/config.
- **Tests**: unit specs per step (mirrors analytics-trust — no new int-spec; the existing reconcile e2e int-spec keeps pinning the sweep key strings).

## 6. Risks

1. **Key drift** — mitigated: core builder spec asserts the literal strings; handler/e2e specs independently hard-code them, so drift fails two suites.
2. **`ISyncJobsService` widening** — exactly one mock breaks (gate-enumerated); fixed in the same commit.
3. `advanceCursor` non-monotonic — accepted for a display fact (per-connection lock makes overlap unreachable in practice); commented at the write site.
4. **API-process-only registry** — `deltaPassEnabled` is only meaningful when the service runs in the API process; stated in the service docblock (the endpoint is the only consumer).
