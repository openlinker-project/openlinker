# Implementation Plan: Fix Dockerfile — Missing Workspace package.json Manifests

**Issue**: #1093  
**Date**: 2026-06-17  
**Status**: Ready for Review  
**Estimated Effort**: 0.5 h

---

## 1. Task Summary

**Objective**: Fix `Dockerfile` so that `docker build .` and `docker compose up` succeed from a clean checkout.

**Context**: pnpm requires all workspace member `package.json` files to be present in the build context before it can resolve `workspace:*` links. The current Dockerfile copies only 3 of the 15 workspace member manifests, so `pnpm install` crashes in the base stage with an "unresolved workspace package" error before a single TypeScript file is compiled. The production stage has two additional defects: it omits `pnpm-lock.yaml` (making `pnpm install --prod` non-deterministic) and does not copy the compiled `dist/` outputs of the 9 integration packages, which would cause the API to crash at startup with `Cannot find module '@openlinker/integrations-*'`.

**Classification**: DX / Infrastructure (`Dockerfile` only)

---

## 2. Scope & Non-Goals

### In Scope
- Add the 12 missing `COPY package.json` lines to the **base** stage.
- Add the same 12 missing `COPY package.json` lines to the **production** stage.
- Add `COPY pnpm-lock.yaml ./` to the **production** stage (before `pnpm install --prod`).
- Add 9 `COPY --from=base … dist` lines to the **production** stage (plugin-sdk + 8 integration packages).

### Out of Scope
- Refactoring the overall Dockerfile structure (e.g., removing the redundant per-package `node_modules` copy logic).
- Adding a worker or web Docker target.
- Changing the pnpm install flags or Node version.
- Adding `.dockerignore` improvements.
- Any TypeScript, migration, or application-logic changes.

### Constraints
- Change is limited to `Dockerfile`. No other file changes.
- The fix must be minimal and targeted — no structural refactors.

---

## 3. Architecture Mapping

**Target Layer**: DX / Infrastructure (`Dockerfile`)

**Capabilities Involved**: None (no ports, no adapters, no services).

**Existing Services Reused**: The existing multi-stage build pattern (`AS base` → `AS production`) is unchanged.

**New Components Required**: None.

**Core vs Integration Justification**: Not applicable. This is a build-tooling fix with no architectural implications.

---

## 4. External / Domain Research

### pnpm Workspace Protocol
pnpm's `workspace:*` protocol requires the full workspace member graph to be resolvable at `pnpm install` time. This means every directory listed under `pnpm-workspace.yaml → packages` must have its `package.json` present **before** `pnpm install` runs, even if that package is not a direct dependency of the target app. pnpm reads all manifests to build the dependency graph.

**`pnpm-workspace.yaml` globs:**
```yaml
packages:
  - 'apps/*'
  - 'libs/*'
  - 'libs/integrations/*'
```

### Complete Workspace Member Inventory
Verified by inspecting the working tree. `apps/prestashop-module` and `libs/integrations/` (the directory itself) do **not** have a `package.json`, so they are not workspace members.

| Path | Has `package.json` | Copied in base stage | Copied in prod stage |
|---|---|---|---|
| `apps/api` | ✅ | ✅ | ✅ |
| `apps/worker` | ✅ | ❌ | ❌ |
| `apps/web` | ✅ | ❌ | ❌ |
| `libs/core` | ✅ | ✅ | ✅ |
| `libs/shared` | ✅ | ✅ | ✅ |
| `libs/plugin-sdk` | ✅ | ❌ | ❌ |
| `libs/test-kit` | ✅ | ❌ | ❌ |
| `libs/integrations/ai` | ✅ | ❌ | ❌ |
| `libs/integrations/allegro` | ✅ | ❌ | ❌ |
| `libs/integrations/dpd-polska` | ✅ | ❌ | ❌ |
| `libs/integrations/erli` | ✅ | ❌ | ❌ |
| `libs/integrations/inpost` | ✅ | ❌ | ❌ |
| `libs/integrations/prestashop` | ✅ | ❌ | ❌ |
| `libs/integrations/subiekt` | ✅ | ❌ | ❌ |
| `libs/integrations/woocommerce` | ✅ | ❌ | ❌ |

**Missing from Dockerfile**: 12 manifests in both stages.

### dist/ Packages Required in Production Image
Packages whose compiled output is imported at runtime by `apps/api`:

