# Implementation Plan — Guard jest-integration moduleNameMapper drift (#917)

## 1. Understand the task

**Goal:** Add a durable invariant so a plugin wired into `apps/<app>/src/plugins.ts` cannot be
shipped without a matching `@openlinker/integrations-*` `moduleNameMapper` entry in that app's
`apps/<app>/test/jest-integration.cjs`. The mapper source-maps each integration package to its
`src/`; when it drifts, **every** integration test in a fresh (un-built) worktree fails with
`Cannot find module '@openlinker/integrations-…' from 'src/plugins.ts'` — invisible in CI (which
builds `dist`, so the package resolves via its `main`).

**Layer:** DX / repo tooling. No application code, no schema.

**Why now:** Surfaced twice — #916 (`@openlinker/integrations-inpost` missing from the **API**
config) and #786 (`@openlinker/integrations-ai` missing from the **worker** config). Both were
one-off fixes; this is the durable guard.

**Scope extension (justified):** #917 names only `apps/api`, but the identical drift exists for
`apps/worker` (that's what bit #786). The guard covers **both** apps via a single `APPS` list —
adding a future app is a one-line edit.

**Scope refinement (post tech-review):** the guard ALSO pins a small `REQUIRED_BASE` set —
`@openlinker/core` / `@openlinker/shared` / `@openlinker/plugin-sdk` — that every plugin-loading
app must source-map (AppModule + every plugin pull them in transitively, none ships committed
`dist`). This closes the *other* half of #786 (the worker `plugin-sdk` miss) for ~5 lines. It
surfaced a real latent gap: **`apps/api` did not map `@openlinker/plugin-sdk`** (only worker did,
from #786) — so a fresh api worktree would also break. The fix adds that mapper to the api config
(in scope: same #786 class).

**Non-goals:**
- Not auto-discovering transitive workspace deps beyond `REQUIRED_BASE` (would need full
  import-graph walking) — `REQUIRED_BASE` pins the universally-required foundation; the
  `plugins.ts` scan covers the integration packages that actually drift.
- Not the *reverse* check (extra mappers with no plugin) — extra mappers are harmless.
- Source of truth is `plugins.ts`, NOT `package.json`: apps under-declare their `@openlinker/*`
  deps (worker imports `integrations-allegro`+`integrations-ai` but lists neither), so a
  package.json-based check would miss the exact drift this guard targets.

## 2. Research (findings)

- **Precedent:** `scripts/check-service-interfaces.mjs` and `scripts/check-migration-timestamps.mjs`
  — ESM `.mjs`, header docblock, a **pure** classifier + a filesystem `main()`, a `--self-check`
  mode exercising the pure logic against synthetic inputs, `✓/✗` output, exit 0/1.
- **Wiring:** `package.json` `check:invariants` runs each guard as `node scripts/<x>.mjs
  --self-check && node scripts/<x>.mjs`, and `check:invariants` is chained into `pnpm lint`.
- **Current state (guard must pass on main):**
  - `apps/api/src/plugins.ts` → `prestashop, allegro, ai, inpost`; api jest config maps all four
    (+ `core`, `shared`, `test-kit`). ✓
  - `apps/worker/src/plugins.ts` → `prestashop, allegro, ai`; worker jest config maps all three
    (+ `core`, `shared`, `plugin-sdk`). ✓

## 3. Design

New `scripts/check-jest-integration-mappers.mjs`, pure functions + `main()` + `--self-check`:

- `parsePluginPackages(pluginsTs)` → Set of `@openlinker/integrations-<name>` specifiers from
  `from '…'` clauses (regex; type-only `@openlinker/core/integrations` excluded since it's not
  `integrations-*`).
- `parseMapperPackages(jestCjs)` → Set of `@openlinker/integrations-<name>` packages that have
  **both** a `^<pkg>$` and a `^<pkg>/(.*)$` key (a partial mapping still breaks subpath imports,
  so both are required).
- `findMissing(pluginPkgs, mappedPkgs)` → plugin packages not fully mapped.
- `main()` iterates a top-level `APPS = [{ name, pluginsTs, jestConfig }]` for `api` + `worker`,
  collects `{ app, missingPkg }`, and on any miss prints an actionable message (app + package +
  the exact two mapper lines to add) and exits 1.
- `--self-check` exercises the three pure functions against synthetic strings (no filesystem).

## 4. Step-by-step

1. `scripts/check-jest-integration-mappers.mjs` — new guard (pure fns + `main` + `--self-check`).
2. `package.json` — add `node scripts/check-jest-integration-mappers.mjs --self-check && node
   scripts/check-jest-integration-mappers.mjs` to the `check:invariants` chain.
3. `docs/testing-guide.md` — short note under the integration-jest/harness section documenting the
   guard and how to satisfy it (add both mapper lines when adding a plugin to `plugins.ts`).

**Acceptance criteria** (from #917):
- Forgetting a mapper entry for a plugin in `plugins.ts` fails `pnpm lint` with a message naming
  the missing package (verified by temporarily deleting an entry).
- The guard passes on `main` as-is (api + worker both complete today).
- Documented in `docs/testing-guide.md`.

## 5. Validate

- **Architecture:** tooling-only; no boundary impact.
- **Testing:** `--self-check` covers the parser/diff logic in the unit-gate; a manual
  delete-an-entry run proves the failure path + message; `pnpm lint` proves the green path.
- **Security:** none.
