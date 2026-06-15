# Implementation Plan: pnpm 11 Compatibility

**Date**: 2026-06-10
**Status**: Ready for Review
**Estimated Effort**: 2–3 hours
**Issue**: #867

---

## 1. Task Summary

**Objective**: Fix all build and startup failures introduced by upgrading to pnpm 11, which enforces strict dependency resolution and removes implicit transitive module hoisting.

**Context**: pnpm 11 requires every package to declare the deps it imports directly. Previously, packages silently relied on transitive hoisting from parent `node_modules`. Five distinct failure modes were identified and documented in `docs/pnpm11-migration-issues-report.md`.

**Classification**: Infrastructure / DX

---

## 2. Scope & Non-Goals

### In Scope
- `apps/worker/package.json` — add missing direct deps (`@openlinker/integrations-ai`, `@openlinker/integrations-allegro`, `@openlinker/integrations-inpost`)
- `libs/core/package.json` — add missing peer deps (`@nestjs/config`, `redis`)
- `libs/integrations/ai/package.json` — add missing peer dep (`@nestjs/config`)
- `libs/integrations/allegro/package.json` — add missing peer deps (`@nestjs/config`, `@nestjs/typeorm`, `redis`, `typeorm`)
- `apps/api/package.json` — add pinned `cron: "3.1.3"` direct dep

### Out of Scope
- Upgrading or downgrading any existing package versions beyond the targeted pins
- Changing `apps/worker/tsconfig.json` (dev-mode tsconfig — `ts-node` already handles `libs/*/src` correctly)
- Changing `apps/worker/tsconfig.build.json` or `apps/api/tsconfig.build.json` — both already use `libs/*/src` aliases consistently; the TS2307 failures are caused by missing `package.json` deps, not by the alias pattern
- Any logic or business-feature changes

### Constraints
- pnpm 11 is the target; pnpm 10 backward compatibility is not a hard requirement
- `cron` must be pinned to `3.1.3` because `@nestjs/schedule@4.0.0` references that exact patch version in its typings
- The sub-issue 1 DI crash (TypeORM `DataSource` token identity across mixed `node_modules` roots) is environment-specific and self-resolves on a clean `pnpm install` from the workspace root — no code change required

---

## 3. Architecture Mapping

**Target Layer**: Infrastructure / App (build tooling and package manifests only — no domain or application code changes)

**Capabilities Involved**: None (manifest and tsconfig changes only)

**Existing Services Reused**: N/A

**New Components Required**: None

**Core vs Integration Justification**: Not applicable — this is pure dependency hygiene with no cross-context contract changes.

---

## 4. External / Domain Research

### Internal Patterns

**`peerDependencies` vs `dependencies` in workspace libs**:
- Packages consumed by NestJS host apps at runtime should declare NestJS-ecosystem deps (`@nestjs/common`, `@nestjs/config`, `@nestjs/typeorm`) as `peerDependencies`. The host app satisfies the peer.
- Non-NestJS runtime deps that a lib **directly imports** and whose resolution must be deterministic within the lib's own `node_modules` subtree (e.g. `redis`, `typeorm`) may be declared either as `peerDependencies` (preferred for singletons like TypeORM `DataSource`) or `dependencies`. Singletons that must be **exactly one instance** across the DI graph should be peers so the host app controls resolution.
- `@nestjs/config` is NestJS-ecosystem → `peerDependencies`.
- `redis` and `typeorm` are singleton-shaped → `peerDependencies`.

**`tsconfig.build.json` `libs/*/src` aliases — established norm for both apps**:
- Both `apps/api/tsconfig.build.json` and `apps/worker/tsconfig.build.json` map `@openlinker/*` aliases to `libs/*/src`. This is the current and consistent pattern across the monorepo.
- The `apps/api` build works because it declares all integration packages as direct deps. The `apps/worker` build fails for the same reason its api counterpart would fail if it dropped those deps — not because of the `src` alias pattern itself.
- Switching `apps/worker/tsconfig.build.json` to `libs/*/dist` without doing the same for `apps/api` would create an inconsistency. A future `src → dist` migration for both apps is a separate improvement unrelated to closing #867.