| Package | dist/ currently copied |
|---|---|
| `libs/plugin-sdk` | ❌ |
| `libs/integrations/ai` | ❌ |
| `libs/integrations/allegro` | ❌ |
| `libs/integrations/dpd-polska` | ❌ |
| `libs/integrations/erli` | ❌ |
| `libs/integrations/inpost` | ❌ |
| `libs/integrations/prestashop` | ❌ |
| `libs/integrations/subiekt` | ❌ |
| `libs/integrations/woocommerce` | ❌ |

`libs/test-kit` is a dev-only dependency (test infrastructure) and is not imported at runtime — no `dist/` copy needed. `apps/worker` and `apps/web` are not the Docker entrypoint — no `dist/` copy needed.

---

## 5. Questions & Assumptions

### Open Questions
- None. The fix is fully specified by the issue.

### Assumptions
1. **`libs/test-kit` does not require a `dist/` copy** in the production stage. It is a `devDependency` of `apps/api` used only by test files; `pnpm install --prod` will not install it as a production dependency. Its `package.json` is still needed in both stages because pnpm resolves the full workspace graph (including devDeps' transitive `workspace:*` links) during install.
2. **`apps/worker` and `apps/web` manifests** are needed for graph resolution but do not require `dist/` copies because the Docker entrypoint is `apps/api` only.
3. **The existing per-package `node_modules` copy logic** in the production stage (lines 49–51 in current Dockerfile) is intentionally left unchanged. Adding integration package `node_modules` copies is out of scope; the root `/app/node_modules` copy brings the pnpm virtual store which is sufficient for symlink resolution.
4. **`pnpm@9` version pin** in both stages is left unchanged.

### Documentation Gaps
- None relevant to this fix.

---

## 6. Proposed Implementation Plan

### Phase 1 — Fix `Dockerfile`

**Goal**: Apply all three targeted additions (manifests, lock file, integration dists) to `Dockerfile` in a single, reviewable edit.

**File**: `Dockerfile`

---

#### Step 1 — Add missing `package.json` COPY lines to the base stage

**Where**: After the existing three `COPY` lines for `apps/api`, `libs/core`, `libs/shared` (currently lines 13–15), before `RUN pnpm install` (line 19).

**What to add**:
```dockerfile
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/
COPY libs/test-kit/package.json ./libs/test-kit/
COPY libs/integrations/ai/package.json ./libs/integrations/ai/
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/
COPY libs/integrations/erli/package.json ./libs/integrations/erli/
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
```

**Acceptance**: `pnpm install` in the base stage completes without "unresolved workspace package" errors.

---

#### Step 2 — Add missing `package.json` COPY lines to the production stage

**Where**: After the existing three `COPY` lines for `apps/api`, `libs/core`, `libs/shared` (currently lines 34–36), before the `RUN npm install -g pnpm@9 …` line.

**What to add**: Same 12 lines as Step 1 (copy them verbatim).

**Acceptance**: `pnpm install --prod --ignore-scripts` in the production stage resolves the workspace graph without errors.

---

#### Step 3 — Add `pnpm-lock.yaml` COPY to the production stage

**Where**: After `COPY .npmrc ./` in the production stage (currently line 33), alongside the other root-level file copies.

**What to add**:
```dockerfile
COPY pnpm-lock.yaml ./
```

**Acceptance**: `pnpm install --prod` uses the lockfile, producing a deterministic install identical to the one in the base stage.

---

#### Step 4 — Copy `dist/` of integration packages from the base stage

**Where**: After the existing three `COPY --from=base … dist` lines (currently lines 45–47), before the `COPY --from=base /app/node_modules` line.

**What to add**:
```dockerfile
COPY --from=base /app/libs/plugin-sdk/dist ./libs/plugin-sdk/dist
COPY --from=base /app/libs/integrations/ai/dist ./libs/integrations/ai/dist
COPY --from=base /app/libs/integrations/allegro/dist ./libs/integrations/allegro/dist
COPY --from=base /app/libs/integrations/dpd-polska/dist ./libs/integrations/dpd-polska/dist
COPY --from=base /app/libs/integrations/erli/dist ./libs/integrations/erli/dist
COPY --from=base /app/libs/integrations/inpost/dist ./libs/integrations/inpost/dist
COPY --from=base /app/libs/integrations/prestashop/dist ./libs/integrations/prestashop/dist
COPY --from=base /app/libs/integrations/subiekt/dist ./libs/integrations/subiekt/dist
COPY --from=base /app/libs/integrations/woocommerce/dist ./libs/integrations/woocommerce/dist
```

**Acceptance**: The production image contains `libs/integrations/*/dist` and `libs/plugin-sdk/dist`. The NestJS app starts without `Cannot find module '@openlinker/integrations-*'` errors.

---

### Final Dockerfile (annotated diff)

The complete intended state of the affected sections after the fix:

```dockerfile
FROM node:20-alpine AS base

RUN npm install -g pnpm@9

WORKDIR /app

# Copy root manifest + config
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY pnpm-lock.yaml* ./

# Copy ALL workspace member manifests (pnpm needs the full graph to resolve workspace:* links)
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/          # ← added
COPY apps/web/package.json ./apps/web/                # ← added
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/  # ← added
COPY libs/test-kit/package.json ./libs/test-kit/      # ← added
COPY libs/integrations/ai/package.json ./libs/integrations/ai/               # ← added
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/     # ← added
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/ # ← added
COPY libs/integrations/erli/package.json ./libs/integrations/erli/           # ← added
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/       # ← added
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/ # ← added
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/     # ← added
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/ # ← added

RUN pnpm install

COPY . .

RUN pnpm build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy root manifest + config
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY pnpm-lock.yaml ./                                # ← added (deterministic prod install)

# Copy ALL workspace member manifests
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/          # ← added
COPY apps/web/package.json ./apps/web/                # ← added
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/  # ← added
COPY libs/test-kit/package.json ./libs/test-kit/      # ← added
COPY libs/integrations/ai/package.json ./libs/integrations/ai/               # ← added
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/     # ← added
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/ # ← added
COPY libs/integrations/erli/package.json ./libs/integrations/erli/           # ← added
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/       # ← added
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/ # ← added
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/     # ← added
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/ # ← added

RUN npm install -g pnpm@9 && \
    pnpm install --prod --ignore-scripts

# Copy built outputs from base
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/libs/core/dist ./libs/core/dist
COPY --from=base /app/libs/shared/dist ./libs/shared/dist
COPY --from=base /app/libs/plugin-sdk/dist ./libs/plugin-sdk/dist            # ← added
COPY --from=base /app/libs/integrations/ai/dist ./libs/integrations/ai/dist  # ← added
COPY --from=base /app/libs/integrations/allegro/dist ./libs/integrations/allegro/dist # ← added
COPY --from=base /app/libs/integrations/dpd-polska/dist ./libs/integrations/dpd-polska/dist # ← added
COPY --from=base /app/libs/integrations/erli/dist ./libs/integrations/erli/dist # ← added
COPY --from=base /app/libs/integrations/inpost/dist ./libs/integrations/inpost/dist # ← added
COPY --from=base /app/libs/integrations/prestashop/dist ./libs/integrations/prestashop/dist # ← added
COPY --from=base /app/libs/integrations/subiekt/dist ./libs/integrations/subiekt/dist # ← added
COPY --from=base /app/libs/integrations/woocommerce/dist ./libs/integrations/woocommerce/dist # ← added

# Copy node_modules (unchanged)
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base /app/libs/core/node_modules ./libs/core/node_modules
COPY --from=base /app/libs/shared/node_modules ./libs/shared/node_modules

EXPOSE 3000

CMD ["node", "apps/api/dist/apps/api/src/main.js"]
```

---

## 7. Alternatives Considered

### Alternative 1: `COPY . .` before `pnpm install` (copy everything first)
- **Description**: Replace all individual manifest `COPY` lines with a single `COPY . .` at the top, giving pnpm the full working tree including all `package.json` files.
- **Why Rejected**: Defeats Docker layer caching. Currently, the Dockerfile copies manifests first and runs `pnpm install`, so dependency layers are cached when only source code changes. A single `COPY . .` at the top would bust the install cache on every source change, making builds significantly slower in CI and locally.
- **Trade-offs**: Simpler Dockerfile, much slower iterative builds.

### Alternative 2: Use `--filter` to install only `apps/api` and its workspace deps
- **Description**: Run `pnpm install --filter @openlinker/api...` to install only the subset of packages `apps/api` transitively depends on, avoiding the need to list all workspace member manifests.
- **Why Rejected**: `--filter` still requires all workspace member manifests to parse the full workspace graph before filtering. The error surfaces at manifest-parsing time, not at install time. The fix would be the same (copy all manifests) with additional complexity.
- **Trade-offs**: No benefit over the targeted fix.

### Alternative 3: Restructure the production stage to avoid `pnpm install --prod`
- **Description**: Remove the `pnpm install --prod` step from the production stage entirely, relying solely on the `node_modules` copied from the base stage.
- **Why Rejected**: This would be a larger refactor of the production stage logic and is explicitly out of scope. The targeted fix is sufficient to unblock the build.
- **Trade-offs**: Potentially simpler final Dockerfile; deferred to a separate DX improvement issue.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal architecture implications — Dockerfile is build tooling.
- ✅ No CORE/Integration boundary concerns.

### Naming Conventions
- ✅ Not applicable (Dockerfile has no naming conventions in `engineering-standards.md`).

### Existing Patterns
- ✅ The fix follows the existing `COPY {path}/package.json ./{path}/` pattern already present for `apps/api`, `libs/core`, `libs/shared`.
- ✅ The `COPY --from=base` pattern is already used for `apps/api/dist`, `libs/core/dist`, `libs/shared/dist`.

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A new workspace package is added in future and not included in Dockerfile | Medium | Accepted as a known DX maintenance concern; a follow-up tooling improvement (auto-generate COPY lines from `pnpm-workspace.yaml`) is a separate, deferred issue |
| `libs/test-kit` has a runtime dependency needed in production | Very Low | Verified: test-kit is a `devDependency`; `pnpm install --prod` will not install it. Even if its manifest is present, pnpm skips its `devDependencies` in `--prod` mode |
| `dist/` of an integration package does not exist in base stage (e.g., build step missing) | Very Low | `pnpm build` already runs `build:all` in the base stage; all integration packages are included. If a package has no `build` script, the COPY line will produce a Docker warning but not a failure |

### Edge Cases
- **Clean checkout with no local `node_modules`**: The fix ensures `pnpm install` resolves all packages from scratch. Docker's cache will warm after the first successful build.
- **`pnpm-lock.yaml` does not exist in repo**: The base stage uses `COPY pnpm-lock.yaml* ./` (glob with `*`) to tolerate absence. The production stage should use the same pattern — `COPY pnpm-lock.yaml ./` will fail if the file is missing. **Assumption**: `pnpm-lock.yaml` is committed (standard practice) and will always be present. The existing base-stage glob is a historical tolerance that can be normalised later.

### Backward Compatibility
- ✅ No breaking changes. The fix only adds `COPY` instructions; existing instructions are untouched.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
Not applicable — Dockerfile changes are not unit-testable.

### Integration / Build Tests

| Test | Command | Pass Condition |
|---|---|---|
| Full Docker build from clean checkout | `docker build .` | Exits 0; no "unresolved workspace package" error |
| Production container starts | `docker compose up` (API service) | Container logs `NestJS application is running on port 3000` |
| Integration `dist/` present in production image | `docker run --rm <image> ls libs/integrations/allegro/dist` | Lists JS files |
| `pnpm-lock.yaml` present before prod install | Inspect `docker history` or add `RUN ls pnpm-lock.yaml` | File exists before `pnpm install --prod` layer |

### Acceptance Criteria
- [ ] `docker build .` completes without error from a clean checkout with no local `node_modules`.
- [ ] `docker compose up` starts the API container and the process reaches `NestJS application is running`.
- [ ] The production image contains `dist/` output under each of: `libs/plugin-sdk`, `libs/integrations/ai`, `allegro`, `dpd-polska`, `erli`, `inpost`, `prestashop`, `subiekt`, `woocommerce`.
- [ ] `pnpm-lock.yaml` is present in the production stage before `pnpm install --prod` runs (deterministic install).
- [ ] No changes to source code, migrations, or application logic.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A (Dockerfile change only)
- [x] Respects CORE vs Integration boundaries — N/A
- [x] Uses existing patterns (no unnecessary abstractions) — follows existing `COPY manifest` and `COPY --from=base dist` patterns
- [x] Idempotency considered — Docker `COPY` is inherently idempotent
- [x] Event-driven patterns used where applicable — N/A
- [x] Rate limits & retries addressed — N/A
- [x] Error handling comprehensive — N/A (build tooling)
- [x] Testing strategy complete — build-level acceptance criteria defined
- [x] Naming conventions followed — N/A
- [x] File structure matches standards — single file change (`Dockerfile`)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- GitHub Issue: [#1093](https://github.com/openlinker-project/openlinker/issues/1093)
