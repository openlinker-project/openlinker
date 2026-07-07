# Implementation Plan: Convert `invoice_records` timezone-naive timestamp columns to `timestamptz`

**Date**: 2026-07-07
**Status**: Ready for Review
**Estimated Effort**: ~2-3 hours

---

## 1. Task Summary

**Objective**: Convert four `invoice_records` timestamp columns — `leaseExpiresAt`, `issuedAt`, `createdAt`, `updatedAt` — from timezone-naive `timestamp` to `timestamptz`, following the exact pattern PR #1262 applied to `sync_jobs`. Ship the entity change, a value-preserving migration, and a fail-first Testcontainers regression test.

**Context**: A tz-naive column compared against a timezone-aware JS `Date` parameter is host-timezone-dependent — on a non-UTC host the comparison can be off by the host's UTC offset. Two `invoice_records` columns hit exactly that vulnerable gating shape:

- **`leaseExpiresAt`** (`invoice-record.repository.ts` `claimForIssue`, `"leaseExpiresAt" <= :now`) — the atomic single-claim CAS lease (#1200) that lets exactly one concurrent same-key retry cross the fiscal-provider boundary. This is the high-severity half: a tz-skew mis-fire either stalls an issuance retry, or — worse — lets a not-yet-expired lease read as expired, so a second worker double-claims and **double-submits a fiscal invoice to KSeF**. Correctness/compliance bug, not tech-debt.
- **`issuedAt`** (`invoice-record.repository.ts` `findMany`, `inv.issuedAt >= :issuedFrom` / `inv.issuedAt <= :issuedTo`, the AC-6 date-range list filter, #1119) — same tz-naive-column-vs-`Date` shape. Lower stakes (read-only list filter; worst case an off-by-offset boundary on results), but it's a real bug fix, not consistency-only.

`createdAt` / `updatedAt` are not used in a gating comparison today; they're converted in the same migration for consistency, mirroring PR #1262's treatment of `sync_jobs.createdAt`/`updatedAt`.

`order_records.dispatchByAt` needs no change — the issue author already confirmed it is `timestamptz`; re-verified in this plan (see §4).

**Classification**: CORE — Infrastructure (persistence), `invoicing` bounded context.

---

## 2. Scope & Non-Goals

### In Scope
- `InvoiceRecordOrmEntity`: `leaseExpiresAt`, `issuedAt` → `@Column({ type: 'timestamptz', nullable: true })`; `createdAt` → `@CreateDateColumn({ type: 'timestamptz' })`; `updatedAt` → `@UpdateDateColumn({ type: 'timestamptz' })`.
- One migration converting the four existing `invoice_records` columns with `USING ... AT TIME ZONE 'UTC'` (value-preserving) plus a symmetric `down()`.
- One fail-first Testcontainers regression test proving `claimForIssue`'s lease-expiry gate is correct across genuinely different process-local timezones (a lease written by a `TZ=UTC` child process, evaluated by a `TZ=Pacific/Kiritimati` child process — see Phase 3 implementation note), appended to the existing `apps/api/test/integration/invoicing/invoice-record-repository.int-spec.ts` (both branches: not-yet-expired lease rejects reclaim; expired lease allows reclaim).

### Out of Scope
- `order_records` (already `timestamptz` — no change).
- Retroactive correction of any rows skewed by the pre-fix bug — the migration is a value-preserving relabel, not a data fix (documented in the migration docblock, matching #1262).
- Auditing any other tz-naive gating column elsewhere in the codebase — if one turns up, file a separate issue.

### Constraints
- Migration prefix must be a synthetic sequential timestamp **strictly greater** than the current tail on `main` — per `docs/migrations.md` § Timestamp uniqueness invariant (rule 3, #1013). Current tail as of this writing is `1818000000005-add-invoice-payment-status.ts`, so the next free prefix is `1818000000006`. **Re-verify at implementation time** with `ls apps/api/src/migrations/ | sort | tail -1` — this plan's number is a snapshot, not a guarantee, since other invoicing PRs may merge first.
- Both `up()` and `down()` required (reversibility).
- No domain/application-layer signature changes — `InvoiceRecord` domain entity already types these fields as `Date | null`; the change is fully contained in the ORM entity + migration.

---

## 3. Architecture Mapping

**Target Layer**: Infrastructure (persistence) within the `invoicing` core context (`libs/core/src/invoicing/infrastructure/persistence/`).

**Capabilities Involved**: none new. Change is behind `InvoiceRecordRepositoryPort`; no port signature change.

**Existing Services Reused**: `InvoiceRecordRepository.claimForIssue` (CAS lease), `findMany` (list filter) — both unchanged in behavior, only the underlying column type changes.

**New Components Required**: none (no new entities/ports/services). One new migration file.

**Core vs Integration Justification**: This is a CORE persistence fix — `invoice_records` is a core-owned table (`libs/core/src/invoicing/infrastructure/persistence/entities/`), not adapter-owned. No integration package is touched.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### Internal Patterns (PR #1262 — the pattern to mirror exactly)

- **Entity change**: `apps/api/src/migrations/1818000000000-fix-sync-jobs-timestamp-tz.ts` converted `sync_jobs.nextRunAt` / `lockedAt` / `createdAt` / `updatedAt` from `timestamp` to `timestamptz` via `ALTER COLUMN ... TYPE timestamptz USING "col" AT TIME ZONE 'UTC'`, with a symmetric `down()` reverting to `timestamp WITHOUT TIME ZONE USING "col" AT TIME ZONE 'UTC'`.
- **Migration docblock**: explains the root cause (naive column vs. tz-aware `Date` param), states the fix is going-forward correct, and explicitly notes the migration is a **value-preserving relabel** — it does not retroactively correct rows that were already skewed by the pre-fix bug on a non-UTC host.
- **Regression test**: `apps/worker/test/integration/job-intake-execution.int-spec.ts` (`should find due jobs created under a non-UTC Postgres session timezone`) opens a dedicated `QueryRunner`, runs `SET TIME ZONE 'Europe/Warsaw'` on that connection only, inserts a row through it, then asserts the repository's gating query (running on the harness's normal-timezone connection) still finds/excludes the row correctly.

### Verification performed for this plan

- Confirmed `order_records.dispatchByAt` in `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts` is `@Column({ type: 'timestamptz', nullable: true })` — no change needed, matching the issue's own audit.
- Confirmed current `InvoiceRecordOrmEntity` state (`libs/core/src/invoicing/infrastructure/persistence/entities/invoice-record.orm-entity.ts`): `issuedAt` and `leaseExpiresAt` are `@Column({ type: 'timestamp', nullable: true })`; `createdAt`/`updatedAt` use bare `@CreateDateColumn()` / `@UpdateDateColumn()` (TypeORM default `timestamp without time zone`).
- Confirmed the two vulnerable gating queries in `invoice-record.repository.ts`:
  - `claimForIssue`: `"leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= :now` (raw SQL fragment inside `.andWhere(...)`).
  - `findMany`: `inv.issuedAt >= :issuedFrom` / `inv.issuedAt <= :issuedTo` (query-builder `.andWhere`).
- Confirmed the natural test home already exists and already exercises `claimForIssue` against real Postgres: `apps/api/test/integration/invoicing/invoice-record-repository.int-spec.ts`, describe block `claimForIssue — atomic single-flight CAS (#1200)`. It already deep-imports `InvoiceRecordRepository` from `@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-record.repository` (sanctioned host-only test seam, `docs/testing-guide.md` § Test-only HTTP-seam faking / deep-import precedent) and `InvoiceRecordOrmEntity` from `@openlinker/core/invoicing/orm-entities`, and has a `claimRow(overrides)` helper that builds a claim-ready row (null idempotency key, unique `orderId`). The new test appends to this describe block rather than creating a new file.
- Confirmed migration tail: `ls apps/api/src/migrations/ | sort | tail -5` → `..0001-add-invoice-document-content.ts`, `..0002-add-invoice-source-document.ts`, `..0003-add-invoice-issued-line-snapshot.ts`, `..0004-backfill-ksef-provider-invoice-number.ts`, `..0005-add-invoice-payment-status.ts`. Next free synthetic prefix: `1818000000006`.

---

## 5. Questions & Assumptions

### Open Questions
None — the issue is fully specified and the codebase investigation above resolves every ambiguity (exact columns, exact queries, exact test placement, exact migration tail as of now).

### Assumptions
- The migration prefix `1818000000006` may need to be bumped again at actual implementation time if another invoicing migration merges first — the implementer must re-run `ls apps/api/src/migrations/ | sort | tail -1` immediately before creating the file, per `docs/migrations.md` § Timestamp uniqueness invariant rule 3.
- The regression test is added to the existing `invoice-record-repository.int-spec.ts` file (not a new file) since it already has the exact harness + helper scaffolding needed and already tests `claimForIssue` against real Postgres. This is a deviation from a literal reading of the issue text ("add a Testcontainers int-spec... colocate near existing invoicing int-specs") in favor of the more specific, less redundant option the issue itself allows for.
- No backfill of historical rows is performed — this is a value-preserving type relabel, matching #1262's explicit precedent and the issue's own stated non-goal.

### Documentation Gaps
None identified.

---

## 6. Proposed Implementation Plan

### Phase 1: Entity change

**Goal**: Convert the four columns to `timestamptz` on the ORM entity.

**Steps**:

1. **Update `InvoiceRecordOrmEntity`**
   - **File**: `libs/core/src/invoicing/infrastructure/persistence/entities/invoice-record.orm-entity.ts`
   - **Action**:
     - `issuedAt`: `@Column({ type: 'timestamp', nullable: true })` → `@Column({ type: 'timestamptz', nullable: true })`
     - `leaseExpiresAt`: `@Column({ type: 'timestamp', nullable: true })` → `@Column({ type: 'timestamptz', nullable: true })`
     - `createdAt`: `@CreateDateColumn()` → `@CreateDateColumn({ type: 'timestamptz' })`
     - `updatedAt`: `@UpdateDateColumn()` → `@UpdateDateColumn({ type: 'timestamptz' })`
   - **Acceptance**: `pnpm --filter @openlinker/api type-check` passes (entity is TypeORM-decorator-only change; domain-layer `Date | null` typing is unaffected).
   - **Dependencies**: none.

### Phase 2: Migration

**Goal**: Ship a value-preserving migration converting the four existing columns, reversible via `down()`.

**Steps**:

1. **Re-verify the migration tail**
   - **Action**: run `ls apps/api/src/migrations/ | sort | tail -1` and pick the next free synthetic prefix (strictly greater). Do not trust the `1818000000006` number in this plan without re-checking.
   - **Acceptance**: chosen prefix is greater than every existing filename prefix in `apps/api/src/migrations/` and every plugin migration dir in `scripts/plugin-migration-dirs.json`.

2. **Create the migration file**
   - **File**: `apps/api/src/migrations/{prefix}-fix-invoice-records-timestamp-tz.ts`
   - **Action**: mirror `1818000000000-fix-sync-jobs-timestamp-tz.ts` exactly:
     ```typescript
     import type { MigrationInterface, QueryRunner } from 'typeorm';

     export class FixInvoiceRecordsTimestampTz{prefix} implements MigrationInterface {
       public async up(queryRunner: QueryRunner): Promise<void> {
         await queryRunner.query(`
           ALTER TABLE "invoice_records"
             ALTER COLUMN "leaseExpiresAt" TYPE timestamptz USING "leaseExpiresAt" AT TIME ZONE 'UTC',
             ALTER COLUMN "issuedAt"       TYPE timestamptz USING "issuedAt"       AT TIME ZONE 'UTC',
             ALTER COLUMN "createdAt"      TYPE timestamptz USING "createdAt"      AT TIME ZONE 'UTC',
             ALTER COLUMN "updatedAt"      TYPE timestamptz USING "updatedAt"      AT TIME ZONE 'UTC'
         `);
       }

       public async down(queryRunner: QueryRunner): Promise<void> {
         await queryRunner.query(`
           ALTER TABLE "invoice_records"
             ALTER COLUMN "leaseExpiresAt" TYPE timestamp WITHOUT TIME ZONE USING "leaseExpiresAt" AT TIME ZONE 'UTC',
             ALTER COLUMN "issuedAt"       TYPE timestamp WITHOUT TIME ZONE USING "issuedAt"       AT TIME ZONE 'UTC',
             ALTER COLUMN "createdAt"      TYPE timestamp WITHOUT TIME ZONE USING "createdAt"      AT TIME ZONE 'UTC',
             ALTER COLUMN "updatedAt"      TYPE timestamp WITHOUT TIME ZONE USING "updatedAt"      AT TIME ZONE 'UTC'
         `);
       }
     }
     ```
     Class name suffix must match the filename's 13-digit prefix exactly (per `docs/migrations.md` § Migration Naming Convention).
   - **Docblock**: adapt #1262's docblock verbatim in structure — explain the root cause (`leaseExpiresAt` CAS-lease double-issue risk + `issuedAt` list-filter skew), state the fix makes future comparisons absolute-instant, and state explicitly this is a value-preserving relabel that does not retroactively correct any pre-fix skew.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists the migration as pending (not yet run) before the next step, and the filename/class-suffix pass `scripts/check-migration-timestamps.mjs` (run automatically via `pnpm lint`).
   - **Dependencies**: Phase 1 (entity change) should land in the same commit/PR so entity and schema never drift, though the migration itself has no code dependency on the entity file.

3. **Run and verify the migration locally**
   - **Action**: `pnpm --filter @openlinker/api migration:run` against a local/dev Postgres with existing `invoice_records` rows (or an empty dev DB — either way the DDL must apply cleanly); then `pnpm --filter @openlinker/api migration:revert` to prove `down()` works; then re-run `migration:run`.
   - **Acceptance**: `migration:show` reports no pending migrations after running; no errors in either direction; `\d invoice_records` in `psql` (or equivalent) shows the four columns as `timestamp with time zone` after `up()`.

### Phase 3: Regression test

**Goal**: Prove `claimForIssue`'s lease-expiry gate is correct across genuinely different process-local timezones — fails on the pre-fix naive schema, passes after.

**Implementation note (deviation from the original plan, discovered during implementation):** the plan's original design (`SET TIME ZONE` on a dedicated `QueryRunner`, mirroring `job-intake-execution.int-spec.ts`) was empirically tested and found to **not** reproduce the bug — it passed identically on both the pre-fix and post-fix schema. Root-cause investigation (reading `pg`'s `dateToString`/`postgres-date`'s `parseDate`, and probing the live Testcontainers Postgres directly) showed the actual mechanism: `node-postgres` serializes an outgoing `Date` parameter using the **process's own local time components + local UTC offset**, and Postgres's `timestamp without time zone` input parser silently **drops** that offset, storing the writing process's local wall-clock digits. The skew therefore depends on the **OS-level local timezone of the Node process**, not the Postgres session's `TimeZone` GUC — and `process.env.TZ` reassignment mid-process was also verified (via a throwaway probe) to have **no effect** on already-initialized Date behavior in this Jest/ts-jest setup, so a real reproduction requires genuinely different **processes**.

**Steps**:

1. **Add a child-process helper** — `apps/api/test/integration/helpers/tz-claim-probe.child.js`: a plain Node script (no TypeScript, no TypeORM) using the `pg` client directly, taking `(mode, host, port, user, password, database, id, leaseIso, nowIso)` as argv. `mode=write` sets `leaseExpiresAt`; `mode=compare` runs the exact `claimForIssue` CAS predicate and prints `{claimed: boolean}` to stdout.
2. **Add the tz regression tests** — `apps/api/test/integration/invoicing/invoice-record-repository.int-spec.ts`, appended inside `describe('claimForIssue — atomic single-flight CAS (#1200)', ...)`:
   - Both tests `child_process.spawnSync` the helper twice against the SAME running Testcontainers instance: once with `TZ=UTC` to write the lease, once with `TZ=Pacific/Kiritimati` (UTC+14, the most extreme real-world offset) to run the CAS-claim predicate — modeling two worker hosts with different local timezones, which is the real production scenario `claimForIssue` guards against.
   - **"does NOT reclaim a live lease written by a UTC process when compared by a UTC+14 process"** — live lease (+60s), expect `claimed: false`.
   - **"reclaims an expired lease written by a UTC process when compared by a UTC+14 process"** — expired lease (-60s), expect `claimed: true`.
   - **Empirically verified fail-first**: against the pre-fix (naive `timestamp`) schema, the first test **fails** (`Expected: false, Received: true` — the still-live lease is wrongly reclaimed, reproducing the double-claim/double-submit-to-KSeF risk end-to-end). Against the post-fix (`timestamptz`) schema, both tests pass.
   - **Dependencies**: Phases 1 and 2 must be applied against the Testcontainers-provisioned DB (migrations run automatically as part of the integration harness boot).

### Implementation Details

**New Components**: none beyond the migration file. No new entities, ports, services, controllers, or DTOs.

**Configuration Changes**: none.

**Database Migrations**: one new migration, `apps/api/src/migrations/{next-free-prefix}-fix-invoice-records-timestamp-tz.ts` (see Phase 2).

**Events**: none emitted or consumed — this is a pure persistence-layer type fix.

**Error Handling**: no new error paths. `claimForIssue`'s existing `InvoiceRecordNotFoundException` / contended-loss (`null`) semantics are unchanged; only the underlying column type changes.

**Reference**: [Engineering Standards - Project Structure](../engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: New standalone int-spec file instead of extending `invoice-record-repository.int-spec.ts`
- **Description**: Create a new file (e.g. `invoice-record-timestamptz.int-spec.ts`) dedicated to the tz regression, as a literal reading of the issue text suggests.
- **Why Rejected**: The existing `invoice-record-repository.int-spec.ts` already has the exact harness wiring, the `claimRow` helper, and a dedicated `claimForIssue` describe block. A new file would duplicate all of that scaffolding for two tests. Extending the existing suite is more consistent with "colocate near existing invoicing int-specs" (the issue's own guidance) and avoids redundant setup/teardown boilerplate.
- **Trade-offs**: None material — test discoverability is equal either way since both tests are clearly named and sit under the `claimForIssue` describe block.

### Alternative 2: Backfill/reinterpret historical skewed rows during the migration
- **Description**: Instead of a pure `AT TIME ZONE 'UTC'` relabel, attempt to detect and correct rows that may have been written under a skewed host timezone.
- **Why Rejected**: PR #1262 explicitly established the precedent of NOT doing this — the migration is a value-preserving relabel, and any skewed `leaseExpiresAt`/`issuedAt` values self-heal (leases expire and get reclaimed within one host-offset window; list-filter skew is a one-time boundary effect, not a persistent one). Attempting a retroactive correction would require knowing the host's actual historical timezone, which isn't recorded anywhere, and risks a genuinely destructive/incorrect rewrite of production data.
- **Trade-offs**: Any invoice issued in the narrow tz-skew window before this fix keeps its (possibly slightly off) recorded value; this matches the issue's own stated non-goal.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Pure infrastructure/persistence change within the `invoicing` core context; no port, service-interface, or cross-context contract changes.
- **Reference**: [Architecture Overview](../architecture-overview.md#14-invoicing)

### Naming Conventions
- ✅ Migration filename/class follow `{timestamp}-{description}.ts` / `{PascalCaseDescription}{timestamp}` per `docs/migrations.md` § Migration Naming Convention.
- **Reference**: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Migration structure and docblock shape mirror PR #1262 exactly. The regression-test *technique* diverges from #1262's `SET TIME ZONE`-on-a-`QueryRunner` pattern — that pattern was tried first and empirically shown not to reproduce the bug (see Phase 3 implementation note) — but the *intent* (fail-first proof under a real timezone mismatch) is the same.

### Risks
- **Migration timestamp collision**: if another invoicing migration merges to `main` between plan-writing and implementation, the hardcoded `1818000000006` will collide or sort incorrectly. **Mitigation**: Phase 2 Step 1 mandates re-checking the tail immediately before creating the file; `scripts/check-migration-timestamps.mjs` (`pnpm lint`) fails the build on any collision or ordering violation before merge.
- **Long-lived transaction lock during `ALTER COLUMN ... TYPE`**: on Postgres, an `ALTER COLUMN TYPE` that doesn't change the on-disk representation is typically fast, but `timestamp → timestamptz` does rewrite the table (it's not a no-op type change) and takes an `ACCESS EXCLUSIVE` lock for the duration. **Mitigation**: `invoice_records` is a low-volume table (fiscal documents, not high-frequency events) so table-rewrite time is expected to be negligible; no additional mitigation needed. If this table ever grows very large, a future migration could switch to a `USING` expression on a new column + rename, but that's out of scope here — matches #1262's precedent, which used a plain `ALTER COLUMN TYPE` on `sync_jobs` without incident.

### Edge Cases
- **Null `leaseExpiresAt` / `issuedAt`**: `AT TIME ZONE 'UTC'` on a `NULL` value stays `NULL` — no special-casing needed in the migration SQL.
- **Concurrent claim during migration window**: the migration runs as part of deployment before traffic resumes (standard "migrate then start" pattern per `docs/architecture-overview.md`), so no live `claimForIssue` calls race the schema change.

### Backward Compatibility
- ✅ No breaking change to any public contract — `InvoiceRecord` domain entity, `InvoiceRecordRepositoryPort`, and all consuming services keep the same `Date | null` field types. The `down()` migration provides a tested rollback path.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- None required — no application/domain logic changes. The existing unit-level mocked `claimForIssue` tests (if any) are unaffected since they mock the QueryBuilder and don't depend on the real column type.

### Integration Tests
- **File**: `apps/api/test/integration/invoicing/invoice-record-repository.int-spec.ts` (extended, not new).
- Two new tests under `describe('claimForIssue — atomic single-flight CAS (#1200)', ...)`:
  1. A live lease written by a `TZ=UTC` child process is NOT reclaimed when evaluated by a `TZ=Pacific/Kiritimati` child process.
  2. An expired lease written by a `TZ=UTC` child process IS reclaimed when evaluated by a `TZ=Pacific/Kiritimati` child process.
- Both must be written to fail against the pre-fix schema and pass after — verified manually during implementation (temporarily revert Phase 1+2, confirm red, reapply, confirm green).

### Mocking Strategy
- Real Postgres via Testcontainers (existing `getTestHarness()` / `resetTestHarness()` / `teardownTestHarness()` harness) — no mocking. This is precisely the class of behavior (real driver tz interaction) that a mocked unit test cannot prove, matching the issue's own reasoning for requiring an integration test.

### Acceptance Criteria
- [ ] `leaseExpiresAt`, `issuedAt`, `createdAt`, `updatedAt` on `InvoiceRecordOrmEntity` are `timestamptz`
- [ ] A new migration converts the existing `invoice_records` columns with `USING ... AT TIME ZONE 'UTC'` (value-preserving), uses the next free synthetic prefix re-verified at implementation time (not a `Date.now()` prefix), and has a correct `down()`
- [ ] `pnpm --filter @openlinker/api migration:show` shows the migration as pending before running, and no errors after running
- [x] A Testcontainers regression test proves `claimForIssue`'s lease-expiry gate is correct across genuinely different process-local timezones (fails on pre-fix schema — verified: still-live lease wrongly reclaimed — passes after)
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all pass
- [ ] No architecture boundary violations (CORE ↔ Integration) — none touched

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — mirrors PR #1262 exactly
- [x] Idempotency considered — migration is value-preserving and re-runnable via standard `migration:run`/`migration:revert`
- [x] Event-driven patterns used where applicable — N/A, no events involved
- [x] Rate limits & retries addressed — N/A, no external calls
- [x] Error handling comprehensive — no new error paths introduced
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Database Migrations](../migrations.md)
- [Code Review Guide](../code-review-guide.md)
- Prior art: PR #1262 (`fix(sync): use timestamptz for nextRunAt/lockedAt`)
