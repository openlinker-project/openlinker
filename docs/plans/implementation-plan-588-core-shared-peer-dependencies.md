# Implementation Plan — #588 Move NestJS + TypeORM to peerDependencies in core/shared

**Issue**: #588 `[F1] [BLOCKER] Core declares NestJS and TypeORM as dependencies, not peerDependencies`
**Parent epic**: #552 (Modularity Thread F — SDK boundary preparation)
**Tracking**: #546 (Modularity audit)

---

## 1. Goal

When `@openlinker/core` and `@openlinker/shared` are eventually published to npm, plugin
authors who depend on them must reuse the **host application's** copy of NestJS and
TypeORM instead of installing their own. NestJS DI uses metadata reflection on
constructor symbols, and TypeORM keeps a process-global metadata storage — both fail in
confusing runtime ways when two copies exist in the same process.

The fix is purely metadata: move four packages from `dependencies` to `peerDependencies`
in two `package.json` files, with caret ranges, plus an `engines` field.

**Layer**: DX / SDK boundary. Zero source-code changes. Zero schema changes.

---

## 2. Non-goals (explicit)

- **No source-code edits.** Imports of `@nestjs/common` / `typeorm` / `@nestjs/typeorm` /
  `@nestjs/config` from `libs/core/src/**` and `libs/shared/src/**` stay exactly as they
  are. Type resolution is provided by the hosted `node_modules` (see §3.3 risk analysis).
- **No publishing-related changes.** Repo is still pre-publish; this PR only fixes the
  metadata so that publishing later doesn't ship duplicate copies. `private: true` stays.
- **No `redis` dependency reclassification.** `@openlinker/shared` keeps `redis` as a
  regular dependency — the issue calls out only the four Nest/TypeORM packages, and
  `redis` does not have the singleton-decorator-storage problem.
- **No `peerDependenciesMeta.optional` flags.** All four packages are required at runtime
  by some symbol in core/shared. pnpm 10's default treats peer deps as required.
- **No version bumps.** Caret ranges keep today's pinned versions valid; no actual
  upgrade.
- **No changes to sibling adapter packages.** `libs/integrations/{allegro, prestashop, ai}`
  already use peerDependencies correctly — the fix here is just bringing core/shared
  into line with that established pattern.
- **`apps/web` is unaffected.** The frontend doesn't import `@openlinker/core` or
  `@openlinker/shared` (it talks to the API over HTTP), so adding Nest peer-dep
  declarations to those packages does not change `apps/web`'s install graph or
  introduce any Nest dependency into the browser bundle.
