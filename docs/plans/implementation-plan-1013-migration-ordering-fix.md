# Implementation Plan: Fix Migration Ordering — `AddShipmentCarrier` Runs Before `shipments` Table Exists (#1013)

**Date**: 2026-06-10
**Status**: Ready for Review
**Estimated Effort**: 3–4 hours
**Issue**: [#1013](https://github.com/openlinker-project/openlinker/issues/1013)
**Implementation branch**: `1013-fix-migration-ordering` (fresh worktree from `main`)

---

## 1. Task Summary

**Objective**: Make `pnpm --filter @openlinker/api migration:run` succeed on a fresh database again, without breaking databases that already executed the mis-timestamped migration — and close the lint-guard gap that let the bug merge.

**Context**: `apps/api/src/migrations/1779985594755-AddShipmentCarrier.ts` (PR #881, commit `f0642f0d`) kept the **real epoch timestamp** emitted by `migration:generate` (`1779985594755` ≈ 2026-05-29) instead of being re-prefixed to the repo's synthetic sequential convention (`17XX000000000` + small offsets). TypeORM executes migrations in timestamp order, so it sorts between `1779000000001-add-allegro-category-cache-table.ts` and `1780000000000-add-enabled-capabilities-to-connections.ts` — **before** `1799000000000-add-shipments-table.ts` creates the `shipments` table it alters. Fresh databases fail at step ~21/57 with `QueryFailedError: relation "shipments" does not exist`; incremental databases (where `shipments` predated the carrier migration) worked, which is why it went unnoticed. Every fresh install, every Testcontainers integration run, and every new contributor onboarding is currently broken.

**Classification**: Infrastructure (persistence/migrations) + DX (lint invariant) + Documentation.

---

## 2. Scope & Non-Goals

### In Scope
1. Re-timestamp the carrier migration to sort after the current tail (`1801000000000-AddShipmentDeliveryIntent.ts`), with a **self-healing `up()`** so already-migrated databases converge (mirror of the #374 recovery pattern in `1790000000002-add-currency-to-products.ts`).
2. Extend `scripts/check-migration-timestamps.mjs` with an **ordering invariant**: a migration file *added on the current branch* must not sort before the highest timestamp already on `origin/main`.
3. Document the synthetic-sequential timestamp convention and the "re-prefix after `migration:generate`" step in `docs/migrations.md`.

### Out of Scope
- Re-timestamping the six *historical* real-epoch migrations (`1766246163229`, `1766837314000`, `1766837626402`, `1767551453556`, `1767713171000`, `1767900000000` plugin) — they predate the synthetic convention, sort correctly, and renaming executed migrations is forbidden (`docs/migrations.md` § Best Practices, rule 4 applies to *order-safe* history).
- Any schema change beyond what the original migration already did (`shipments.carrier` column + `IDX_shipments_carrier`).
- Changing TypeORM's migration-ordering mechanism or the `migrations` table shape.

### Constraints
- **Backward compatibility is the hard constraint**: every contributor dev DB (and any deployed env) that ran `AddShipmentCarrier1779985594755` has that row in the `migrations` table; a naive rename re-executes the body → `column "carrier" of relation "shipments" already exists`.
- The guard must stay a plain `.mjs` script (no ts-node) and keep the existing pure-validator + `--self-check` structure.
- Lint runs offline pre-commit; the ordering check must degrade gracefully when git context is unavailable.

---

## 3. Architecture Mapping

**Target Layer**: App (`apps/api/src/migrations/`) + repo tooling (`scripts/`) + docs. No CORE, Integration, Interface, or domain-layer changes.

**Capabilities Involved**: none (no ports touched).

**Existing Services Reused**: none — this is DDL + lint tooling.

**Existing Patterns Reused** (the load-bearing part):
- **Self-healing re-timestamped migration** — `apps/api/src/migrations/1790000000002-add-currency-to-products.ts` is the exact in-repo precedent (#374 recovery): header documents the collision, `up()` first `DELETE`s the orphaned old `migrations` row, then applies DDL idempotently (`ADD COLUMN IF NOT EXISTS`). Both statements commit atomically with TypeORM's own `migrations` insert (`transaction: 'all'`, Postgres supports DDL in transactions). `1788000000001-rename-marketplace-capability.ts` is the second instance of the same pattern.
- **Invariant script shape** — `scripts/check-migration-timestamps.mjs` already separates pure validators (`validateEntries`, `validatePluginMigrationDirsDrift`) from I/O, with inline-fixture `--self-check` wired into `check:invariants`. The ordering check adds a third pure validator in the same style.

**Core vs Integration Justification**: N/A — migrations are owned by `apps/api` (core schema, `docs/migrations.md` § Overview); the guard is repo-level DX.

**ADR**: Not warranted (per `docs/architecture/adrs/README.md` criteria) — this is a bug fix following an already-established pattern (#374), no cross-context contract or seriously-considered alternative with architectural trade-offs. The lightweight alternatives analysis lives in § 7 below.

---

## 4. External / Domain Research

### Internal Findings

| Fact | Evidence |
|---|---|
| Offending file sorts 21st of 57; `shipments` created at position ~47 | `ls apps/api/src/migrations/ \| sort` on `main` @ `5547f13d` |
| Original migration body: `ADD "carrier" text` + `CREATE INDEX "IDX_shipments_carrier"` | `1779985594755-AddShipmentCarrier.ts` |
| ORM entity expects both: `@Index('IDX_shipments_carrier', ['carrier'])`, `carrier!: string \| null` | `libs/core/src/shipping/infrastructure/persistence/entities/shipment.orm-entity.ts:36,90` |
| Old class name referenced **nowhere** outside the migration file itself | `grep -rln "AddShipmentCarrier"` → migration + orm-entity comment only |
| Timestamp `1802000000000` is free (current max: `1801000000000`) | migrations dir + plugin dir scan |
| Guard today enforces: 13-digit shape, filename↔class match, uniqueness across core+plugin dirs — **no ordering rule** | `scripts/check-migration-timestamps.mjs` |
| Later shipments migrations (`1799000000006/7`, `1801000000000`) do **not** reference the `carrier` column, so moving it to the tail breaks no inter-migration dependency | grep over `apps/api/src/migrations/*.ts` |
| Integration-test harness runs `dataSource.runMigrations()` against a fresh Testcontainers Postgres — i.e. **every int-spec boot reproduces the bug today** and doubles as regression coverage after the fix | `apps/api/test/integration/setup.ts` (per `docs/testing-guide.md` § How It Works) |

### Affected Database States (the matrix the fix must converge)

| State | `migrations` row `AddShipmentCarrier1779985594755` | `carrier` column | After fix migration runs |
|---|---|---|---|
| A. Fresh DB | absent | absent | DELETE no-ops; column + index created ✅ |
| B. Incremental DB (ran old migration) | present | present | row deleted; `IF NOT EXISTS` no-ops; new row recorded ✅ |
| C. DB migrated up to < `1799000000000` only (partial) | present (it ran early!) | **absent** (`shipments` missing) | wait — see Risks § 8: in state C the old migration *failed*, so the row was rolled back; state C is actually identical to A ✅ |

(TypeORM wraps each migration in a transaction; a failed `up()` leaves no `migrations` row. So only states A and B exist in the wild.)

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. One judgment call surfaced to the reviewer: whether the ordering guard should *also* hard-reject real-epoch-shaped timestamps. Decision below (§ 7, Alternative B) is to rely on the git-aware ordering rule instead — shape-based detection can't cleanly distinguish "synthetic" from the six grandfathered historical prefixes without an allow-list that invites drift.

### Assumptions
1. **No production deployment exists beyond contributor/dev databases** — but the fix is written as if there were (states A and B both converge), so the assumption is not load-bearing.
2. `origin/main` is fetchable wherever lint runs in CI (GitHub Actions checkout has it; local pre-commit may not — the check skips gracefully with a notice when the ref is missing).
3. The synthetic convention is intended (56/57 files follow it); PR #881's real timestamp was an oversight, not a convention change.

### Documentation Gaps
- `docs/migrations.md` documents *uniqueness* but never states the **ordering/synthetic-prefix convention** — closed by Phase 3 below.

---

## 6. Proposed Implementation Plan

### Phase 1 — Fix the broken ordering (the bug)

1. **Create the re-timestamped, self-healing migration**
   - **File**: `apps/api/src/migrations/1802000000000-add-shipment-carrier.ts` (new)
   - **Action**: Class `AddShipmentCarrier1802000000000`. Mirror the `1790000000002-add-currency-to-products.ts` precedent exactly:
     - File header documenting the re-timestamp (`1779985594755` → `1802000000000`, #1013) and the self-healing semantics, per the #374 precedent's header style.
     - `up()`:
       ```sql
       DELETE FROM "migrations" WHERE "name" = 'AddShipmentCarrier1779985594755';
       ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "carrier" text;
       CREATE INDEX IF NOT EXISTS "IDX_shipments_carrier" ON "shipments" ("carrier");
       ```
     - `down()`:
       ```sql
       DROP INDEX IF EXISTS "public"."IDX_shipments_carrier";
       ALTER TABLE "shipments" DROP COLUMN IF EXISTS "carrier";
       ```
   - **Acceptance**: file passes `check-migration-timestamps.mjs` (13 digits, class match, unique, > current max).
   - **Dependencies**: none.

2. **Delete the mis-timestamped original**
   - **File**: `apps/api/src/migrations/1779985594755-AddShipmentCarrier.ts` (delete)
   - **Action**: remove the file. (Both files coexisting would re-create the fresh-DB failure *and* double-apply on state B.)
   - **Acceptance**: `grep -r AddShipmentCarrier1779985594755 apps/ libs/ scripts/` → only the DELETE statement inside the new migration.
   - **Dependencies**: step 1 (atomic in the same commit).

3. **Verify state A (fresh DB)**
   - **Action**: against a scratch database (`docker exec openlinker-postgres psql -U postgres -c 'CREATE DATABASE openlinker_mig_check;'` + `DB_DATABASE=openlinker_mig_check pnpm --filter @openlinker/api migration:run`), confirm all 57 migrations apply cleanly; then `migration:revert` once (drops index + column) and re-run. Drop the scratch DB afterwards.
   - **Acceptance**: full run green; `\d shipments` shows `carrier` + `IDX_shipments_carrier`; `migrations` table contains `AddShipmentCarrier1802000000000` and **not** `…1779985594755`.

4. **Verify state B (incremental DB)**
   - **Action**: on a second scratch DB, simulate the legacy state: run migrations on a checkout of `main~1` semantics — practically: restore the old file temporarily OR (simpler, no checkout juggling) run the new suite, then `INSERT INTO migrations(timestamp,name) VALUES (1779985594755,'AddShipmentCarrier1779985594755');` + `DELETE FROM migrations WHERE name='AddShipmentCarrier1802000000000';` to fabricate state B, then `migration:run` again.
   - **Acceptance**: run is a clean no-op-converge: old row gone, new row present, no duplicate-column error.

### Phase 2 — Close the guard gap (prevention)

5. **Add the ordering invariant to the guard script**
   - **File**: `scripts/check-migration-timestamps.mjs`
   - **Action**: add a third pure validator `validateOrdering({ entries, baselineMaxTimestamp })` in the existing style: every entry **not present in the baseline set** must have `timestamp > baselineMaxTimestamp`. Violation message names the file, the baseline max, and the fix ("bump the prefix to the next free synthetic timestamp > {max} and update the class suffix").
   - I/O wrapper: derive the baseline from git — `git ls-tree -r --name-only origin/main -- apps/api/src/migrations <plugin dirs>` (one `execSync`, no checkout). Files present on `origin/main` are baseline; files only in the working tree are "new". If `origin/main` is unresolvable (no remote, shallow clone without the ref), print a one-line `skipped (no origin/main ref)` notice and exit 0 for this sub-check only — uniqueness/shape checks still run.
   - **Acceptance**: with the Phase 1 changes applied, `node scripts/check-migration-timestamps.mjs` passes; re-introducing a file with prefix `1779985594756` fails with the ordering message.
   - **Dependencies**: Phase 1 (otherwise the working tree itself violates… actually no — `1779985594755` is *in* the origin/main baseline, so the guard wouldn't flag it; ordering protects the future, Phase 1 fixes the past. No hard dependency, but ship together).

6. **Extend `--self-check` fixtures**
   - **File**: `scripts/check-migration-timestamps.mjs` (bottom self-check section)
   - **Action**: fixtures for `validateOrdering`: (pass) new file above baseline max; (pass) no new files; (pass) empty baseline (fresh repo) accepts anything; (fail) new file below baseline max — message contains `sorts before`; (fail) new file equal to baseline max (collision is also ordering-ambiguous).
   - **Acceptance**: `node scripts/check-migration-timestamps.mjs --self-check` green (already chained in `check:invariants`).

### Phase 3 — Documentation

7. **Document the convention + recovery**
   - **File**: `docs/migrations.md`
   - **Action**:
     - § *Timestamp uniqueness invariant*: add rule **3. Ordered** — "a new migration's timestamp must be greater than every migration already on `main` (core + plugin dirs). `migration:generate` emits a real `Date.now()` prefix — re-prefix it to the next free synthetic timestamp (current tail + 1 step) and update the class suffix before committing." Reference the new guard sub-check and #1013.
     - § *Troubleshooting*: add entry **6. Migration sorts before its dependency** describing the #1013 failure shape (`relation "X" does not exist` on fresh DBs only) and the recovery recipe (this fix is the worked example; cross-link `1802000000000-add-shipment-carrier.ts` alongside the existing #374 recovery section).
   - **Acceptance**: doc renders; `pnpm lint` (which greps some docs via other invariant scripts) stays green.

8. **Add `docs/lessons.md` entry**
   - **File**: `docs/lessons.md`
   - **Action**: one entry in the file's documented format: *"`migration:generate` keeps a real epoch timestamp — always re-prefix to the synthetic sequence; real timestamps can sort into the middle of history and break fresh-DB runs (#1013, escaped via PR #881)."*
   - **Acceptance**: follows the format at the top of that file.

### Phase 4 — Quality gate & PR

9. **Quality gate** (scoped, per repo test policy)
   - `pnpm lint` (runs all invariant checks incl. the new one + self-check)
   - `pnpm type-check`
   - `pnpm --filter @openlinker/api migration:show` against the scratch DB — no pending surprises
   - One fresh-DB integration boot as regression proof: `pnpm test:integration app-boot.int-spec.ts` (Testcontainers runs the full migration suite on an empty Postgres — this is the exact reproduction environment). *Do not run the full integration suite on this machine.*
10. **Commit + PR**
    - Conventional commit, DCO sign-off: `fix(migrations): re-timestamp AddShipmentCarrier after shipments table creation (self-healing)` body referencing the guard + docs, `Closes #1013`.
    - Branch `1013-fix-migration-ordering`, PR to `main`.

### Implementation Details

**New Components**: none beyond the migration file and one pure validator function.
**Configuration Changes**: none.
**Database Migrations**: one (the re-timestamped self-healing migration) — replaces, not adds, schema surface.
**Events**: none.
**Error Handling**: guard script exits non-zero with one human-readable line per violation (existing contract); migration relies on TypeORM per-migration transactions for atomicity of `DELETE`-row + DDL.

---

## 7. Alternatives Considered

### Alternative A: No-op tombstone (keep old file, empty `up()`)
- **Description**: keep `1779985594755` as a no-op so state-B history stays untouched; add a new tail migration with the DDL guarded by `IF NOT EXISTS`.
- **Why Rejected**: leaves a permanently misleading file in history, *two* files for one schema change, and state-B DBs keep a row for a migration whose body no longer matches what ran. The #374 precedent (`DELETE` orphan row + idempotent DDL in the renamed migration) already solved this more cleanly and is documented in `docs/migrations.md` § Recovery.
- **Trade-offs**: tombstone avoids touching the `migrations` table; precedent-consistency and single-file clarity win.

### Alternative B: Stateless shape check instead of git-aware ordering ("reject real-epoch timestamps")
- **Description**: lint-reject any prefix not matching the synthetic shape, grandfathering the six historical real-epoch files in an allow-list.
- **Why Rejected**: the "synthetic shape" isn't one regex (`1799000000009`, `1767900000000`, `1800000000000` differ structurally); an allow-list invites drift; and it misses the subtler failure (a *synthetic but too-low* prefix picked in a branch-merge window — exactly the #374 family). The git-aware rule "new files sort after origin/main's max" catches both classes with zero false positives on history.
- **Trade-offs**: git-aware check needs the `origin/main` ref and skips when absent; CI always has it, so the net is strictly better coverage.

### Alternative C: Manual operator instructions only (fix docs, tell people to clean their DB)
- **Why Rejected**: an OSS platform can't require manual SQL from every fresh-install user; the issue's whole point is that `migration:run` must work unattended.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No layer boundaries touched; migrations stay in `apps/api/src/migrations/`; guard stays a plain `.mjs` invariant script chained into `check:invariants`.

### Naming Conventions
- ✅ New migration uses kebab-case description (`1802000000000-add-shipment-carrier.ts`) per the dominant pattern (the deleted file's PascalCase description was itself an outlier); class repeats the timestamp suffix.

### Existing Patterns
- ✅ Self-healing migration mirrors `1790000000002-add-currency-to-products.ts` statement-for-statement; validator + self-check mirror the script's existing two validators.

### Risks
- **Risk: another env state we didn't model** (e.g. someone hand-applied `ALTER TABLE` from `docs/migrations.md`-style recovery without a `migrations` row). Mitigation: every statement in `up()`/`down()` is `IF [NOT] EXISTS`-guarded, so any {row present/absent} × {column present/absent} × {index present/absent} combination converges.
- **Risk: `git ls-tree origin/main` fails in exotic checkouts** (worktree without fetched main, tarball builds). Mitigation: explicit graceful skip with a printed notice; the deterministic sub-checks (shape/uniqueness/class) never skip.
- **Risk: ordering check false-positives on plugin-dir migrations** whose numbering is independent. Mitigation: baseline max is computed over the same union (core + plugin dirs) the uniqueness check already uses — one global ordering line, consistent with TypeORM's actual single-sequence execution.
- **Risk: `migration:revert` on state B after the fix** reverts `AddShipmentCarrier1802000000000` (drops column + index) even though the *data* may have been written under the old run. Acceptable: revert semantics are unchanged from any normal migration; `IF EXISTS` guards prevent errors.

### Edge Cases
- **Fresh repo / first migration ever** (empty baseline): ordering validator passes anything — covered by a self-check fixture.
- **Two new migrations in one branch**: both must exceed the baseline max; they must also be unique among themselves (existing rule) — combined effect: strictly increasing, order between the two new ones is the author's choice.
- **Re-run of the fix migration** (already-converged DB): `DELETE` no-ops, DDL no-ops — but TypeORM won't re-run it anyway (row present).

### Backward Compatibility
- ✅ State A and state B both converge to identical end state (§ 4 matrix); no manual operator action anywhere.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- Guard script: extended `--self-check` inline fixtures (the script's established test vehicle — no Jest needed; it runs on every `pnpm lint`).

### Integration Tests
- No new int-spec file. `apps/api/test/integration/app-boot.int-spec.ts` already boots against a fresh Testcontainers Postgres and runs the full migration suite — it is the regression test for this bug. Run it once locally as part of the gate (single suite only, per machine constraints).

### Manual Verification (scripted in Phase 1, steps 3–4)
- Fresh-DB full `migration:run` + one `revert`/re-run cycle.
- Fabricated state-B convergence run.

### Acceptance Criteria
- [ ] `migration:run` succeeds end-to-end on a fresh, empty database (57 migrations)
- [ ] `migration:run` converges a state-B database with no errors; `migrations` table ends with the new class name only
- [ ] `1779985594755-AddShipmentCarrier.ts` is deleted; its class name survives only inside the new migration's `DELETE`
- [ ] `check-migration-timestamps.mjs` fails lint on a fixture migration that sorts before origin/main's max, and on the real-world shape (re-adding a `1779…` file)
- [ ] `--self-check` covers pass/fail/skip paths of the ordering validator
- [ ] `docs/migrations.md` documents the ordering rule + re-prefix step; `docs/lessons.md` entry added
- [ ] Quality gate green: `pnpm lint`, `pnpm type-check`, `app-boot.int-spec.ts`
- [ ] PR from `1013-fix-migration-ordering` with `Closes #1013`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (no layers touched; app-owned migrations + repo tooling)
- [x] Respects CORE vs Integration boundaries (no cross-boundary changes)
- [x] Uses existing patterns (#374 self-healing precedent; invariant-script validator style)
- [x] Idempotency considered (every DDL statement `IF [NOT] EXISTS`-guarded; convergence matrix in § 4)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (guard messages actionable; migration transactional)
- [x] Testing strategy complete (self-check fixtures + fresh-DB int-spec boot + scripted manual matrix)
- [x] Naming conventions followed (kebab-case migration description, timestamp↔class match)
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Database Migrations](../migrations.md) — workflow + the #374 recovery precedent
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md) — Testcontainers harness that reproduces the bug
