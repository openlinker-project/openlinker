# #686 — CI: full `tsc` smoke on scaffolded adapter output

Closes #686. Complements the just-merged #684 (lint-time shape check).

## 1. Goal

Add a non-blocking, paths-filtered CI job that:

1. Scaffolds a fresh plugin package via `scripts/create-adapter.mjs`.
2. Wires it into the pnpm workspace via `pnpm install --no-frozen-lockfile`.
3. Builds it via the scaffolded `pnpm build` (`tsc -b`).
4. Cleans up.
5. Fails the PR check if any step fails.

Catches a drift class the existing `scripts/check-create-adapter.mjs` (shape-only, sub-second, runs in `pnpm lint`) cannot: a core API rename in `@openlinker/{core,shared,plugin-sdk}` that silently breaks the scaffolded code's imports.

**Non-goals**: ESLint on scaffolded output (rare drift class, explicitly carved out in the issue body), rewriting `check-create-adapter.mjs`, adding the smoke to `pnpm lint` / pre-commit (wrong resource budget).

## 2. Layer classification

DX / Tooling. No application-code changes; the workflow exercises the scaffolder + the three core packages whose API surface the scaffold consumes.

## 3. Design

### 3.1 Scaffold into the workspace, not a literal tmp dir

The issue body says "tmp dir." A literal `/tmp/...` won't compile because:

- The template `tsconfig.json` uses relative project references (`../../core` etc.). Outside `libs/integrations/`, those paths point at nothing.
- The template `package.json` declares deps via `workspace:*`. Outside the workspace, pnpm can't resolve them.

Resolution: scaffold into `libs/integrations/<slug>/` (a real workspace path per `pnpm-workspace.yaml`'s `libs/integrations/*` glob), build, then remove. This is the only configuration where `tsc -b` sees the same world a real plugin would. The shape check at `scripts/check-create-adapter.mjs` can scaffold to `os.tmpdir()` because it never invokes the compiler.

### 3.2 Smoke slug — `smoketest`

`smoketest` matches the scaffolder's `[a-z][a-z0-9]*(-[a-z0-9]+)*` regex, isn't in `SHIPPED_PLUGIN_NAMES` or `RESERVED_WORKSPACE_NAMES`, and is consistent with the existing shape check's `lintcheck` convention (also non-hyphenated).

A hyphenated slug like `smoke-test` is **deliberately not used**: a local dry-run surfaced a latent bug in `scripts/create-adapter-templates/` where `__name__` (raw slug with hyphens) gets substituted into TypeScript identifier positions like `export const __name__AdapterManifest`, producing invalid syntax (`smoke-testAdapterManifest` parses as `smoke - testAdapterManifest`). The fix belongs in the templates, not in this PR — tracked as a follow-up. The smoke remains non-hyphenated to match the shape check's working baseline.

### 3.3 Trigger paths

The issue body recommends `libs/{core,shared,plugin-sdk}/**` plus the scaffolder/template paths. The committed filter narrows each `libs/<pkg>/**` entry to exclude `*.spec.ts` and `__tests__/**`: spec-only changes can't affect scaffolded-output compilability, and the negation patterns keep noise bounded without changing the core trigger logic. The workflow file itself is included so edits to it re-trigger.

### 3.4 Runner — `ubuntu-latest`

Matches `test-php` (the only existing job on a public runner). Fork-PR contributors get the signal — the whole point of catching scaffold drift early is helping contributors before merge, so the gate must work on fork PRs. Orthogonal to #557, which is scoped to the five existing self-hosted jobs.

### 3.5 No pre-build of `{shared,core,plugin-sdk}`

A local dry-run confirmed `tsc -b` walks the composite project references in the scaffolded `tsconfig.json` and builds `@openlinker/shared`, `@openlinker/core`, `@openlinker/plugin-sdk` automatically from a clean `dist/`-empty state. Pre-building (as `ci.yml`'s lint and test jobs do) is unnecessary for this workflow — those jobs pre-build because they consume `dist/` at runtime (path-resolution via package `main`/`types`); a pure `tsc -b` against the scaffolded package doesn't.

Skipping the pre-build saves ~60s per invocation.

### 3.6 Step sequence

```yaml
- checkout
- setup pnpm v9 + node 20 (matches existing CI)
- pnpm install --frozen-lockfile      # baseline workspace install
- defensive cleanup of any leftover scaffold dir
- node scripts/create-adapter.mjs smoketest
- pnpm install --no-frozen-lockfile    # re-link workspace
- pnpm --filter @openlinker/integrations-smoketest build
- always(): rm -rf libs/integrations/smoketest
```

`--no-frozen-lockfile` is required because the scaffolded package didn't exist when the lockfile was generated; pnpm refuses otherwise. The mutation is local to the runner and never committed.

### 3.7 Coverage

Catches: symbol moves out of `@openlinker/core/<ctx>` or `@openlinker/plugin-sdk` barrels; new required field on `AdapterMetadata`; `tsconfig.base.json` `compilerOptions` changes that break composite-mode builds.

Doesn't catch: runtime drift (compilation only), ESLint rule changes (out of scope), template bugs that affect only hyphenated slugs (separate template bug, follow-up).

## 4. Implementation

| # | File | Action |
|---|------|--------|
| 1 | `.github/workflows/scaffold-smoke.yml` | New workflow per §3.6 |
| 2 | local YAML validation | Parse with `python3 -c "import yaml; yaml.safe_load(...)"` before commit — catches indentation / structural issues that GitHub Actions would only report after push |
| 3 | local end-to-end dry-run | Already executed during planning: scaffold + relink + build succeeded against a clean dist tree (~50s wall time) |

No source-code changes. No test changes. Existing checks unaffected.

## 5. Validation

- **Architecture**: N/A (pure DX). No domain/application/infra/interface touch.
- **Naming**: workflow file `.github/workflows/scaffold-smoke.yml` (issue body verbatim); job id `scaffold-smoke`; step names in sentence case matching `ci.yml`.
- **Security**: `pull_request` trigger (not `pull_request_target`) — runs against the PR's checkout, no access to repo secrets. Top-level `permissions: contents: read` scopes the `GITHUB_TOKEN` to read-only as belt-and-suspenders.
- **Wall time estimate**: ~3-5 min on a `ubuntu-latest` cold cache (checkout 5-10s + Node/pnpm setup 30-60s + `pnpm install --frozen-lockfile` 60-90s + scaffold 1s + re-link 30-60s + `tsc -b` of three core packages + the scaffold 30-50s + cleanup 1s). Well under the 10-min timeout. Warm-cache subsequent runs trim install/re-link by ~half.

## 6. Out of scope (follow-ups)

- Hyphenated-slug template bug (see §3.2) — `__name__` token leaking into TS identifier positions.
- `concurrency:` group to cancel superseded runs.
- Caching `dist/` between runs.
