# Implementation Plan — Fix duplicate migration timestamps + add CI guard (#374)

## 1. Goal

Eliminate the duplicate-timestamp migration collision that silently leaves `products.currency` unapplied on some developer DBs, and add a repo-wide guard so the pattern can't recur.

**Scope expands beyond what the issue describes.** The issue names one colliding pair (`1790000000000`). The research step found a **second** pair in the tree (`1788000000000`) that is a latent version of the same bug — `PromoteProductVariantEntityType` does do DDL (drops/re-adds the `inventory_items → product_variants` FK, re-prefixes primary keys) and `RenameMarketplaceCapability` does jsonb UPDATEs on `connections.enabledCapabilities`, but the two operate on **disjoint tables and columns** (`connections.enabledCapabilities` vs `product_variants` / `identifier_mappings` / `inventory_items` / `offer_creation_records`), so undefined execution order between them has no observable effect today. Both pairs must be fixed, otherwise the new guard can't be enabled without immediately failing.

**Layer:** Backend / DX — TypeORM migrations in `apps/api/src/migrations/` + a root-level invariant script wired into `pnpm lint`.

**Non-goals:**
- **No edits to the already-merged migrations that stay put.** Renaming a migration file or class changes the row TypeORM writes into the `migrations` table on every environment that has already run it. The rename is applied only to the *second-merged* file in each pair; the first-merged file is frozen.
- **No TypeORM monkey-patching / fork.** The root cause is undefined ordering between migrations sharing a timestamp — we fix by guaranteeing uniqueness, not by teaching TypeORM a tie-breaker.
- **No fix to the pre-existing `1766246163229-add-connections-and-mappings..ts` filename typo** (two dots before `.ts`) — out of scope, unrelated to this bug.
- **No unit-test harness for the guard script.** Existing invariant scripts (`scripts/check-fixture-purity.sh`, `scripts/check-render-template-fixture-drift.mjs`) don't ship with unit tests; the guard is self-validating (it runs against the committed tree on every `pnpm lint`). Manual sensitivity check documented in the PR instead.

## 2. Research notes

### Collision set

Two colliding pairs exist at merge time on `main`. In each pair, the second-merged file is the one to rename (renaming the first-merged would orphan `migrations` rows on every environment that has already applied it).

| Timestamp | First-merged (keep) | Second-merged (rename) |
|---|---|---|
| `1790000000000` | `AddPromptTemplatesTable` — commit `d0623cd` (2026-04-23 11:39) | `AddCurrencyToProducts` — commit `6cec005` (2026-04-23 12:04) |
| `1788000000000` | `PromoteProductVariantEntityType` — commit `3b5169e` (2026-04-22 22:24) | `RenameMarketplaceCapability` — commit `977fe5a` (2026-04-22 23:01) |

(Research via `git log --diff-filter=A --format="%h %cI %s" --follow -- <path>`.)

### Safe timestamp windows

- `1790000000001` is taken by `SeedPromptTemplates1790000000001` → new slot for `AddCurrencyToProducts` is `1790000000002`.
- `1789000000000` is taken by `AddProductContentFieldTable1789000000000` → new slot for `RenameMarketplaceCapability` is `1788000000001`.

### DataSource discovery

`apps/api/src/database/data-source.ts:62-66`:
```typescript
migrations: [
  __dirname + '/../migrations/**/*{.ts,.js}',
],
```
Glob pick-up, alphabetical sort by filename (= timestamp-prefix-first sort since timestamps are fixed-width). No explicit list, so filename rename is sufficient — no registry to update.

### TypeORM collision behaviour

TypeORM 0.3.17 sorts by `timestamp` only. When two migrations share a timestamp, the execution order is undefined across environments. The observed consequence on the affected dev DB: both class rows get recorded in the `migrations` table, but one of the two `up()` bodies didn't run. Whether the failure is a lost DDL (our case) or a lost UPDATE depends on which migration drew the short straw on that machine.

### Idempotency gap on rename

Renaming the class name forces TypeORM to treat the renamed migration as pending on every environment that already ran the old name. States to handle:

| State | Old row in `migrations` | DDL applied | Behaviour after rename without safeguards |
|---|---|---|---|
| A (common, correct) | ✅ | ✅ | New class runs → `ADD COLUMN` **fails** (column exists) |
| B (fresh DB) | ❌ | ❌ | New class runs → `ADD COLUMN` succeeds |
| C (broken, from the issue) | ✅ | ❌ | New class runs → `ADD COLUMN` succeeds |
| D (rare) | ❌ | ✅ | New class runs → `ADD COLUMN` **fails** |

Without self-healing logic the rename breaks State A — i.e. virtually everyone's dev DB. The renamed migration must therefore:

1. `DELETE FROM "migrations" WHERE name = '<old-class-name>'` (safe: the old class no longer exists in code, so the row is purely orphaned accounting).
2. Use `ADD COLUMN IF NOT EXISTS` on the DDL (Postgres 9.6+ — we run 16).

After both steps, all four states converge to a consistent end state. `RenameMarketplaceCapability` has no DDL — its body is already UPDATE-idempotent — so it only needs step 1.

### Guard pattern

Existing invariants wired via root `package.json:16-17`:
```json
"lint": "pnpm -r lint && pnpm check:invariants",
"check:invariants": "bash scripts/check-fixture-purity.sh && node scripts/check-render-template-fixture-drift.mjs",
```
Pattern: scripts live at repo root under `scripts/`, shell or Node ESM, exit non-zero on violation, print a one-line `NAME: OK` on success. Invoked on every `pnpm lint` run, so hooked into the pre-commit gate for free.

### Existing tests

No unit tests for individual migrations. Integration test harness (`apps/api/test/integration/setup.ts:91`) calls `dataSource.runMigrations()` on startup — this is why the broken state isn't caught by CI today: the harness uses a clean container every run, landing the tree in State B where the collision happens to produce the right schema by chance.

## 3. Design

### Renamed migrations

Two files change; the class inside each is also renamed to keep the trailing-timestamp convention.

**`apps/api/src/migrations/1790000000002-add-currency-to-products.ts`** (was `1790000000000-AddCurrencyToProducts.ts`):
- File rename also switches the stem to kebab-case, matching every other migration in the tree except the pre-existing inconsistency we're retiring.
- Class: `AddCurrencyToProducts1790000000000` → `AddCurrencyToProducts1790000000002`.
- `up()` body:
  1. `DELETE FROM "migrations" WHERE name = 'AddCurrencyToProducts1790000000000'` — orphan-row cleanup.
  2. `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "currency" character varying(3)` — idempotent DDL.
- `down()` body: unchanged (`DROP COLUMN`), because the rollback semantics haven't changed.

**`apps/api/src/migrations/1788000000001-rename-marketplace-capability.ts`** (was `1788000000000-rename-marketplace-capability.ts`):
- File rename: timestamp-only bump; stem already kebab-case.
- Class: `RenameMarketplaceCapability1788000000000` → `RenameMarketplaceCapability1788000000001`.
- `up()` body:
  1. `DELETE FROM "migrations" WHERE name = 'RenameMarketplaceCapability1788000000000'` — orphan-row cleanup.
  2. Existing UPDATE/logging body unchanged. The UPDATE clauses are already idempotent-by-predicate (`WHERE ... 'Marketplace' = ANY(...)`), so re-running on State A correctly does nothing.
- `down()` body: unchanged.

### Guard script

**`scripts/check-migration-timestamps.mjs`** — new ESM Node script at repo root, following the shape of `check-render-template-fixture-drift.mjs`:

Responsibilities:
1. Glob `apps/api/src/migrations/*.ts` (excluding `.d.ts` / `.spec.ts` / `.test.ts` if any appear later).
2. For each file, parse:
   - The leading 13-digit timestamp from the filename (regex `/^(\d{13})-/`).
   - The trailing digits from the exported class name (regex `/export class \w+?(\d{13}) implements MigrationInterface/`).
3. Enforce three invariants:
   - Every filename has a 13-digit leading timestamp (fail otherwise).
   - The filename timestamp exactly equals the class trailing timestamp (mismatch = fail — catches half-renames).
   - No two filenames share a timestamp (the headline invariant).
4. Exit non-zero and print a `migration-timestamps: <N> violation(s)` summary on any violation, or `migration-timestamps: OK (<N> migrations)` on success.

The class-vs-filename sanity check piggy-backs cheaply on the same scan and catches a common half-rename bug (operator updates only the filename or only the class, leaving the two out of sync).

No `--dir` override, no configuration, no unit test. Manual sensitivity check is demonstrated in the PR by temporarily adding a fake colliding file and re-running the guard; then reverted.

### Wiring

**`package.json:17`** — amend the `check:invariants` chain:
```diff
-"check:invariants": "bash scripts/check-fixture-purity.sh && node scripts/check-render-template-fixture-drift.mjs",
+"check:invariants": "bash scripts/check-fixture-purity.sh && node scripts/check-render-template-fixture-drift.mjs && node scripts/check-migration-timestamps.mjs",
```

This fires on every `pnpm lint` (which the pre-commit hook runs), so the guard gates every commit and every CI run.

### Documentation

**`docs/migrations.md`** — two additions:

1. A new subsection under **Troubleshooting → Common Issues** (insert after line 244, before "Debugging Tips"):
   ```markdown
   #### 5. Duplicate migration timestamp
   
   **Problem**: Two migrations share the same timestamp prefix. TypeORM's
   ordering is undefined across environments — some dev DBs will record
   both migrations as applied but one `up()` body will not have run.
   
   **Prevention**: `pnpm lint` fails the build if two migration files in
   `apps/api/src/migrations/` share a timestamp. The guard also verifies
   that every filename's leading timestamp matches the class's trailing
   timestamp, catching half-renames.
   
   **Recovery (for environments affected by the #374 collision)**:
   ... step-by-step SQL + migration:run instructions ...
   ```

2. A new top-level **Uniqueness invariant** subsection under **Migration Naming Convention** (around line 50), stating that (a) timestamps must be strictly unique, (b) filename prefix and class suffix must match, (c) `pnpm lint` enforces both.

## 4. Changes

### Step 1 — Rename `AddCurrencyToProducts`

- **Rename file** `apps/api/src/migrations/1790000000000-AddCurrencyToProducts.ts` → `apps/api/src/migrations/1790000000002-add-currency-to-products.ts`.
- **Edit class declaration** — update trailing timestamp on the class name (`1790000000000` → `1790000000002`).
- **Prepend orphan-row DELETE** to `up()`.
- **Change `ALTER TABLE ... ADD COLUMN`** to `ADD COLUMN IF NOT EXISTS`.
- **Update file header JSDoc** (if any) to note the renamed class / reason.

### Step 2 — Rename `RenameMarketplaceCapability`

- **Rename file** `apps/api/src/migrations/1788000000000-rename-marketplace-capability.ts` → `apps/api/src/migrations/1788000000001-rename-marketplace-capability.ts`.
- **Edit class declaration** — update trailing timestamp (`1788000000000` → `1788000000001`).
- **Prepend orphan-row DELETE** to `up()`. No DDL to make idempotent; the body is already safe to re-run.

### Step 3 — New guard script

- **Create** `scripts/check-migration-timestamps.mjs` — ~60 LOC Node ESM. Reads `apps/api/src/migrations/`, parses filename + class timestamps, enforces the three invariants, exits non-zero with a clear message on any violation.

### Step 4 — Wire into `check:invariants`

- **Edit** root `package.json` — append `&& node scripts/check-migration-timestamps.mjs` to the `check:invariants` command.

### Step 5 — Update `docs/migrations.md`

- **Edit** — add the **Duplicate migration timestamp** troubleshooting entry (with recovery SQL) and the **Uniqueness invariant** subsection under naming conventions.

## 5. Validation

- **Dependency rules:** no layer violations — this is a migrations + DX-scripts patch. No domain / application / infrastructure code touched.
- **TypeORM semantics:**
  - Glob discovery is unchanged; the renamed files are picked up under their new timestamps.
  - Orphan-row DELETE inside a migration `up()` is legal — TypeORM wraps `up()` in a transaction on Postgres, so DELETE + DDL are atomic.
  - `ADD COLUMN IF NOT EXISTS` is Postgres 9.6+; OpenLinker runs 16.
- **Idempotency matrix:** all four environment states (A/B/C/D from §2) converge to a consistent end state after the renamed migration runs — confirmed by case analysis above.
- **Guard correctness:**
  - Passes on the post-rename tree (manual run before commit).
  - Fails when a deliberately colliding file is added to `apps/api/src/migrations/` (manual sensitivity check documented in the PR description, file deleted before push).
  - Fails on a filename-vs-class-timestamp mismatch (same sensitivity check).
- **No new dependencies.** The guard uses only `node:fs` and `node:path`.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test` must pass. `pnpm test:integration` is not run in this loop (requires Docker); validated via the test harness's existing `runMigrations()` call during the next integration run.
- **Security:** no secrets, no data exposure. The orphan-row DELETE references hard-coded class names (the old names we just retired), not user input.

## 6. Risks / open questions

- **State A environments (`migrations` row exists, column exists) — what happens if someone has a snapshot predating the fix?** Covered by the orphan-row DELETE + `IF NOT EXISTS`. Verified by case analysis.
- **`RenameMarketplaceCapability` on rare State D (body ran, no row)** — re-running the UPDATE clauses is a no-op on idempotent predicates. Safe.
- **What if a future dev runs `migration:revert` on the renamed migration?** `down()` hasn't changed — they get the original rollback behaviour. One edge case: after a `revert`, TypeORM deletes the new class row from `migrations`, but the orphan-row DELETE from the original `up()` already ran — so the rollback target is clean (no row). That's correct.
- **Timestamps could still drift in the future via copy-paste between branches not yet merged.** The guard catches this on every `pnpm lint` run — in particular, pre-commit. Can't prevent a truly concurrent merge window, but the post-merge CI run on `main` will turn red quickly if it ever happens.
- **No new migration, no follow-up issue required.** The follow-up from the issue (the guard) is part of this PR's scope, not a tracking item.
