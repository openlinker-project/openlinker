# Implementation Plan: Fix Migration CLI silently skipping .env.local (dotenv dependency + path)

**Issue**: #868  
**Date**: 2026-06-10  
**Status**: Ready for Review  
**Estimated Effort**: 1–2 hours

---

## 1. Task Summary

**Objective**: Fix TypeORM migration CLI commands (`migration:run`, `migration:show`, `migration:revert`, `migration:generate`) silently failing to load `apps/api/.env.local`, causing connections to fall back to hardcoded defaults instead of local overrides.

**Context**: `apps/api/src/database/data-source.ts` loads env vars via `require('dotenv')` inside a try/catch. Under pnpm 11's strict dependency resolution, `dotenv` is no longer accessible as a hoisted transitive dep — `require('dotenv')` throws `Cannot find module 'dotenv'`, which the empty catch block silently swallows. Additionally, the resolved `.env.local` path contains one extra `../` segment, pointing to `apps/.env.local` (non-existent) instead of `apps/api/.env.local`.

**Classification**: Infrastructure — DX / build tooling fix in `apps/api/`.

---

## 2. Scope & Non-Goals

### In Scope
- Add `dotenv` as a direct `devDependency` in `apps/api/package.json`.
- Fix the `.env.local` and `.env` resolution paths in `data-source.ts` (one too many `../` levels).
- Replace the silent empty catch with a `console.warn` so failures are visible.
- Add a new lesson to `docs/lessons.md` to prevent recurrence.
- Update `docs/migrations.md` to remove the "optional — install if needed" caveat (dotenv is now a declared dep).

### Out of Scope
- Changes to `libs/core/`, integration packages, or the NestJS runtime.
- Adding dotenv to `apps/worker` or root — those contexts have their own env loading.
- Any change to `DatabaseModule` or `@openlinker/shared/database` (NestJS runtime uses `ConfigService`, not dotenv directly).
- Migrations or schema changes.

### Constraints
- `data-source.ts` runs in a CommonJS TypeORM CLI context — `import` syntax is not available for dynamic loading; `require()` is mandatory here (existing ESLint disable comments already document this).
- The shared `Logger` from `@openlinker/shared/logging` is **not** available in this CLI context (no NestJS DI). `console.warn` is the correct tool; it must carry an inline ESLint disable comment following the project pattern.
- `dotenv` must be a `devDependency`, not `dependencies`: the `.env.local` loading is a local-dev convenience only; production migrations receive env vars from the container/runtime and already work without dotenv.

---

## 3. Architecture Mapping

**Target Layer**: `apps/api/` — standalone TypeORM CLI DataSource file; no domain or core layer involvement.

**Capabilities Involved**: None — this is a DX/tooling fix.

**Existing Services Reused**: N/A.

**New Components Required**: None.

**Core vs Integration Justification**: Fix is entirely within `apps/api/src/database/data-source.ts` and `apps/api/package.json`. CORE, integrations, and the NestJS runtime are untouched. The DataSource file is a standalone bootstrap artifact for the TypeORM CLI, explicitly separated from the NestJS module graph.

---

## 4. External / Domain Research

### Internal Patterns

**`data-source.ts` today (lines 24–38)**:
```typescript
try {
  const { config } = require('dotenv') as { ... };
  const { resolve } = require('path') as { ... };
  config({ path: resolve(__dirname, '../../../.env.local') });  // ← BUG: resolves to apps/.env.local
  config({ path: resolve(__dirname, '../../../.env') });        // ← BUG: resolves to apps/.env
} catch {
  // dotenv not available - rely on environment variables being set  ← silent failure
}
```

**Path analysis** (ts-node: `__dirname` = `apps/api/src/database`):
| Expression | Resolves to | Correct? |
|---|---|---|
| `resolve(__dirname, '../../.env.local')` | `apps/api/.env.local` | ✅ |
| `resolve(__dirname, '../../../.env.local')` | `apps/.env.local` (current code) | ❌ |

`apps/api/.env.local` exists (confirmed). `apps/.env.local` does not.

**dotenv in the codebase**: `dotenv` is not listed anywhere in any `package.json` across the monorepo. It was available only as a transitive hoisted dep under pnpm 10.

**ESLint `no-console` convention**: the project uses inline `// eslint-disable-next-line no-console -- <reason>` comments with a specific reason appended after `--`. This is the required format based on engineering standards (`no-console without a specific reason in the same comment`).