- **No CI / release-pipeline changes.** Out of scope; covered by other Thread F issues
  (#596 semver discipline, #597 plugin-sdk package, #599 plugin migrations path).

---

## 3. Research notes

### 3.1 Established pattern in this repo

All three sibling integration adapters use the correct shape:

```jsonc
// libs/integrations/allegro/package.json (and prestashop, ai — all identical)
"dependencies": {
  "@openlinker/core": "workspace:*",
  "@openlinker/shared": "workspace:*",
  // adapter-specific runtime deps...
},
"peerDependencies": {
  "@nestjs/common": "^10.0.0"
}
```

So the precedent is set. `libs/core` and `libs/shared` are the outliers.

### 3.2 Hosts already declare every dep directly

Both consumer applications declare the full Nest+TypeORM stack as direct deps:

- `apps/api/package.json`: `@nestjs/axios`, `@nestjs/common`, `@nestjs/config`,
  `@nestjs/core`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/platform-express`,
  `@nestjs/schedule`, `@nestjs/swagger`, `@nestjs/typeorm`, `typeorm`.
- `apps/worker/package.json`: `@nestjs/common`, `@nestjs/config`, `@nestjs/core`,
  `@nestjs/typeorm`, `typeorm`.

So in the workspace context, peer requirements are always satisfied by a real install.

### 3.3 pnpm hoisting makes the migration safe

`.npmrc`:
```
shamefully-hoist=true
public-hoist-pattern[]=*jest*
public-hoist-pattern[]=@jest/*
```

With `shamefully-hoist=true`, pnpm flattens transitive deps into root `node_modules`.
Any source file in any workspace package can `import` any installed package — peer dep,
direct dep, or even a package only declared by a sibling. `tsc --noEmit` from
`libs/core` will resolve `@nestjs/common` types from `<repo>/node_modules/@nestjs/common`.

### 3.4 pnpm 10 + `auto-install-peers`

pnpm 10.11 (lockfile) keeps `auto-install-peers=true` as the default. When `apps/api`'s
direct deps change but core's *peer* deps reference the same versions, pnpm reuses the
single hoisted copy — exactly the behaviour we want once published.

---

## 4. Design

### 4.1 `libs/core/package.json` diff (intent)

Move:

```diff
-"dependencies": {
-  "@nestjs/common": "10.3.0",
-  "@nestjs/typeorm": "10.0.2",
-  "typeorm": "0.3.17"
-},
+"peerDependencies": {
+  "@nestjs/common": "^10.0.0",
+  "@nestjs/typeorm": "^10.0.0",
+  "typeorm": "^0.3.0"
+},
+"engines": {
+  "node": ">=18.0.0"
+},
```

Keep `devDependencies` as-is (jest, ts-jest, eslint, etc. are dev-only and don't
need promotion).

### 4.2 `libs/shared/package.json` diff (intent)

Move three Nest packages; keep `redis` in regular `dependencies`:

```diff
 "dependencies": {
-  "@nestjs/common": "10.3.0",
-  "@nestjs/config": "3.2.0",
-  "@nestjs/typeorm": "10.0.2",
   "redis": "4.6.12"
 },
+"peerDependencies": {
+  "@nestjs/common": "^10.0.0",
+  "@nestjs/config": "^3.0.0",
+  "@nestjs/typeorm": "^10.0.0"
+},
+"engines": {
+  "node": ">=18.0.0"
+},
```

### 4.3 `engines.node` choice

Issue says "constraining Node LTS." Root `package.json` already declares
`"node": ">=18.0.0"`. Match that for consistency — bumping the floor independently
in core/shared would be a separate decision and is out of scope.

### 4.4 Caret-range rationale

- `@nestjs/common`, `@nestjs/typeorm` → `^10.0.0`. Currently pinned at `10.3.0` /
  `10.0.2`. Caret on `^10.0.0` accepts any `10.x.y` host install. Matches the existing
  pattern in `libs/integrations/allegro/package.json`.
- `@nestjs/config` → `^3.0.0`. Currently pinned at `3.2.0` in shared.
- `typeorm` → `^0.3.0`. Currently pinned at `0.3.17`. Per-spec, `^0.3.x` accepts any
  `0.3.y` patch within the same minor (caret on a `0.x.y` semver locks the minor).

### 4.5 Lockfile refresh

After the package.json edits, run `pnpm install` once to regenerate
`pnpm-lock.yaml`. The expected diff is small: per-package `dependencies` blocks for
`@openlinker/core` and `@openlinker/shared` lose their entries; new `peerDependencies`
blocks appear; the resolved `node_modules` graph for hosts (`apps/api`, `apps/worker`)
is unchanged because they declared the same packages directly.

---

## 5. Step-by-step plan

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `libs/core/package.json` | Move three packages to `peerDependencies`, drop the now-empty `dependencies` block. Add `engines.node`. | JSON valid; `dependencies` key absent (no empty object) — match `libs/integrations/allegro` shape. |
| 2 | `libs/shared/package.json` | Move three Nest packages to `peerDependencies`. Keep `redis` in `dependencies`. Add `engines.node`. | JSON valid. |
| 3 | (root) | Run `pnpm install` to refresh `pnpm-lock.yaml`. | Exit code 0. Lockfile diff limited to the `@openlinker/core` and `@openlinker/shared` entries. |
| 4 | (quality gate) | `pnpm lint && pnpm type-check && pnpm test` | All pass. Test count unchanged. |
| 5 | (smoke) | `pnpm build` (full monorepo) | Exit code 0. Confirms every importer of core/shared still type-resolves. |
| 6 | (frozen-lockfile sanity) | `pnpm install --frozen-lockfile` | Exit code 0. Confirms the lockfile is internally consistent — what CI will do. |

---

## 6. Risks & mitigations

### R1 — `tsc` cannot find `@nestjs/common` types from `libs/core`
**Likelihood**: very low. **Impact**: type-check fails.
With `shamefully-hoist=true` the package is in root `node_modules`, and Node's module
resolution + TypeScript's path resolution walk up to it. Confirmed pattern in
`libs/integrations/allegro` which is already peer-only and type-checks today.

**Mitigation**: Step 4 (`pnpm type-check`) is the explicit canary. If it fails, restore
the package as a `devDependency` in core/shared (not a regular dep — that would defeat
the singleton goal). pnpm with `auto-install-peers=true` auto-installs the dev copy
for the lib's isolated install but the peer dep still drives the host's runtime
resolution.

### R2 — pnpm refuses to install due to peer-dep resolution failure
**Likelihood**: low. **Impact**: `pnpm install` exits non-zero.
Only happens if no installer in the workspace satisfies the peer range. Both apps
declare the deps at exact versions matching `^10.0.0` and `^0.3.0`, so the constraint
is satisfied.

**Mitigation**: Step 3 (`pnpm install`) is the explicit canary. If it fails, examine
the error and either widen the range or, in the worst case, downgrade to a
`peerDependencies` warn-only via `peerDependenciesMeta` — but per §2 we don't expect
to need that.

### R3 — `dependencies` block becomes empty in `libs/core/package.json`
**Likelihood**: 100%. **Impact**: cosmetic.

**Mitigation**: drop the `dependencies` key entirely (don't leave `"dependencies": {}`).
Matches `libs/integrations/allegro/package.json` which has no `dependencies` block when
it has no runtime deps. (In our case core *will* still have no `dependencies`, since
all three current entries were Nest/TypeORM — so the key goes away.)

### R4 — `pnpm-lock.yaml` diff is unexpectedly large
**Likelihood**: low. **Impact**: noisy PR diff.
Large lockfile diffs sometimes happen when pnpm decides to re-resolve transitives.

**Mitigation**: Inspect the diff after step 3. If it's larger than `core` + `shared`
entries, abort and investigate before committing. Don't paper over it.

### R5 — `.npmrc` `shamefully-hoist=true` removal would silently break this
**Likelihood**: only if a future modularity PR tries to tighten the hoisting model.
**Impact**: `pnpm --filter @openlinker/core type-check` and `… build` would fail
because pnpm 10 does not auto-resolve a workspace lib's peer deps into its local
`node_modules` symlink — the lib relies on the flat root `node_modules` to find
`@nestjs/common` types.

This is the load-bearing invariant the migration sits on top of. The sibling
adapter packages (`libs/integrations/{allegro, prestashop, ai}`) have ridden the
same invariant since their first publish.

**Mitigation**: this risk register is the tripwire. If a future PR touches
`.npmrc` to remove `shamefully-hoist=true` (e.g. as part of #597 plugin-sdk work
or a stricter pnpm 11 default), it must either (a) keep the four packages in
core/shared `devDependencies` so isolated lib type-check still resolves them,
or (b) ship per-package `tsconfig` `paths` that point at root `node_modules`.
Either is fine; silently dropping the hoist flag is not.

---

## 7. Validation strategy

### 7.1 Quality gate (mandatory)

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit tests pass
```

### 7.2 Build smoke

```bash
pnpm build       # all packages build
```

This is the strongest signal that consumers (apps/api, apps/worker, every integration)
still compile against the new peer-dep core/shared. `pnpm type-check` already covers
the no-emit case; full build also exercises declaration emission and re-export
correctness.

### 7.3 Frozen-lockfile sanity

```bash
pnpm install --frozen-lockfile
```

Verifies the committed lockfile is internally consistent with the two updated
`package.json` files — what CI runs. If this fails after step 3 (which already
regenerated the lockfile), the regeneration produced a lockfile that pnpm itself
won't accept on a clean install. Investigate before pushing.

### 7.4 Dedup positive verification

```bash
pnpm why @nestjs/common
pnpm why @nestjs/typeorm
pnpm why typeorm
pnpm why @nestjs/config
```

Each query must show **a single resolved version** owned by the host
(`apps/api`, `apps/worker`), with `@openlinker/core` and `@openlinker/shared`
listed as peer-dep consumers (not separate copies). This is the actual symptom
the issue exists to prevent ("once published, every plugin will install its own
copy"). The `lint` / `type-check` / `build` gates verify nothing broke; `pnpm why`
verifies the deduplication actually happened. If a second copy appears, the
caret ranges in core/shared don't intersect with the host's pinned versions —
widen the range or align the host pin.

### 7.5 No integration tests run

Integration tests are unaffected by this metadata change — Testcontainer
boot-and-query behaviour does not depend on package.json shapes. Skip `pnpm
test:integration` to keep the PR fast; the unit tests + build cover the surface.

---

## 8. Architecture compliance check

| Standard | Compliance |
|---|---|
| Hexagonal layering (`docs/architecture-overview.md` §Hexagonal) | N/A — metadata-only change. |
| `*.port.ts` / `*.adapter.ts` naming | N/A. |
| TypeScript strict mode | N/A — no source edits. |
| No `any`, no `console.log` | N/A. |
| Migrations workflow (`docs/migrations.md`) | N/A — no schema changes. |
| Engineering standards §Import Aliases | N/A — no imports change. |
| Plugin-readiness contract (#552 epic) | **Direct compliance**. This is the epic's first BLOCKER. |

---

## 9. Open questions

None. Issue scope is unambiguous and self-contained.

---

## 10. Out-of-scope follow-ups (do not include in this PR)

- **#589 [F2]** — `@openlinker/shared` Logger as NestJS Logger subclass. Same Thread F,
  separate behavioural change.
- **#594 [F7]** — ORM entities re-exported from public barrels. Touches the
  source surface; separate PR.
- **#596 [F9]** — Semver discipline (currently `0.1.0` everywhere). Release-pipeline
  concern; separate PR.
- **#597 [F10]** — Dedicated `@openlinker/plugin-sdk` package. Larger refactor; separate
  epic-level PR.
- **#599 [F12]** — Plugin-owned migrations shipping path. Schema/runtime work.

These are explicitly *not* required for this BLOCKER to land — Thread F is sequenced
intentionally.

---

## 11. Branch + PR conventions

- Branch: `588-core-shared-peer-dependencies` (already created via worktree)
- Commit style: `chore(deps): move NestJS + TypeORM to peerDependencies in core/shared`
- Commit scope: a **single commit** covering three files —
  `libs/core/package.json`, `libs/shared/package.json`, and `pnpm-lock.yaml`
  (regenerated by step 3). No source-code edits.
- PR body: include `Closes #588` (don't manually close per CLAUDE.md rule).
