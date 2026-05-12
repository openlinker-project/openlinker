# Implementation Plan — Connection Barrel-Only (#591) · Full Scope

**Issue**: [#591 — [F4] [HIGH] Connection entity exposed via deep path and via barrel — two valid surfaces](https://github.com/SilkSoftwareHouse/openlinker/issues/591)
**Thread**: Modularity Thread F · Catalog SDK-5
**Layer**: Backend SDK — package-export surgery + import migration + lint guard

---

## 1 · Goal

Eliminate the dual import surface for every core context. After this PR, consumers (intra-core, apps, plugin packages) can reach core symbols only through the top-level barrel — `@openlinker/core/<context>` — never through `@openlinker/core/<context>/{domain,application,infrastructure}/...` deep paths.

Three complementary changes:

1. **`libs/core/package.json`**: drop every `./<context>/*` wildcard subpath (`./identifier-mapping/*`, `./sync/*`, `./integrations/*`, `./events/*`, `./mappings/*`, `./listings/*` keep `./listings/services`, `./customers/*`, `./users/*`, `./webhooks/*`, `./ai/*`, `./content/*` if present). Force Node-runtime resolution through barrels only.
2. **Imports**: migrate every existing deep-aliased import (126 sites across the repo) to either the barrel alias (cross-context) or a relative import (same-context, per existing engineering-standards). Widen barrels where they don't yet re-export needed symbols.
3. **ESLint**: add an override scoped to `libs/integrations/**/*.ts` banning `@openlinker/core/*/{domain,application,infrastructure}/**` — same pattern the existing port-files guard uses, just a different glob.

## 2 · Non-goals

- **Renaming the `SyncJob` ↔ `SyncJobEntity` aliasing in the sync barrel**. The existing barrel deliberately re-exports the domain entity class as `SyncJobEntity` to avoid a name collision with the `SyncJob` type from `sync-job.types`. Migration adapts call sites to that naming; the underlying rename ("`SyncJob` type → `SyncJobRecord` / `SyncJobData`, drop the alias") is tracked as a one-line follow-up note in the PR description, not done here.
- **Banning cross-integration imports** (`@openlinker/integrations-*/**` from within `libs/integrations/*`). Out of #591's stated scope.

### 2.1 Documentation update — IN scope for this PR

`docs/engineering-standards.md` §Import Aliases currently shows a "✅ Good" example at line 1167 that imports `Connection` via the deep alias `@openlinker/core/identifier-mapping/domain/entities/connection.entity` — exactly the pattern this PR bans. After Step 4, that import fails at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The doc must be updated in lock-step:

- Cross-package imports → barrel alias `@openlinker/core/<ctx>` (already correct).
- Same-context cross-layer imports → **relative** when the path fits ≤ `../..` (existing `.eslintrc.js:192-202` override codifies this — the runtime constraint forced it, the standard's prose hadn't caught up).
- Same-context cross-layer imports that would require `../../../` or deeper → use the barrel alias `@openlinker/core/<ctx>` instead. Engineering-standards rule 4 ("Ban deep relative imports") wins over the cross-layer-alias rule when the two conflict.
- Replace the "Good" example to import `Connection` from the barrel.

## 3 · Migration inventory

Grepped `from '@openlinker/core/{ctx}/{layer}/...'` across the repo:

| Surface | Same-context (→ relative) | Cross-context (→ barrel alias) | Total |
|---|---|---|---|
| `libs/core/src/*` | 51 | 19 | 70 |
| `apps/*` | n/a | 54 | 54 |
| `libs/integrations/*` | n/a | 2 | 2 |
| **Total** | **51** | **75** | **126** |

42 distinct deep-aliased paths. The five highest-frequency:
- `…/integrations/application/interfaces/integrations.service.interface` (12 × — `IIntegrationsService`, already in barrel)
- `…/sync/domain/entities/sync-job.entity` (11 × — `SyncJob` class, exported as **`SyncJobEntity`** in barrel, requires rename at call sites)
- `…/sync/domain/types/sync-job.types` (10 × — already in barrel)
- `…/sync/domain/ports/sync-job-repository.port` (10 × — already in barrel)
- `…/identifier-mapping/domain/entities/connection.entity` (9 × — `Connection`, already in barrel)

## 4 · Barrel widening (must precede migration)

Some deep-imported symbols are not yet re-exported from their context barrel and must be added first, otherwise the migration would lose access to them:

| Symbol | Current path | Add to barrel |
|---|---|---|
| `DuplicateAdapterKeyException` | `…/integrations/domain/exceptions/duplicate-adapter-key.exception` | `libs/core/src/integrations/index.ts` |
| `DuplicatePlatformDefaultException` | `…/integrations/domain/exceptions/duplicate-platform-default.exception` | same |
| `IntegrationCredential` (domain entity) | `…/integrations/domain/entities/integration-credential.entity` | same |
| `IntegrationCredentialOrmEntity` | `…/integrations/infrastructure/persistence/entities/integration-credential.orm-entity` | same |
| Any other symbols surfaced during migration | (per call site) | per-barrel |

The full list will be finalised when the migration walks the 42 distinct deep paths in Step 3 below.

## 5 · Design

### 5.1 Package.json surgery

In `libs/core/package.json` `exports`, **remove**:

```jsonc
"./integrations/*": { ... },
"./identifier-mapping/*": { ... },
"./mappings/*": { ... },
"./events/*": { ... },
"./sync/*": { ... },
"./listings/*": { ... },           // keep "./listings/services" entry
"./customers/*": { ... },
"./users/*": { ... },
"./webhooks/*": { ... },
"./ai/*": { ... }
```

Keep:
- The `./<context>` barrel entries (every context).
- The explicit `./listings/services` sub-barrel (intentional separation per #337/#359 — see architecture-overview §6 Listings).

### 5.2 Import migration rules

Walk every deep-aliased import; apply per-site:

- **Same-context (~51 sites) — per-site decision based on path depth**:
  - If the relative path to the target fits in ≤ `../..` → switch to a relative import (ESLint's `**/infrastructure/**`/`**/persistence/**`/`**/application/**` override at `.eslintrc.js:192-202` permits this, and it avoids the `ERR_PACKAGE_PATH_NOT_EXPORTED` Node-runtime trap that motivated the override).
  - If the relative path would be `../../../` or deeper → **keep the barrel alias** `@openlinker/core/<ctx>` (engineering-standards rule 4 — "Ban deep relative imports" — wins over the cross-layer-alias rule here, since cross-context wildcards no longer resolve). The barrel must export the symbol; widen if needed (Step 1).
  - Port-files (`libs/core/src/**/domain/ports/**/*.{port,capability,types}.ts`) keep using barrel imports for any cross-file references per the existing guard at `.eslintrc.js:207-230`.
- **Cross-context (~75 sites)**: switch to the barrel alias `@openlinker/core/<ctx>`. The symbol must exist on that barrel (widen if missing — Step 1).
- **`SyncJob` class call sites (~11 sites)**: import `SyncJobEntity` from `@openlinker/core/sync` and rename local references where the class is used (constructor calls, type annotations for the class form). Distinguish from the **type** `SyncJob` (still exported under that name from the same barrel) which keeps its name unchanged.

The "51 same-context" tally is a UPPER BOUND on the relative-migrations — sites that fall under the "≥ `../../../`" condition will swap to a barrel alias instead, increasing the cross-context count by that delta. Walk per-site; no global find/replace.

### 5.3 ESLint rule

Append TWO overrides to `.eslintrc.js` `overrides` — both placed AFTER the existing `**/infrastructure/**` exemption (`.eslintrc.js:192-202`) so they win via override-order. The first locks the integration packages; the second locks the host apps so a future refactor can't quietly reintroduce deep aliases.

```js
{
  // Plugin contract surface: integration packages must consume only the
  // top-level `@openlinker/core/<context>` barrels. Deep-path imports
  // leak unstable internals and break when core refactors its layout
  // (see #591).
  files: ['libs/integrations/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@openlinker/core/*/domain/**',
              '@openlinker/core/*/application/**',
              '@openlinker/core/*/infrastructure/**',
            ],
            message:
              'Integration packages must import from `@openlinker/core/<context>` top-level barrels — never deep sub-paths. Deep imports leak unstable internals; when core refactors, plugins break. See #591.',
          },
        ],
      },
    ],
  },
},
{
  // Host apps: lock the door behind us. Once the wildcards are dropped,
  // deep aliases fail at Node runtime anyway — this rule keeps them out
  // of `apps/*` source at lint time so the failure mode is "PR fails CI"
  // not "production crashes on require()".
  files: ['apps/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@openlinker/core/*/domain/**',
              '@openlinker/core/*/application/**',
              '@openlinker/core/*/infrastructure/**',
            ],
            message:
              'Apps must import from `@openlinker/core/<context>` top-level barrels — never deep sub-paths. The package.json wildcards were dropped in #591; deep aliases now fail at Node runtime.',
          },
        ],
      },
    ],
  },
},
```

## 6 · Step-by-step plan

The steps are strictly ordered. Step 4 (drop wildcards) MUST NOT run until the grep gate at the end of Step 3 is green — otherwise 70 intra-core deep aliases break at Node runtime the moment the wildcards disappear.

### Step 1 — Widen barrels for missing symbols

**Files**: `libs/core/src/integrations/index.ts` (and any other barrel that the migration surfaces as needing more exports — finalised iteratively during Step 2/3 walks).

**Accept**: every symbol currently imported via a deep path is reachable from its context barrel. Verify with `pnpm --filter @openlinker/core build` after each barrel widening.

### Step 2 — Migrate cross-context deep imports to barrel aliases (~75 sites)

**Files** (by frequency, abbreviated): 12 × `@openlinker/core/integrations` (IIntegrationsService), 11 × `@openlinker/core/sync` (SyncJobEntity rename), 10 × `@openlinker/core/sync` (sync-job.types), 10 × `@openlinker/core/sync` (sync-job-repository.port), 9 × `@openlinker/core/identifier-mapping` (Connection), 6 × `@openlinker/core/products` (ProductMasterPort), 4 × `@openlinker/core/integrations` (adapter.types), …

**Accept**: every cross-context call site uses the barrel alias; no `@openlinker/core/*/{domain,application,infrastructure}/**` references outside same-context files.

### Step 3 — Migrate same-context deep imports per the depth rule (~51 sites)

**Scope**: 23 × intra-integrations, 11 × intra-identifier-mapping, 3 × intra-sync, 2 × intra-events, 1 × intra-inventory + the same-context portion of the cross-table.

**Per-site decision**: relative path ≤ `../..` → relative; otherwise barrel alias. See §5.2.

**Accept**: every same-context call site is either (a) using a relative import that fits ≤ `../..`, OR (b) routed through the barrel alias `@openlinker/core/<ctx>` — never via a deep `@openlinker/core/<ctx>/<layer>/...` alias.

### Step 3.5 — Pre-Step-4 gate (mandatory)

Run the §8 §validation grep:

```bash
grep -rEn "from ['\"]@openlinker/core/[a-z-]+/(domain|application|infrastructure)/" --include='*.ts' libs/core/src libs/integrations apps | grep -v node_modules | wc -l
```

**Must return 0.** If non-zero, fix outstanding sites BEFORE proceeding to Step 4. Dropping the wildcards while any deep alias remains breaks the build at Node runtime.

### Step 4 — Drop wildcard subpaths from `libs/core/package.json`

**File**: `libs/core/package.json` (edit — delete the 10 `./<context>/*` entries listed in §5.1).

**Accept**:
- `pnpm --filter @openlinker/core build` succeeds (compiled `dist/` no longer needs deep paths to resolve from external consumers).
- Node-runtime resolution of `@openlinker/core/<ctx>/<layer>/<file>` from outside libs/core fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. (Verify by attempting a one-off deep import in an apps/api file — should fail at `pnpm start:dev:api` or `pnpm test` runtime — revert after verification.)

### Step 5 — Add the ESLint guards for `libs/integrations/**` AND `apps/**`

**File**: `.eslintrc.js` (edit — append the two override blocks at the END of the `overrides` array, AFTER the existing `**/infrastructure/**` exemption at lines 192-202).

**Accept**:
- Adding a temporary deep import to ANY file under `libs/integrations/*/src/**/*.ts` OR `apps/**/*.ts` fails `pnpm lint`. Smoke-test by introducing one such import, confirming the lint error, reverting.
- The 2 allegro spec deep imports (already migrated in Step 2) pass.

### Step 6 — Update `docs/engineering-standards.md` §Import Aliases

**File**: `docs/engineering-standards.md` (edit — see §2.1 above for the specific changes).

**Accept**:
- The "✅ Good" example at line 1167 no longer shows a deep alias for `Connection`.
- The Cross-boundary section explicitly acknowledges the same-context cross-layer = relative override for paths ≤ `../..`, and barrel alias otherwise.
- A short paragraph notes the runtime constraint (`ERR_PACKAGE_PATH_NOT_EXPORTED`) that motivated dropping the deep aliases.

### Step 7 — Quality gate

```bash
pnpm lint        # 0 errors
pnpm type-check  # clean
pnpm test        # all unit tests pass
```

Note: jest's `moduleNameMapper` in `libs/core/jest.config.js` and `apps/*/jest.config.js` resolves `@openlinker/core/*` directly to source paths — it doesn't go through Node's `exports`. So unit/integration tests may pass green even if a deep import was missed. **The §3.5 grep gate is authoritative**; test green is necessary but not sufficient.

## 7 · Risk register

| Risk | Mitigation |
|---|---|
| Migration surfaces additional barrel-export gaps mid-walk. | Step 1 widens barrels iteratively as Step 2/3 progress; not a one-shot. Each gap is a one-line addition to the relevant `index.ts`. Re-run the libs/core build after each gap-fix. |
| `SyncJob` rename at 11 sites collides with type usage. | Read the symbol's usage at each site: class (constructor call, `instanceof`, type annotation referring to the class) → `SyncJobEntity`; pure type usage referring to `SyncJob` from `sync-job.types` → keep as `SyncJob`. TypeScript will catch wrong narrowing. |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime after Step 4. | The §3.5 grep gate is the authoritative pre-condition for Step 4. Tests alone are insufficient (see Step 7 note about jest `moduleNameMapper`). Also run `pnpm test:integration` if Docker is available before merge; integration specs route through real Node `require()`. |
| Deep relative imports surface in same-context migrations (`../../../...`). | §5.2 per-site rule: if ≤ `../..` use relative, else barrel alias. Walk per-site; do not bulk-convert. |
| ESLint override order: new rule loses to earlier `**/infrastructure/**` exemption for `libs/integrations/**/infrastructure/**` or `apps/**/infrastructure/**`. | Place new overrides at the END of the overrides array; ESLint applies overrides in order, later wins. Smoke-test in Step 5 by adding a temporary deep import in `libs/integrations/allegro/src/infrastructure/...` and confirming lint fails. |
| The 2 allegro spec deep imports break before being migrated, blocking Step 5's smoke test. | They're in Step 2's 75-site bucket — migrated before Step 5 runs. |
| Engineering-standards.md doc update (Step 6) gets dropped under time pressure, leaving prose that contradicts runtime behaviour. | Step 6 is part of the PR's acceptance criteria — same gate as the code changes. PR cannot merge until §8 includes the doc tick. |

## 8 · Validation checklist

- [ ] `libs/core/package.json` no longer has any `./<context>/*` wildcard subpath entries (except `./listings/services` which is an explicit sub-barrel, not a wildcard).
- [ ] `grep -rEn "from ['\"]@openlinker/core/[a-z-]+/(domain|application|infrastructure)/" --include='*.ts' libs/core/src libs/integrations apps | grep -v node_modules | wc -l` → **0**.
- [ ] `.eslintrc.js` has TWO new overrides — one scoped to `libs/integrations/**/*.ts`, one scoped to `apps/**/*.ts` — both banning the three deep-layer patterns; both placed AFTER the existing `**/infrastructure/**` exemption at lines 192-202.
- [ ] `docs/engineering-standards.md` §Import Aliases updated: "✅ Good" example no longer shows a deep alias; runtime constraint + same-context depth rule documented.
- [ ] `pnpm lint` — 0 errors.
- [ ] `pnpm type-check` — clean.
- [ ] `pnpm test` — all unit tests pass (1718+).

## 9 · Open questions

- **Cross-integration imports**: should the new `libs/integrations/**` guard also ban `@openlinker/integrations-*/**` (i.e., one integration importing from another)? The port-files guard at `.eslintrc.js:221` already bans this for core port files. Including it here would mirror the policy: plugins should not depend on each other. Defer to follow-up — adds noise to the current scope.
- **SyncJob naming follow-up**: the existing `SyncJob (class) ↔ SyncJob (type)` collision is worked around by importing `SyncJobEntity` from the barrel. Worth a one-line follow-up issue to rename the type (`SyncJobRecord` / `SyncJobData`) and drop the alias — cleaner naming, no migration burden once #591 lands.

## 10 · Scope estimate (revised)

- Step 1 (widen barrels): ~5–10 missing exports, iterative — ~20–30 min in total once gaps surface.
- Step 2 (~75 cross-context migrations): ~90 min mechanical edits per distinct import path. `SyncJob` class/type disambiguation adds ~20 min of per-site review at the 11 affected sites.
- Step 3 (~51 same-context migrations, per-depth rule): ~45–60 min — slower than pure find/replace because the depth check is per-site.
- Step 3.5 (grep gate): ~5 min, mandatory.
- Step 4 (package.json wildcard removal): 1-line surgery + verification, ~5 min.
- Step 5 (ESLint overrides + smoke test): ~10 min.
- Step 6 (engineering-standards.md update): ~15 min.
- Step 7 (quality gate): ~10 min if green; fixes vary.

**Total**: ~3–5 hours of mechanical work, single coherent PR. Higher diff churn than #589 but lower architectural risk. The SyncJob disambiguation and the per-site depth rule are the two slowest items — neither admits a global find/replace.
