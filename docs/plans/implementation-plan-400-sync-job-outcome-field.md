# Implementation Plan: Sync Job Outcome Field (Plan B for #391)

**Date**: 2026-04-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: [#400](https://github.com/openlinker-project/openlinker/issues/400) (follow-up to closed #391)

---

## 1. Task Summary

**Objective**: Separate orchestration status from business outcome on `sync_jobs`. Add a nullable `outcome` column populated only on the succeeded path, with values `'ok' | 'business_failure'`. The first concrete user is `marketplace.offer.create`, where Allegro/builder-rejection cases currently land as `succeeded` despite a `failed` `OfferCreationRecord` — the operator sees a misleading green badge on the Jobs list.

**Context**: Follow-up to closed #391. Plan A (PR #396) shipped the detail-page `OfferCreationTracker`. Plan B closes the list-level visibility gap and gives the orchestration-vs-business distinction a first-class home in the data model. This is generalisable: 11 other handlers follow the same "thin delegation" pattern and could grow the same silent-business-failure shape — adopting the contract once prevents repeat work.

**Classification**: CORE (sync domain types, listings orchestrator) + Infrastructure (migration, ORM, runner) + Interface (API DTO, FE badge + filter) + Testing.

---

## 2. Scope & Non-Goals

### In Scope
- `sync_jobs.outcome` nullable column + reversible migration.
- `JobOutcome` union type + `JobOutcomeValues` runtime array (per `as const` pattern).
- `SyncJobHandler` port contract change — `execute()` returns `Promise<{ outcome: JobOutcome }>`, required (no opt-in).
- `SyncJobRepositoryPort.markSucceeded(id, outcome)` — port + repo + every test mock + every caller.
- All 12 handlers updated to return `{ outcome }`. Offer-create returns derived outcome; 11 others mechanical `'ok'`.
- `OfferCreationExecutionService.executeCreation` returns `{ offerCreationRecord, outcome }`. Maps via private `recordToOutcome(status)`. Throws `OfferCreationInvariantException` on `pending`.
- `OfferCreationInvariantException` domain exception.
- `SyncJobRunner` reads outcome from handler return; passes to `markSucceeded`; classifies the new exception as non-retryable (markDead).
- API: `SyncJobResponseDto.outcome` + Swagger annotation; `GET /sync/jobs?outcome=...` filter.
- FE: `SyncJobStatusBadge` accepts `(status, outcome)`, warning tone for `succeeded + business_failure`. List-page outcome filter via URL search params.
- Audit-lite of the 11 non-offer-create handlers, findings in PR description, follow-up issues filed for any silent-business-failure branch.
- Unit tests + 1 integration test covering the vertical slice.

### Out of Scope
- Per-handler fixes for any silent-business-failure branches the audit surfaces — file follow-up issues, do not bundle.
- Backfill of historical `sync_jobs.outcome` from `OfferCreationRecord` history.
- Async-validation poll handler (`marketplace.offer.pollCreationStatus`) — separate planned follow-up; will write its own outcome.
- Any change to the retry endpoint's "only-dead-jobs" semantics.
- Index on `outcome` (defer until list-page latency degrades or table > ~1M rows).
- DB-level CHECK constraint on `outcome` (consistent with how `sync_jobs.status` is shaped today).

### Constraints
- Backwards-compatible at the DB level (nullable column, no defaults) but **breaking at the type level**: `SyncJobHandler.execute` return type changes, all 12 handlers must update in the same PR or TypeScript fails compile.
- Honour `migrations.md` timestamp uniqueness invariant (enforced by `pnpm lint` via `scripts/check-migration-timestamps.mjs`).

---

## 3. Architecture Mapping

**Target Layer**: CORE (domain types, listings orchestrator, sync ports), Infrastructure (migration, ORM, repo, runner, handlers), Interface (API DTO, controller, FE).

**Capabilities Involved**:
- `SyncJobHandler` port (`libs/core/src/sync/domain/ports/sync-job-handler.port.ts:24`) — **contract change**.
- `SyncJobRepositoryPort` (`libs/core/src/sync/domain/ports/sync-job-repository.port.ts:59`) — **signature change** on `markSucceeded`.
- `IOfferCreationExecutionService` — **return-type change** on `executeCreation`.

**Existing Services Reused**:
- `OfferCreationExecutionService` — already centralises the orchestration policy; just returns more.
- `SyncJobRunner` — already routes to handlers; reads outcome from return value.
- `SyncJobStatusBadge` (FE) — extends tone map to a `(status, outcome)` mapping.
- `OfferCreationTracker` (FE, from Plan A) — unchanged; remains the live-state source on the detail page.

**New Components Required**:
- `JobOutcomeValues` + `JobOutcome` type in `libs/core/src/sync/domain/types/sync-job.types.ts`.
- `OfferCreationInvariantException` in `libs/core/src/listings/domain/exceptions/offer-creation-invariant.exception.ts`.
- `recordToOutcome(status)` private helper inside `OfferCreationExecutionService`.
- Migration file `apps/api/src/migrations/{timestamp}-add-outcome-to-sync-jobs.ts`.

**Core vs Integration Justification**:
- The outcome contract (`JobOutcome`, `recordToOutcome`, port signature) lives in CORE (`libs/core/src/sync/`, `libs/core/src/listings/`) because the orchestration vs business-outcome distinction is platform-agnostic. No integration package touches these files — adapters publish offers, the orchestrator interprets the resulting record status. Confirmed: no changes under `libs/integrations/`.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System
N/A — no external API change. Allegro/PrestaShop adapters are unaffected.

### Internal Patterns

**Similar implementations in the codebase**:
- `JobStatusValues = ['queued','running','succeeded','dead'] as const` in `sync-job.types.ts` is the exact template for `JobOutcomeValues`.
- `SyncJobRepositoryPort.markSucceeded(id)` / `markFailed(id, error, nextRunAt)` / `markDead(id, error)` already mix domain identifiers with diagnostic strings; adding `outcome` to `markSucceeded` follows the same shape.
- `OfferCreationExecutionService` already has the three terminal-business-failure branches (lines 87–94 builder, 107–119 platform reject, 136–150 happy path with sub-case warn-log on `validating`).
- `OfferBuilderValidationException`, `OfferCreateRejectedException`, `MasterCatalogConnectionNotConfiguredException`, `OfferCreationRecordNotFoundException` all live in `libs/core/src/listings/domain/exceptions/` — `OfferCreationInvariantException` slots in beside them.
- `SyncJobHandler.execute(job): Promise<void>` is a tiny port — only one method to change. Implementations are in `apps/worker/src/sync/handlers/`.

**Reusable components**:
- `OfferCreationTracker` FE primitive (Plan A) stays as-is for live record state.
- `SyncJobStatusBadge` already centralises status-tone mapping.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The retry endpoint's "only-dead" behaviour was confirmed via `apps/api/src/sync/http/sync.controller.ts:227`, which makes `outcome` truly frozen-per-row.

### Assumptions
- The 11 non-offer-create handlers don't have hidden silent-business-failure branches that need fixing in *this* PR. Verified at audit time; any surfaced branches are filed as separate follow-up issues per the audit-lite (γ) scope.
- The `OfferCreationRecord.status` enum (`pending | draft | validating | active | failed`) is stable and exhaustive. Adding new values would require a switch-statement update in `recordToOutcome`.
- `sync_jobs` is small enough today that `outcome` doesn't need an index. Risk #5 in the issue calls out the threshold (~1M rows or visible filter latency).

### Documentation Gaps
None. `engineering-standards.md`, `architecture-overview.md`, `testing-guide.md`, and `migrations.md` cover every pattern this PR uses.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain types & exception (CORE)

**Goal**: Define the outcome vocabulary and the invariant exception. Pure types, no runtime behaviour change yet.

1. **Add `JobOutcome` to sync-job types**
   - **File**: `libs/core/src/sync/domain/types/sync-job.types.ts`
   - **Action**: Add `export const JobOutcomeValues = ['ok', 'business_failure'] as const;` and `export type JobOutcome = (typeof JobOutcomeValues)[number];` next to the existing `JobStatusValues`.
   - **Acceptance**: `import { JobOutcome, JobOutcomeValues } from '@openlinker/core/sync'` resolves; `JobOutcomeValues.includes('ok')` is `true`.
   - **Reference**: [Engineering Standards — Union Types: `as const` Pattern](../engineering-standards.md#union-types-as-const-pattern-default)

2. **Export `JobOutcome` from the package barrel**
   - **File**: `libs/core/src/sync/index.ts`
   - **Action**: Re-export `JobOutcome` and `JobOutcomeValues` alongside `JobStatus` / `JobStatusValues`.
   - **Acceptance**: Worker / API / FE consumers can import via `@openlinker/core/sync`.

3. **Create `OfferCreationInvariantException`**
   - **File**: `libs/core/src/listings/domain/exceptions/offer-creation-invariant.exception.ts`
   - **Action**: New domain exception; extends `Error`; constructor accepts `recordId: string` + `actualStatus: string` and renders a clear message (e.g. `"OfferCreationRecord ${recordId} returned in invariant-violating status: ${actualStatus}. Expected one of: failed | active | draft | validating."`). Include `Error.captureStackTrace`. Mirror the shape of `OfferCreationRecordNotFoundException` already in the same folder.
   - **Acceptance**: Exception class importable; `new OfferCreationInvariantException('rec_123', 'pending')` produces a useful `.message` and stack trace.
   - **Reference**: [Engineering Standards — Error Handling](../engineering-standards.md#error-handling)

### Phase 2 — Orchestrator return shape (CORE)

**Goal**: `OfferCreationExecutionService` returns `{ offerCreationRecord, outcome }`, with the mapping logic centralised.

4. **Update `ExecuteOfferCreationResult` type**
   - **File**: `libs/core/src/listings/application/types/offer-creation-execution.types.ts`
   - **Action**: Add `outcome: JobOutcome;` (required) to the result interface. Import `JobOutcome` from `@openlinker/core/sync`.
   - **Acceptance**: TS compiles — both call sites of `executeCreation` (handler + future REST endpoint) will surface as type errors until updated.

5. **Add `recordToOutcome` helper to the orchestrator**
   - **File**: `libs/core/src/listings/application/services/offer-creation-execution.service.ts`
   - **Action**: Add a `private recordToOutcome(status: OfferCreationStatus): JobOutcome` method. Implementation:
     - `'failed'` → `'business_failure'`
     - `'active' | 'draft' | 'validating'` → `'ok'`
     - `'pending'` → `throw new OfferCreationInvariantException(record.id, 'pending')`
     - Use a `switch` with no default so TS exhaustiveness checking flags new enum values.
   - **Acceptance**: Pure function, fully covered by unit tests in step 6.

6. **Thread `outcome` through every return path of `executeCreation`**
   - **File**: same as above.
   - **Action**: Three return points today (lines 91, 116, 150) all become `return { offerCreationRecord: <record>, outcome: this.recordToOutcome(<record>.status) };`. The throw-on-`pending` happens inside `recordToOutcome`, so the orchestrator surfaces the invariant via the normal exception channel. On the `business_failure` branch (`recordToOutcome` returns `business_failure`), add a `Logger.warn` call before returning, carrying `{ recordId, connectionId, errorCount: <record>.errors?.length ?? 0 }` — symmetric with the existing `validating`-warning at lines 144–148.
   - **Acceptance**: TS compiles; unit tests in step 12 confirm each branch returns the right outcome and logs on `business_failure`.

### Phase 3 — Sync port + repository signature change (CORE + Infrastructure)

**Goal**: `markSucceeded` writes outcome atomically with status. Port + repo + every test mock + every caller.

7. **Update `SyncJobRepositoryPort.markSucceeded` signature**
   - **File**: `libs/core/src/sync/domain/ports/sync-job-repository.port.ts:59`
   - **Action**: Change to `markSucceeded(id: string, outcome: JobOutcome): Promise<void>;`. Import `JobOutcome` from the local types file (relative import — same domain module).
   - **Acceptance**: All callers and implementers surface as TS errors.

8. **Update the TypeORM repository**
   - **File**: `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts`
   - **Action**: `markSucceeded(id, outcome)` issues a single `UPDATE sync_jobs SET status='succeeded', outcome=$outcome, locked_at=NULL, locked_by=NULL, updated_at=NOW() WHERE id=$id` (consistent with how `markFailed` / `markDead` already touch lock fields).
   - **Acceptance**: Repository unit test (if exists) updated; integration test in step 18 covers persistence.

9. **Add `outcome` to the SyncJob domain entity**
   - **File**: `libs/core/src/sync/domain/entities/sync-job.entity.ts`
   - **Action**: Add nullable `outcome: JobOutcome | null` field (mirrors `lastError`).
   - **Acceptance**: Domain entity carries the outcome through reads.

10. **Add `outcome` to the SyncJob ORM entity**
    - **File**: `libs/core/src/sync/infrastructure/persistence/entities/sync-job.orm-entity.ts`
    - **Action**: Add `@Column({ name: 'outcome', type: 'varchar', nullable: true }) outcome: string | null;`. Update the repository's `toDomain` / `toOrm` private mappers to thread the field.
    - **Acceptance**: TS compiles; ORM column is nullable varchar.

11. **Generate the migration**
    - **File**: `apps/api/src/migrations/{timestamp}-add-outcome-to-sync-jobs.ts`
    - **Command**: `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddOutcomeToSyncJobs`
    - **Action**: Verify the generated `up()` is just `ALTER TABLE "sync_jobs" ADD "outcome" character varying`. `down()` should drop the column. Honour the timestamp uniqueness invariant (filename prefix + class suffix match; check via `pnpm lint`).
    - **Acceptance**: `pnpm --filter @openlinker/api migration:run` succeeds locally; `pnpm --filter @openlinker/api migration:revert` cleanly drops the column; `pnpm lint` passes the timestamp invariant check.
    - **Reference**: [docs/migrations.md — Timestamp uniqueness invariant](../migrations.md#timestamp-uniqueness-invariant)

### Phase 4 — Handler port contract change (CORE + Worker)

**Goal**: Every handler returns `{ outcome }`. TypeScript enforces it for all 12.

12. **Update `SyncJobHandler` port**
    - **File**: `libs/core/src/sync/domain/ports/sync-job-handler.port.ts:24`
    - **Action**: Add a sibling type `export interface HandlerResult { outcome: JobOutcome; }` and change `execute(job: SyncJob): Promise<void>` to `execute(job: SyncJob): Promise<HandlerResult>`. Update the JSDoc to mention that handlers must return their business outcome and that exceptions remain reserved for transient/fatal failures. Export `HandlerResult` from the package barrel.
    - **Acceptance**: All 12 handler implementations surface as type errors.

13. **Propagate outcome from `marketplace-offer-create.handler.ts`**
    - **File**: `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts`
    - **Action**: Capture the orchestrator return: `const result = await this.offerCreation.executeCreation(input);` → `return { outcome: result.outcome };`. Keep the existing `try/catch` for `SyncJobExecutionError` wrapping; it doesn't need to change.
    - **Acceptance**: Handler returns `'business_failure'` when the record landed `failed`, `'ok'` otherwise. Covered by unit tests in step 17.

14. **Mechanical `{ outcome: 'ok' }` for the other 11 handlers**
    - **Files**: every other `*.handler.ts` under `apps/worker/src/sync/handlers/`:
      - `auto-match-variants.handler.ts`
      - `inventory-propagate-to-marketplaces.handler.ts`
      - `marketplace-offer-field-update.handler.ts`
      - `marketplace-offer-quantity-update.handler.ts`
      - `marketplace-offers-sync.handler.ts`
      - `marketplace-order-sync.handler.ts`
      - `master-inventory-sync-all.handler.ts`
      - `master-inventory-sync.handler.ts`
      - `master-product-sync-all.handler.ts`
      - `master-product-sync.handler.ts`
      - `orders-poll.handler.ts`
    - **Action**: Update each handler's `execute` return type and end every successful return path with `return { outcome: 'ok' };`. Where the existing body is `await ...; return;`, change to `await ...; return { outcome: 'ok' };`.
    - **Acceptance**: All 12 handlers compile against the new port; existing handler unit tests still pass after the trivial return-shape update.

15. **Audit-lite walkthrough**
    - **Action**: For each of the 11, read the orchestrator/application service the handler delegates to. Check for the pattern `try { ... } catch (DomainException) { recordFailed(...); return; }` (i.e. swallowed domain rejection persisted as a failure record). Note findings in the PR description. For any handler that *does* have a hidden silent-business-failure branch:
       - Do NOT fix it in this PR.
       - File a follow-up issue under `tech-debt`, link it from the PR description, and call out the specific orchestrator file + line range.
    - **Acceptance**: PR description contains an "Audit-lite findings" section with one bullet per handler ("clean — no business-failure branch found" or "see #NNN — followup filed").

### Phase 5 — Runner reads outcome + classifies invariant (Worker)

**Goal**: Runner persists outcome from handler return; treats invariant violation as non-retryable.

16. **Wire outcome through the runner**
    - **File**: `apps/worker/src/sync/sync-job.runner.ts`
    - **Action**: Around line 269 (the `markSucceeded` call site), capture `const result = await handler.execute(job);` and call `await this.jobRepository.markSucceeded(job.id, result.outcome);`. In the catch block (around lines 298–304 where `markDead` is decided for non-retryable errors), add `OfferCreationInvariantException` to the non-retryable classification — same shape as the existing `AuthenticationException` clause.
    - **Acceptance**: Unit tests in step 17 confirm: succeeded path writes outcome; invariant exception path goes to `markDead` immediately (not retry).

### Phase 6 — Tests (CORE + Worker)

**Goal**: Cover the new behaviour with unit tests; one integration test for the vertical slice.

17. **Unit tests**
    - **`OfferCreationExecutionService` spec** (`libs/core/src/listings/application/services/__tests__/offer-creation-execution.service.spec.ts`):
      - Returns `outcome: 'business_failure'` when builder validation fails.
      - Returns `outcome: 'business_failure'` when adapter throws `OfferCreateRejectedException`.
      - Returns `outcome: 'ok'` when adapter returns `'active'`, `'draft'`, or `'validating'` (3 cases).
      - Throws `OfferCreationInvariantException` when the record is in `'pending'` after the orchestrator's work.
      - Logs structured `Logger.warn` on the `business_failure` branch.
    - **`SyncJobRunner` spec**:
      - Calls `markSucceeded(id, 'ok')` when handler returns `{ outcome: 'ok' }`.
      - Calls `markSucceeded(id, 'business_failure')` when handler returns `{ outcome: 'business_failure' }`.
      - Calls `markDead` (not `markFailed`) when handler throws `OfferCreationInvariantException`.
      - Leaves outcome NULL on the dead/failed paths (existing tests, just verifying nothing regresses).
    - **Each handler smoke test**: existing handler `*.spec.ts` files keep passing after the return-shape change. For 11, the existing tests just need the assertion that `execute` resolves with `{ outcome: 'ok' }`. For `marketplace-offer-create`, add coverage for the `'business_failure'` propagation.
    - **`SyncJobStatusBadge` spec** (FE): renders correct tone for `(queued, null)`, `(running, null)`, `(succeeded, 'ok')`, `(succeeded, 'business_failure')`, `(dead, null)`.
    - **Reference**: [Testing Guide — Unit Tests](../testing-guide.md#unit-tests)

18. **Integration test — vertical slice**
    - **File**: `apps/api/test/integration/sync-job-outcome.int-spec.ts`
    - **Action**: Using the existing test harness (Testcontainers Postgres + Redis, real Nest app):
      - Seed a `sync_jobs` row with `status='queued'` and a `marketplace.offer.create` payload pointing at a pre-seeded `offer_creation_records` row in `failed` status.
      - Trigger the runner (or directly call `markSucceeded(jobId, 'business_failure')` to validate the persistence path independently of the runner).
      - Assert the row's `outcome` is `'business_failure'`.
      - Assert `GET /sync/jobs/:id` response includes `outcome: 'business_failure'`.
      - Assert `GET /sync/jobs?outcome=business_failure` returns the row.
    - **Acceptance**: Test passes against a fresh container.
    - **Reference**: [Testing Guide — Integration Tests](../testing-guide.md#integration-tests)

### Phase 7 — API surface (Interface)

**Goal**: Expose `outcome` in the response DTO and as a list filter.

19. **`SyncJobResponseDto.outcome`**
    - **File**: `apps/api/src/sync/http/dto/sync-job-response.dto.ts`
    - **Action**: Add `outcome: JobOutcome | null` with `@ApiProperty({ enum: JobOutcomeValues, nullable: true, description: 'Business outcome of the job (only set on succeeded path).' })`. Make sure the response mapping (likely in the controller or service) threads `outcome` through from the domain entity.
    - **Acceptance**: Swagger UI shows the field with the enum dropdown.

20. **List filter on `GET /sync/jobs`**
    - **File**: `apps/api/src/sync/http/sync.controller.ts` + the corresponding query DTO (probably `apps/api/src/sync/http/dto/list-sync-jobs.query.ts` or similar).
    - **Action**: Add an optional `outcome?: JobOutcome` query param with `@IsOptional()`, `@IsIn(JobOutcomeValues)`. Thread into the application service / repository query method (likely `SyncJobService.listJobs(filters)`). Repository adds a `WHERE outcome = $1` clause when set.
    - **Acceptance**: `GET /sync/jobs?outcome=business_failure` returns only matching rows.

### Phase 8 — Frontend (Interface)

**Goal**: List-page badge tells the truth; outcome filter dropdown works via URL state.

21. **FE type mirror**
    - **File**: `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts`
    - **Action**: Add `outcome: JobOutcome | null` to the `SyncJob` interface, plus matching const+type for `JobOutcome`. Mirror `JobOutcomeValues` from BE for the filter dropdown.
    - **Acceptance**: TS compiles; consumers can read `job.outcome`.

22. **Status badge tone map**
    - **File**: `apps/web/src/features/sync-jobs/components/SyncJobStatusBadge.tsx`
    - **Action**: Change props to `{ status: JobStatus; outcome: JobOutcome | null }`. In the tone derivation: when `status === 'succeeded' && outcome === 'business_failure'`, return `warning`; otherwise keep the existing mapping. The badge label can remain the literal status word (`succeeded`) — the tone change carries the new signal — or, if visual-QA prefers, render a small `(business failure)` subtitle. Recommend keeping label minimal; the operator clicks in for detail.
    - **Acceptance**: Snapshot/rendering test covers all four (status, outcome) combinations from step 17.
    - **Reference**: [Frontend UI Style Guide — Status Badge](../frontend-ui-style-guide.md#status-badge)

23. **List-page outcome filter**
    - **Files**:
      - `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx` — render a new dropdown beside the status filter; read/write the `outcome` URL search param via `useSearchParams`.
      - `apps/web/src/features/sync-jobs/hooks/use-sync-jobs-query.ts` — accept the filter and pass it to the API client.
      - `apps/web/src/features/sync-jobs/api/sync-jobs.api.ts` (or equivalent) — append the query param when set.
    - **Acceptance**: Selecting "business failure" in the dropdown updates the URL to `?outcome=business_failure` and the table re-fetches with the filter applied. Refreshing the page preserves the filter.
    - **Reference**: [Frontend Architecture — URL State](../frontend-architecture.md#url-state)

### Phase 9 — Quality gate & PR

**Goal**: Ship green.

24. **Run quality gate**
    - **Commands**:
      ```bash
      pnpm lint
      pnpm type-check
      pnpm test
      pnpm test:integration
      pnpm --filter @openlinker/api migration:show
      ```
    - **Acceptance**: All commands exit 0. `migration:show` lists `AddOutcomeToSyncJobs{timestamp}` as run.

25. **Audit-lite write-up + PR**
    - **Action**: Write the PR body with: summary; scope; the audit-lite findings (one bullet per handler); links to follow-up issues filed (if any); `Closes #400`. Include screenshot of the FE list page showing the new badge tone for at least one `succeeded + business_failure` row.

---

### Implementation Details (rolled up)

**New Components**:
- **Domain**: `JobOutcomeValues` + `JobOutcome` (sync types); `OfferCreationInvariantException` (listings exception).
- **Application**: `recordToOutcome` private helper in `OfferCreationExecutionService`; `outcome` field on `ExecuteOfferCreationResult`.
- **Infrastructure**: nullable `outcome` column on `sync_jobs`; `markSucceeded(id, outcome)` repository method; SyncJob domain + ORM entity additions.
- **Interface**: `outcome` field on `SyncJobResponseDto`; `outcome` query param on list endpoint; `SyncJobStatusBadge` (status, outcome) prop pair; outcome filter dropdown on list page.

**Configuration Changes**: None.

**Database Migrations**: Single migration `AddOutcomeToSyncJobs{timestamp}` adding nullable `outcome varchar` column. Reversible.

**Events**: None emitted/consumed. The runner's existing `markSucceeded` write is the only persistence change.

**Error Handling**:
- New domain exception: `OfferCreationInvariantException` for the `pending` invariant.
- Runner adds it to the non-retryable classification (markDead, no retry).

**Reference**: [Engineering Standards — Project Structure](../engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: FE-only derivation (Option 0 from grilling)
- **Description**: Don't change the backend. The list page joins/looks up `OfferCreationRecord` for each `marketplace.offer.create` job and renders a warning badge when the record is `failed`.
- **Why Rejected**: Doesn't generalise (other handlers don't have a single linked record); pushes business semantics into the FE; "show me all jobs with business problems" requires a JOIN on every list query instead of `WHERE outcome=...`. Rejected after Q1 of the grilling.

### Alternative 2: Throw a `TerminalBusinessFailureError` from the orchestrator
- **Description**: Use the exception channel to signal business failure; runner catches a specific class and marks succeeded with `outcome=business_failure`.
- **Why Rejected**: Conflates control flow (exceptions) with data (outcome). A business failure is a *fact*, not a control disruption — generates stack traces for routine outcomes, fights the type system on attached data. Rejected after Q4 of the grilling.

### Alternative 3: Optional `outcome?` on handler return
- **Description**: Keep handlers as `Promise<void | { outcome: JobOutcome }>`, default to `'ok'` when absent. Lets the 11 non-offer-create handlers stay unchanged.
- **Why Rejected**: Silent footgun — an orchestrator could persist a failed record and forget to set outcome, and TypeScript wouldn't catch it. With required, the type system enforces "every handler explicitly states its business outcome." Rejected after Q4 of the grilling.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain layer (`libs/core/src/sync/domain/`, `libs/core/src/listings/domain/`) imports nothing from NestJS / TypeORM.
- ✅ Outcome mapping lives in the application service (orchestrator), not in the runner or the handler — close to the status-meaning source.
- ✅ Runner depends on the port (`SyncJobRepositoryPort`, `SyncJobHandler`), not concrete classes.
- ✅ Repository converts persistence concerns; domain exceptions stay in `domain/exceptions/`.
- **Reference**: [Architecture Overview — Layer Dependencies](../architecture-overview.md#layer-dependencies)

### Naming Conventions
- ✅ `*.types.ts` for `JobOutcome`; `*.exception.ts` for the new exception; `*.handler.ts` unchanged.
- ✅ `as const` array + derived union (no enum).
- ✅ FE component is `SyncJobStatusBadge.tsx` (PascalCase export, kebab filename per FE conventions).
- **Reference**: [Engineering Standards — Naming Conventions](../engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Follows `JobStatusValues` → `JobStatus` template for the new union.
- ✅ Mirrors existing repository write methods' shape (`markFailed(id, error, nextRunAt)`).
- ✅ FE filter via URL search params, matching how the existing `status` filter works.

### Risks
- **Port-contract change cascade**: `SyncJobRepositoryPort.markSucceeded` and `SyncJobHandler.execute` both change shape. Surfaces in: ports, TypeORM repo, in-memory test doubles, every handler implementation, every handler unit test, the runner. **Mitigation**: TypeScript catches every site at compile time; reviewer greps for `markSucceeded(` and `execute(` to confirm full coverage.
- **Invariant retry trap**: If `OfferCreationInvariantException` falls through into the runner's transient bucket, the job retries 10× before dying. **Mitigation**: explicit non-retryable classification in step 16 + a runner unit test in step 17 that asserts `markDead` is called immediately.
- **Audit-lite false negative**: Reading 11 orchestrators may miss a subtle silent-business-failure branch. **Mitigation**: filing one follow-up issue is cheap; the bug exists today — we're not making anything worse if we miss one. The `outcome='ok'` default is correct for the majority case.
- **Migration timestamp collision** in branch-merge windows. **Mitigation**: `pnpm lint` enforces uniqueness via `scripts/check-migration-timestamps.mjs`; bump the new migration's prefix if the lint fails.

### Edge Cases
- **`OfferCreationRecord.status = 'pending'` on return** → throws `OfferCreationInvariantException` → runner classifies non-retryable → `markDead`. No silent corruption.
- **Retry of a dead `marketplace.offer.create` job** → existing endpoint resets to `queued` (outcome remains NULL); on next run, fresh outcome gets written. Frozen-per-row holds because succeeded rows can't be retried via this endpoint.
- **Validating → failed transition via the future poll handler** → original create-job's `outcome` stays `'ok'` (frozen, snapshot at job-time). The future poll-job carries its own outcome reflecting the eventual transition. Documented in Risk #4 of the issue body.
- **Handler that throws after partial work** → throw bypasses return; runner runs the existing failed/dead classification; outcome stays NULL. Correct.

### Backward Compatibility
- ✅ Database: column is nullable, no defaults, no backfill — historical rows keep working with NULL outcome.
- ❌ **Type-level breaking** for consumers of `SyncJobHandler.execute` and `SyncJobRepositoryPort.markSucceeded`. Both are internal to the monorepo; no external consumer. Every internal site is updated in the same PR.
- ✅ API: `outcome` is a new optional response field; new optional query param. Existing FE/clients ignore them.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/listings/application/services/__tests__/offer-creation-execution.service.spec.ts` — outcome derivation per status; throws on `pending`; logs on `business_failure`.
- `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts` (or equivalent) — outcome wiring, invariant-classification path.
- Each handler's existing `*.spec.ts` updated for the new return shape.
- `apps/web/src/features/sync-jobs/components/SyncJobStatusBadge.test.tsx` — all four (status, outcome) combinations.

### Integration Tests
- `apps/api/test/integration/sync-job-outcome.int-spec.ts` — full vertical slice: persistence, response DTO, list filter.
- **Reference**: [Testing Guide — Integration Tests](../testing-guide.md#integration-tests)

### Mocking Strategy
- Unit tests mock `SyncJobRepositoryPort`, `IOfferCreationExecutionService`, `OfferCreationRecordRepositoryPort` — never concrete classes.
- Integration test uses real Postgres + Redis via Testcontainers; mocks only the Allegro HTTP client.

### Acceptance Criteria
Mirrors the issue body; condensed:
- [ ] Migration adds nullable `outcome varchar`; up/down verified; `pnpm lint` timestamp check passes.
- [ ] `JobOutcomeValues` + `JobOutcome` defined per `as const` pattern.
- [ ] `SyncJobRepositoryPort.markSucceeded(id, outcome)` updated everywhere; grep-clean.
- [ ] All 12 handlers return `{ outcome }`; offer-create derives, others mechanical `'ok'`.
- [ ] `OfferCreationInvariantException` + runner non-retryable classification.
- [ ] Orchestrator `Logger.warn` on `business_failure`.
- [ ] `SyncJobResponseDto.outcome` + `@ApiProperty` annotation.
- [ ] `GET /sync/jobs?outcome=business_failure` filter works.
- [ ] FE badge warning tone for `(succeeded, business_failure)`; tests cover all 4.
- [ ] FE outcome filter dropdown via URL search params.
- [ ] Integration test (`*.int-spec.ts`) covering the vertical slice.
- [ ] Audit-lite write-up in PR description; per-handler follow-ups filed where applicable.
- [ ] `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` all green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (CORE → Application → Infrastructure → Interface)
- [x] Respects CORE vs Integration boundaries (no `libs/integrations/` changes)
- [x] Uses existing patterns (`as const` + union; private repo mappers; runner classification list)
- [x] Idempotency considered (frozen-per-row; succeeded jobs not retryable)
- [x] Event-driven patterns N/A (no events emitted/consumed by this change)
- [x] Rate limits & retries addressed (invariant exception is non-retryable)
- [x] Error handling comprehensive (domain exception + runner classification)
- [x] Testing strategy complete (unit + integration vertical slice)
- [x] Naming conventions followed (`*.types.ts`, `*.exception.ts`, `*.handler.ts`)
- [x] File structure matches standards
- [x] Plan is execution-ready (every step has a concrete file path + acceptance criterion)
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [Migrations Guide](../migrations.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- Issue [#400](https://github.com/openlinker-project/openlinker/issues/400) — this PR's parent
- Issue [#391](https://github.com/openlinker-project/openlinker/issues/391) — Plan A (closed, shipped via PR #396)