**dotenv behaviour**: `config({ path })` does **not** throw when the target file doesn't exist — it returns `{ error: Error }`. The try/catch is only needed to guard the `require('dotenv')` call itself; once dotenv is a direct dep, a throw from `require` cannot occur. The catch is kept as a defensive guard but must now log rather than silently continue.

**docs/migrations.md note**: line 130–134 says dotenv is "optional — install if needed". This is now outdated and should be updated.

---

## 5. Questions & Assumptions

### Open Questions
- None. The root causes are fully confirmed: missing direct dep + wrong path.

### Assumptions
1. `dotenv` `^16.0.0` (current stable major) is compatible with Node.js LTS 18+. ✅ Confirmed by dotenv docs.
2. `pnpm install` is re-run by the developer after the `package.json` change (standard pnpm workflow). The pre-commit hook runs `pnpm test`, which does not require a clean DB, so no additional CI step is needed.
3. Production environments set DB env vars via container/runtime and do not rely on the `.env.local` dotenv loading. The `devDependencies` placement ensures dotenv is not bundled in production containers that skip dev deps. ✅ Consistent with current code comment.

### Documentation Gaps
- `docs/migrations.md` §Prerequisites currently says dotenv is optional. This created the impression that missing dotenv is an acceptable state, contributing to the silent-failure design.

---

## 6. Proposed Implementation Plan

### Phase 1 — Dependency & path fix (the code changes)

**Goal**: Make `require('dotenv')` resolve correctly under pnpm 11 and load `apps/api/.env.local` via the correct path.

**Steps**:

1. **Add `dotenv` to `apps/api/package.json` devDependencies**
   - **File**: `apps/api/package.json`
   - **Action**: Add `"dotenv": "^16.0.0"` to the `devDependencies` section, keeping the keys in alphabetical order (after `eslint-config-prettier`, before `jest`).
   - **Acceptance**: `pnpm --filter @openlinker/api exec -- node -e "require('dotenv')"` exits 0.
   - **Dependencies**: none.

2. **Fix `.env` file paths in data-source.ts**
   - **File**: `apps/api/src/database/data-source.ts`
   - **Action**: Change both `'../../../'` path segments to `'../../'`:
     ```typescript
     // Before (wrong — resolves to apps/.env.local, which doesn't exist):
     config({ path: resolve(__dirname, '../../../.env.local') });
     config({ path: resolve(__dirname, '../../../.env') });
     
     // After (correct — resolves to apps/api/.env.local):
     config({ path: resolve(__dirname, '../../.env.local') });
     config({ path: resolve(__dirname, '../../.env') });
     ```
   - **Acceptance**: When `DB_PORT=5555` is set in `apps/api/.env.local` and migration commands are run, the port used is 5555 not 5432.
   - **Dependencies**: Step 1 (dotenv installed).

3. **Replace silent catch with a `console.warn`**
   - **File**: `apps/api/src/database/data-source.ts`
   - **Action**: Replace the empty catch block with a visible warning. The catch now handles any unexpected error from the `require('dotenv')` or `config()` calls:
     ```typescript
     } catch (error) {
       // eslint-disable-next-line no-console -- TypeORM CLI context: Logger not available outside NestJS DI
       console.warn(
         '[data-source] Failed to load dotenv; migration commands will rely on environment variables set externally.',
         error,
       );
     }
     ```
   - **Acceptance**: If dotenv were somehow unavailable, a warning is printed to stderr rather than the failure being invisible.
   - **Dependencies**: none.

### Phase 2 — Install the new dependency

**Goal**: Update the lock file so the CI/CD and teammates get `dotenv` automatically.

**Steps**:

4. **Run `pnpm install`**
   - **Action**: Run `pnpm install` from the project root to regenerate `pnpm-lock.yaml` with `dotenv` pinned under `apps/api`.
   - **Acceptance**: `pnpm-lock.yaml` contains a `dotenv` entry; `node_modules/dotenv` is present under `apps/api/node_modules/` or root hoisted position.
   - **Dependencies**: Steps 1–3.

### Phase 3 — Documentation updates

**Goal**: Fix the outdated "dotenv is optional" language in `docs/migrations.md` and record the root cause in `docs/lessons.md`.

**Steps**:

