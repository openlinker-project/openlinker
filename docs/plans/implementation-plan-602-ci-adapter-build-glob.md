# #602 — CI: deterministic adapter-package builds via workspace glob

Closes #602. Part of Modularity Thread G (#553).

## 1. Goal

Two changes that close the "I added an adapter but forgot to update CI" gap:

1. **Replace the hardcoded `pnpm --filter @openlinker/integrations-<name> build` lists** in three CI jobs with a workspace-glob `pnpm -r --filter "./libs/**" build`. The glob auto-discovers any new package under `libs/`.
2. **Add a `pnpm lint` invariant** that asserts every workspace package under `libs/` declares a non-empty `scripts.build`. Closes the silent-skip failure mode in (1) — see §4.2.

## 2. Layer classification

DX / CI. No application-code touch.

## 3. Current state — asymmetric under-coverage

Three integration packages exist (`ai`, `allegro`, `prestashop`) plus `core`, `shared`, `plugin-sdk`, and `test-kit` (#689). The current `ci.yml` pre-build steps are inconsistent:

| Job (file:line) | Pre-builds today | Missing |
|---|---|---|
| `lint` (`ci.yml:31-33`) | shared, core, prestashop | allegro, ai, plugin-sdk, test-kit |
| `test` (`ci.yml:75-78`) | shared, core, prestashop, allegro | ai, plugin-sdk, test-kit |
| `test-integration` (`ci.yml:107-109`) | shared, core, prestashop | allegro, ai, plugin-sdk, test-kit |

Today this works because the affected job's lint/test targets don't reach types in the missing packages. It's a latent under-coverage. `ai` is in *no* job's pre-build list despite being a real workspace package.

The `type-check` and `build` jobs already use workspace-glob commands (`pnpm type-check`, `pnpm build`) and don't have this problem.

## 4. Design

### 4.1 The replacement command

```yaml
- name: Build dependencies
  run: pnpm -r --filter "./libs/**" build
```

- `-r` runs the script in every workspace package.
- `--filter "./libs/**"` scopes to packages whose directory is under `libs/` (matches all 7 today). Verified locally.
- pnpm runs in topological order by default — `@openlinker/core` builds before its dependents.
- Each package's `build` is `tsc -b`; composite mode walks references and short-circuits already-built deps, so the topo redundancy is bounded.

### 4.2 The pnpm silent-skip failure mode — and the invariant that closes it

The plan's first draft claimed pnpm would error on a missing `build` script ("Missing script: build"). Empirical test (pnpm 10.11.1, this workspace, `pnpm -r --filter "./libs/**" run nonexistent-script`):

```
Scope: 7 of 11 workspace projects
None of the selected packages has a "nonexistent-script" script
exit=0
```

Worse — temporarily deleting `scripts.build` from `libs/test-kit/package.json` and running the actual `build` command: pnpm builds the other 6 packages and silently skips test-kit. **Exit 0**. No warning that test-kit was missed.

This means a contributor who adds `libs/integrations/shopify/package.json` with a typo'd `"buld"` (or no `build` script at all) would have it silently excluded from CI's build step. The runtime breakage surfaces somewhere downstream — exactly the failure mode #602 is trying to prevent.

**Fix**: a small invariant script `scripts/check-libs-build-scripts.mjs`, chained into the `check:invariants` command (which runs on every `pnpm lint`). The script asserts every workspace package under `libs/*` and `libs/integrations/*` declares a non-empty `scripts.build`. Mirrors the shape of `check-create-adapter.mjs` and `check-migration-timestamps.mjs`.

### 4.3 Trigger paths and runner choice

Trigger paths are unchanged from current `ci.yml` (workflow already runs on every PR). Runner choice (`self-hosted` for the modified jobs) is unchanged — that's #557's domain.

### 4.4 Test-integration verify step — split, don't inline

The current `Build dependencies` step at `ci.yml:103-118` packs two concerns into one `run: |` heredoc: three `pnpm --filter` lines plus a `dist/identifier-mapping/index.js` verify check (past-bug guard). The cleanest mechanical replacement is to **split into two steps**:

```yaml
- name: Build dependencies
  run: pnpm -r --filter "./libs/**" build

- name: Verify core dist exists
  run: |
    test -f libs/core/dist/identifier-mapping/index.js \
      || (echo "ERROR: libs/core/dist/identifier-mapping/index.js missing after build" && exit 1)
```

Drops the `find`/`echo` diagnostic noise (it was inline-debugging for the past incident; the `test -f` is the load-bearing guard). The verify step stays as its own concern.

### 4.5 Wasted-work tradeoff

Switching the pre-built set:

| Job | Pre-built today | New (glob) | Net invocations added |
|---|---|---|---|
| `lint` | 3 | 7 | +4 |
| `test` | 4 | 7 | +3 |
| `test-integration` | 3 | 7 | +4 |

Each added `tsc -b` against an already-built dep is fast (composite mode + incremental). Estimated overhead: 10-20s per job on cold cache; near-zero on warm.

## 5. Implementation

| # | File | Action |
|---|------|--------|
| 1 | `.github/workflows/ci.yml:26-33` (lint) | Replace 3-line hardcoded block with `pnpm -r --filter "./libs/**" build` |
| 2 | `.github/workflows/ci.yml:70-78` (test) | Replace 4-line hardcoded block with the same glob command |
| 3 | `.github/workflows/ci.yml:103-118` (test-integration) | Replace the whole 16-line block with two steps per §4.4: glob build + dist verify |
| 4 | `scripts/check-libs-build-scripts.mjs` (new) | Walks `libs/*` and `libs/integrations/*`, fails if any package.json lacks non-empty `scripts.build` |
| 5 | `package.json` `check:invariants` script | Chain in the new check |
| 6 | local quality gate | `pnpm lint && pnpm type-check && pnpm test` — confirm no regression |

Net change: ~14 LoC YAML net, ~50 LoC for the new invariant script, 1 LoC in `package.json`.

## 6. Validation

- **Architecture / engineering standards**: N/A (CI yml + tooling script only).
- **Security**: no change to triggers, permissions, or secret access.
- **Naming**: workflow file unchanged; new script follows the `check-<topic>.mjs` precedent (`check-create-adapter.mjs`, `check-design-tokens.mjs`, `check-migration-timestamps.mjs`).
- **Tests**: the invariant script will be exercised by the next `pnpm lint` run; no separate unit test (consistent with existing invariants).

## 7. Out of scope (deferred)

- Moving any CI job off self-hosted — #557.
- The `find` diagnostic lines currently in test-integration — folded into the split-step cleanup, but the `dist/identifier-mapping/index.js` verify is preserved.