**`cron` and `@nestjs/schedule`**:
- `@nestjs/schedule@4.0.0` internally uses `CronJob` from `cron` and re-exports its types. If `cron` is not a direct dep of `apps/api`, pnpm 11 does not hoist it, making the `CronJob` import fail with TS2307.
- `@nestjs/schedule@4.0.0` was built against `cron@3.1.3`; pinning to that exact version avoids nominal type incompatibilities on `schedulerRegistry.addCronJob()`.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking implementation.

### Assumptions
1. `libs/integrations/allegro` imports `typeorm` decorators directly (confirmed: `allegro-quantity-command.orm-entity.ts` imports from `typeorm`), so `typeorm` and `@nestjs/typeorm` should be added as `peerDependencies` to keep the singleton constraint.
2. `libs/integrations/allegro` imports `RedisClientType` directly (confirmed: `allegro-token-refresh.service.ts`), so `redis` should be added as a `peerDependency`.
3. `libs/core` imports `@nestjs/config` and `redis` directly (confirmed across `ai`, `integrations`, `listings`, `sync`, `events`, `shipping` sub-contexts), so both need to be added as `peerDependencies`.
4. `libs/integrations/ai` imports `@nestjs/config` directly (confirmed: `ai-integration.module.ts`, `vercel-ai-completion.adapter.ts`), so it needs `@nestjs/config` as a `peerDependency`.
5. The sub-issue 1 DI crash is purely environmental; clean reinstall from repo root resolves it. No manifest or code change is needed.
6. Version constraints for new peer entries should mirror what `apps/api` already declares: `@nestjs/config@^3.0.0`, `redis@^4.0.0`, `@nestjs/typeorm@^10.0.0`, `typeorm@^0.3.0`.

### Documentation Gaps
- None.

---

## 6. Proposed Implementation Plan

### Phase 1: Worker package.json — add missing direct deps

**Goal**: Let pnpm 11 resolve `@openlinker/integrations-ai`, `@openlinker/integrations-allegro`, and `@openlinker/integrations-inpost` for the worker.

**Steps**:

1. **Add missing workspace deps to `apps/worker/package.json`**
   - **File**: `apps/worker/package.json`
   - **Action**: Add to `dependencies`:
     ```json
     "@openlinker/integrations-ai": "workspace:*",
     "@openlinker/integrations-allegro": "workspace:*",
     "@openlinker/integrations-inpost": "workspace:*"
     ```
   - **Rationale**: `apps/worker/src/plugins.ts` imports all four integration modules (`prestashop` — already declared; `allegro`, `ai`, `inpost` — all three missing). Once these packages are listed as direct deps, tsc resolves them through node_modules using each package's own `exports` — no `tsconfig.build.json` alias changes are needed. Both `apps/worker/tsconfig.build.json` and `apps/api/tsconfig.build.json` use `libs/*/src` aliases; that is the established pattern for both apps and is unchanged.
   - **Acceptance**: `pnpm --filter @openlinker/worker build` no longer reports TS2307 for these three packages.
   - **Dependencies**: None.

---

### Phase 2: Library dependency hygiene

**Goal**: Each lib declares every package it imports directly, eliminating reliance on transitive hoisting.

**Steps**:

2. **`libs/core/package.json` — add `@nestjs/config` and `redis` to `peerDependencies`**
   - **File**: `libs/core/package.json`
   - **Action**: Add to `peerDependencies`:
     ```json
     "@nestjs/config": "^3.0.0",
     "redis": "^4.0.0"
     ```
   - **Acceptance**: `tsc --noEmit` inside `libs/core` passes; no TS2307 for `@nestjs/config` or `redis`.
   - **Dependencies**: None.