5. **Update `docs/migrations.md` §Prerequisites**
   - **File**: `docs/migrations.md`
   - **Action**: Remove the "optional — `pnpm add -D dotenv`" note at lines 130–134. Replace with a single line: "`dotenv` is a declared `devDependency` in `apps/api` — no manual install step needed."
   - **Acceptance**: The docs no longer suggest dotenv is optional.
   - **Dependencies**: Step 1.

6. **Add lesson to `docs/lessons.md`**
   - **File**: `docs/lessons.md`
   - **Action**: Append the following entry following the existing format:

     ```markdown
     ## Declare dotenv as a direct devDependency in apps/api; never rely on hoisting for CLI tooling

     **Context**: TypeORM migration CLI commands (`migration:run`, `migration:show`, `migration:revert`) depend on `apps/api/src/database/data-source.ts`, a standalone CommonJS file that must bootstrap env vars via `require('dotenv')` before NestJS DI is available.
     **Problem**: `dotenv` was only reachable as a hoisted transitive dep under pnpm 10. pnpm 11 strict resolution blocks hoisted-but-undeclared packages; `require('dotenv')` threw `Cannot find module 'dotenv'`, silently swallowed by the empty catch block, so all migration commands fell back to hardcoded defaults (e.g., `DB_PORT=5432`) and connected to the wrong DB. Additionally, the path had one extra `../` segment (`'../../../.env.local'` resolved to `apps/.env.local` instead of `apps/api/.env.local`).
     **Rule**: Any `require()` call in a standalone CLI bootstrap file must reference a package declared as a direct dependency in the same `package.json`. Never rely on hoisting for CLI tooling. Catch blocks in bootstrap files must log, not silently continue.
     **Applies to**: `apps/api/src/database/data-source.ts`; any future standalone TypeORM or CLI tooling file in `apps/api/`.
     **Source**: PR for issue #868.
     ```

   - **Acceptance**: `docs/lessons.md` contains the new entry.
   - **Dependencies**: none.

### Implementation Details

**No new components.** Changes are limited to:
- `apps/api/package.json` — `devDependencies` addition
- `apps/api/src/database/data-source.ts` — path fix + catch block
- `pnpm-lock.yaml` — lock file update
- `docs/migrations.md` — prerequisite text update
- `docs/lessons.md` — new lesson entry

**No migrations** needed.  
**No events** involved.  
**No new types or interfaces**.

---

## 7. Alternatives Considered

### Alternative 1: Keep dotenv truly optional, require explicit env var export before running migrations

- **Description**: Document that developers must `export DB_HOST=... DB_PORT=... ...` before running migration commands. Remove the dotenv loading from `data-source.ts` entirely.
- **Why Rejected**: Increases friction for local development. The existing `.env.local` loading pattern already exists and is the documented developer workflow. Ripping it out would be a step backwards.
- **Trade-offs**: No added dependency; simpler `data-source.ts`. But increases toil for every migration run in development.

### Alternative 2: Load env vars in the npm script via `dotenv-cli` rather than in `data-source.ts`

- **Description**: Replace the in-file dotenv loading with `dotenv -e apps/api/.env.local --` as a prefix in the migration scripts in `apps/api/package.json`.
- **Why Rejected**: Requires adding `dotenv-cli` (a separate package from `dotenv`), changes the invocation signature, and would not be picked up by the TypeORM CLI when invoked directly (`node_modules/.bin/typeorm migration:...`). The in-file approach is consistent with how the file has always worked.
- **Trade-offs**: Script-level env injection is a common pattern; it would avoid the CommonJS `require()` eslint disables. Not worth the disruption given the surgical nature of the fix.

### Alternative 3: Use `dependencies` instead of `devDependencies` for dotenv

- **Description**: Add dotenv to `dependencies` so it is available in production containers regardless of `--prod` install flags.
- **Why Rejected**: Production migrations use compiled JS with env vars injected by the container/runtime; the dotenv call is a local dev convenience. `docs/migrations.md` already documents using `-D`. Adding it to `dependencies` would unnecessarily bloat the production image.
- **Trade-offs**: Marginally simpler mental model; negligible size penalty. The separation between `devDependencies` and `dependencies` is semantically important in this codebase.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No domain, core, or integration packages are touched.
- ✅ CORE ↔ Integration boundary is unchanged.
- ✅ No NestJS DI changes.

### Naming Conventions
- ✅ No new files; no naming decisions required.

### Existing Patterns
- ✅ `console.warn` with an inline `eslint-disable-next-line no-console -- <reason>` comment follows the established project pattern for the existing eslint disables in the same file.
- ✅ `devDependencies` placement is consistent with `docs/migrations.md` recommendation (`pnpm add -D dotenv`).

### Risks

- **Lock file conflicts**: `pnpm-lock.yaml` is high-traffic. Risk: low — dotenv is a leaf package with minimal transitive deps. Mitigation: rebase onto `main` before merging.
- **dotenv `^16` breaking changes in the future**: Risk: negligible — dotenv 16.x is the current stable and semver-pinned. Mitigation: pin to `^16.0.0` which allows patch updates only within the major.

### Edge Cases

- **`.env.local` does not exist** (e.g., fresh clone before setup): `config()` returns `{ error }` — it does **not** throw. Migration commands proceed using env vars set externally or fall back to hardcoded defaults. No regression vs. current behaviour.
- **`.env.local` exists but has a syntax error**: `config()` returns `{ error }` — again does not throw. Migration commands see whatever env vars were already set. A follow-up improvement (out of scope) could log `result.error` for better diagnostics.
- **Both `.env.local` and `.env` present**: `dotenv.config()` does not override already-set env vars (the `override: false` default), so `.env.local` loaded first wins, matching NestJS `ConfigModule` priority behaviour.
- **Running migrations via compiled JS (production CI)**: `__dirname` in compiled output is `dist/apps/api/src/database`. `'../../.env.local'` from there resolves to `dist/apps/api/.env.local` (doesn't exist). `config()` returns silently. Production env vars come from the container — no regression.

### Backward Compatibility
- ✅ No public API, event schema, or ORM entity changes.
- ✅ `pnpm-lock.yaml` update is additive only.
- ✅ Developers who already have `dotenv` manually installed in their local `node_modules` (e.g., from a previous explicit install) are unaffected — pnpm resolves to the declared version.

---

## 9. Testing Strategy & Acceptance Criteria

### Manual Verification (primary test for a DX fix)

There is no unit-testable logic to add — this is a package declaration + a path string fix. The definitive test is:

1. Ensure `apps/api/.env.local` exists with a non-default `DB_PORT`, e.g. `DB_PORT=15432`.
2. Run `pnpm --filter @openlinker/api migration:show`.
3. Observe the connection attempt targets port `15432` (visible in the TypeORM connection log or the error message if the DB is not running on that port).
4. Confirm no silent fallback to `5432`.

### Unit Tests

No new unit tests are needed or appropriate:
- `data-source.ts` is a side-effectful bootstrap file (not a class/service) — it cannot be meaningfully unit-tested in isolation.
- The fix is a path string correction and a dependency declaration, both verifiable via the manual test above.

### Integration Tests

No integration test changes are needed. The migration integration tests (`pnpm test:integration`) do not exercise `data-source.ts` — they use Testcontainers-provided env vars injected directly.

### Quality Gate Verification

After the code changes, run the standard quality gate:
```bash
pnpm lint        # must pass (no new eslint errors from console.warn disable comment)
pnpm type-check  # must pass (path string change is not type-checked)
pnpm test        # must pass (no unit test changes)
```

### Acceptance Criteria

- [ ] `dotenv` is listed as a `devDependency` in `apps/api/package.json`.
- [ ] `pnpm --filter @openlinker/api migration:show` correctly connects using `DB_PORT` (and other DB vars) from `apps/api/.env.local`.
- [ ] Changing `DB_PORT` in `apps/api/.env.local` is reflected in migration commands without any other env changes.
- [ ] A `console.warn` (not a silent catch) is emitted if the try block throws unexpectedly.
- [ ] `pnpm lint` passes with zero errors.
- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm test` passes (all unit tests green).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — no domain or core changes
- [x] Respects CORE vs Integration boundaries — fix is in `apps/api/` only
- [x] Uses existing patterns — `require()` with inline ESLint disables already present in the same file
- [x] Idempotency considered — `dotenv.config()` does not override already-set vars; safe to call multiple times
- [x] Event-driven patterns — N/A for a DX fix
- [x] Rate limits & retries — N/A
- [x] Error handling — catch block now logs instead of silently swallowing
- [x] Testing strategy complete — manual verification + quality gate documented
- [x] Naming conventions followed — no new files
- [x] File structure matches standards — no new files
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Database Migrations Guide](../migrations.md)
- [Testing Guide](../testing-guide.md)