3. **`libs/integrations/ai/package.json` — add `@nestjs/config` to `peerDependencies`**
   - **File**: `libs/integrations/ai/package.json`
   - **Action**: Add to `peerDependencies`:
     ```json
     "@nestjs/config": "^3.0.0"
     ```
   - **Acceptance**: `tsc --noEmit` inside `libs/integrations/ai` passes.
   - **Dependencies**: None.

4. **`libs/integrations/allegro/package.json` — add `@nestjs/config`, `@nestjs/typeorm`, `redis`, `typeorm` to `peerDependencies`**
   - **File**: `libs/integrations/allegro/package.json`
   - **Action**: Add to `peerDependencies`:
     ```json
     "@nestjs/config": "^3.0.0",
     "@nestjs/typeorm": "^10.0.0",
     "redis": "^4.0.0",
     "typeorm": "^0.3.0"
     ```
   - **Acceptance**: `tsc --noEmit` inside `libs/integrations/allegro` passes; no TS2307 for any of these four packages.
   - **Dependencies**: None.

---

### Phase 3: API `cron` direct dep

**Goal**: Give `apps/api` a direct, correctly-versioned `cron` dep so `@nestjs/schedule`'s `CronJob` type resolves cleanly.

**Steps**:

5. **`apps/api/package.json` — add pinned `cron` dep**
   - **File**: `apps/api/package.json`
   - **Action**: Add to `dependencies`:
     ```json
     "cron": "3.1.3"
     ```
     *(exact pin, not `^`, because `@nestjs/schedule@4.0.0` typings reference `cron@3.1.3` exactly)*
   - **Acceptance**: `pnpm --filter @openlinker/api build` succeeds; no TS2307 for `cron` and no type error on `schedulerRegistry.addCronJob(...)`.
   - **Dependencies**: None.

---

### Phase 4: Clean reinstall and end-to-end verification

**Goal**: Confirm all five failure modes are resolved together.

**Steps**:

6. **Run `pnpm install` from workspace root**
   - **Action**: `pnpm install` — resolves the new declared deps and eliminates any leftover parent-level `node_modules` shadowing (sub-issue 1 fix).
   - **Acceptance**: `pnpm install` exits with code 0.

7. **Build all packages**
   - **Action**: `pnpm build` (builds libs first, then apps).
   - **Acceptance**: Zero TS2307 or TS2345 errors across `libs/core`, `libs/integrations/ai`, `libs/integrations/allegro`, `apps/worker`, `apps/api`.

8. **Run quality gate**
   - **Action**: `pnpm lint && pnpm type-check && pnpm test`
   - **Acceptance**: Zero lint errors, zero type errors, all unit tests pass.

---

### Implementation Details

**Configuration Changes**:
- `apps/worker/package.json`: +3 workspace deps (`integrations-ai`, `integrations-allegro`, `integrations-inpost`)
- `libs/core/package.json`: +2 peerDeps
- `libs/integrations/ai/package.json`: +1 peerDep
- `libs/integrations/allegro/package.json`: +4 peerDeps
- `apps/api/package.json`: +1 pinned dep

**Database Migrations**: None.

**Events**: None.

**Error Handling**: Not applicable.

---

## 7. Alternatives Considered

### Alternative 1: Move missing deps to `dependencies` instead of `peerDependencies`

- **Description**: Declare `@nestjs/config`, `typeorm`, `redis`, etc. as regular `dependencies` in each lib, so pnpm resolves them into each lib's own `node_modules`.
- **Why Rejected**: NestJS module singletons (especially TypeORM's `DataSource`) must have a single resolved instance across the whole DI graph. If each package brings its own copy, the `DataSource` token identity diverges — exactly the DI crash described in sub-issue 1. `peerDependencies` forces the host app to own and resolve one instance.
- **Trade-offs**: `dependencies` would be simpler to declare and would auto-install, but it reintroduces the exact singleton-identity risk that triggered sub-issue 1.

### Alternative 2: Patch `apps/worker/tsconfig.build.json` to add `paths` for missing imports instead of fixing package.json

- **Description**: Add more `paths` entries in the build tsconfig so tsc can find every transitively-required package through source aliases rather than installed `node_modules`.
- **Why Rejected**: This is a workaround, not a fix. It grows unboundedly as new transitive deps are introduced, gives no runtime guarantee, and diverges from how `apps/api/tsconfig.build.json` is structured. Fixing package.json is the principled solution.

### Alternative 3: Use `pnpm-workspace` overrides to hoist specific packages

- **Description**: Add `hoistPattern` or `shamefullyHoist: true` to `.npmrc` / `pnpm-workspace.yaml` to restore pnpm 10-style hoisting.
- **Why Rejected**: Hides the underlying dep hygiene issues and opts out of the strictness pnpm 11 is designed to provide. The upgrade's whole point is to surface hidden implicit deps; reintroducing hoisting defeats that goal.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No domain or application code changes — purely manifest and tsconfig hygiene.
- ✅ peerDependencies choice preserves singleton identity for TypeORM `DataSource` and `RedisClientType`.

### Naming Conventions
- ✅ Not applicable (no TypeScript files created or renamed).

### Existing Patterns
- ✅ Both `apps/api/tsconfig.build.json` and `apps/worker/tsconfig.build.json` use `libs/*/src` aliases — the plan keeps them consistent by not changing either.
- ✅ `peerDependencies` for NestJS-ecosystem packages is the pattern already used by `libs/core`, `libs/integrations/ai`, and `libs/integrations/allegro` for `@nestjs/common`.

### Risks

- **`cron@3.1.3` exact pin**: Pinning an exact version is an intentional trade-off. If `cron` issues a security patch at `3.1.4`, the pin must be manually updated. **Mitigation**: `@nestjs/schedule` is the constraint owner; when it bumps its expected `cron` version, the pin here follows. This is documented in the step.

### Edge Cases

- **Sub-issue 1 (DI crash) reproduces if parent `node_modules` exists**: The plan's clean `pnpm install` from workspace root should eliminate the shadowing. If a CI environment pre-caches a mismatched parent `node_modules`, the crash can recur. **Mitigation**: Ensure CI cache keys are scoped to the workspace root's `pnpm-lock.yaml` and that no parent-directory install runs before the workspace install.

### Backward Compatibility
- ✅ peerDependencies additions are non-breaking — existing callers already satisfy them through their own `dependencies` declarations.
- ✅ No tsconfig changes — both apps keep the established `libs/*/src` alias pattern.
- ✅ `apps/worker/tsconfig.json` (dev mode) is unchanged.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- No new unit tests required — this is manifest/tsconfig hygiene.
- Existing unit tests (`pnpm test`) must continue to pass — serve as a regression guard.

### Integration Tests
- Not required for this change.

### Mocking Strategy
- Not applicable.

### Acceptance Criteria
- [ ] `pnpm install` exits with code 0 from workspace root with pnpm 11
- [ ] `pnpm build` (all packages) completes with zero errors
- [ ] `pnpm --filter @openlinker/worker build` produces zero TS2307 errors
- [ ] `pnpm --filter @openlinker/api build` produces zero TS2307 and zero `CronJob` type errors
- [ ] `pnpm start:dev:api` bootstraps without DI errors for Allegro TypeORM repositories
- [ ] `pnpm lint && pnpm type-check && pnpm test` all pass

**Reference**: [Testing Guide](./testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (no architectural changes)
- [x] Respects CORE vs Integration boundaries (no boundary changes)
- [x] Uses existing patterns (peerDeps pattern; `libs/*/src` aliases kept consistent across both apps)
- [x] Idempotency considered (pnpm install is idempotent)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (N/A)
- [x] Testing strategy complete
- [x] Naming conventions followed (N/A — no new files)
- [x] File structure matches standards (N/A — no new files)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
- `docs/pnpm11-migration-issues-report.md` — original investigation report (referenced by issue #867)
