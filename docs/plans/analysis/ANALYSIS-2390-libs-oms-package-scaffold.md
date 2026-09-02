# ANALYSIS — readiness gate for `implementation-plan-libs-oms-package-scaffold.md` (#2390 / `W3a-1`)

**Date**: 2026-08-30
**Gate**: `/pre-implement` (read-only)
**Target**: `docs/plans/implementation-plan-libs-oms-package-scaffold.md`
**Branch**: `2390-libs-oms-package-scaffold` on `origin/oms-programme-wave-2`

## Verdict: **NEEDS-REVISION**

Every mechanical claim the plan rests on is **VERIFIED** against the live tree — none was refuted. The
revision is required because the sweep found **five registration sites the plan (and the issue) do not name**,
one of which is a hard build break, plus documented-contract statements that go stale if left untouched.

---

## 1. Reuse audit (Phase B)

This is a DX scaffold: it introduces no port, service, repository, adapter, DI token, ORM entity, controller,
DTO, event or capability. The reuse audit is therefore about **name and path collisions**, not domain
duplication.

| Plan artifact | Classification | Evidence |
|---|---|---|
| `libs/oms` directory | **NEW (confirmed absent)** | `libs/` holds only `core`, `integrations`, `plugin-sdk`, `shared`, `test-kit` |
| `@openlinker/oms` specifier | **NEW** | repo-wide grep hits **docs only** (DESIGN, REVIEW, ADR-054/055, ADR README, backlog overview, product spec) — zero code/config |
| `OmsModule` / `createOmsPlugin` | **NEW** | zero hits repo-wide (excluding `node_modules`, `dist`) |
| FE plugin `id: 'oms'` | **NEW** | registry ids are prestashop/allegro/dpd/inpost/woocommerce/erli/subiekt/ksef/infakt/eparagony |
| `libs/core/src/fulfillment/` | **ABSENT** (see §5.1) | only `fulfillment-authority` exists; `@openlinker/core/fulfillment` has **zero** importers |
| DI tokens | **NONE ADDED** | correct — no bindings yet; `oms.tokens.ts` arrives with #2405 |

`'openlinker'` occurs as an `AuthorityAnswer.kind` literal in `apps/web/src/features/fulfillment-authority/**`.
Different namespace, no collision — and the plan introduces no `platformType` anyway.

**No reuse collision.**

---

## 2. Verified claims

All nine walker/lint claims **VERIFIED**, with sharpenings the plan must absorb:

| # | Claim | Result | Sharpening |
|---|---|---|---|
| C3 | `importerScope()` returns `null` for `libs/oms/**` | VERIFIED | **Both** `WALKER_ROOTS` *and* `importerScope` must change; `main()` does `if (!myScope) continue;`, so a `WALKER_ROOTS` entry alone still skips every file. The same-context skip applies only to `kind === 'core'`, so any non-core kind is always checked. The docblock is a third, *prose* enumeration. |
| C4 | `check-workspace-dep-declarations.mjs` auto-covers | VERIFIED | A package importing nothing **passes silently** — no "must declare something" assertion. A tsconfig `references` entry without a manifest dep **does** fail. |
| C5 | `check-libs-build-scripts.mjs` hard-fails missing `build` | VERIFIED | A directory with no `package.json` is skipped, so a `.gitkeep`-only dir is safe. |
| C6 | `check-outbound-http.mjs` `SCAN_ROOTS` is hardcoded | VERIFIED | Exactly ten `libs/integrations/*` paths. |
| C7 | `check-jest-integration-mappers.mjs` cannot see `@openlinker/oms` | VERIFIED | Discovery regex matches only `@openlinker/integrations-*`. `pkgToLibSrcDir` maps correctly. **`REQUIRED_BASE` and both `jest-integration.cjs` files must change in the same commit** or the guard fails instantly. |
| C8 | Missing migrations dir = hard fail; empty dir passes | VERIFIED | The failure is a **raw ENOENT stack trace**, not a clean violation message (`readdirSync` at `check-migration-timestamps.mjs:224`, called unguarded, uncaught). Drift check compares sorted arrays. |
| C9 | Two eslint blocks mention `libs/integrations` | VERIFIED | `.eslintrc.js:618` (bare-`fetch` ban) and `:790` (deep-path / `orm-entities` / `*.tokens` ban). No third. |
| — | `tsconfig.eslint.json` reachability | VERIFIED / resolved | `include: ["libs/**/*.ts"]` is a glob — `libs/oms` is type-aware-linted automatically. **No silent-unlint gap.** |
| C12 | FE `id`-only plugin is legal | VERIFIED | `assertUniquePluginInvariants` rule 2 fires only when a `platform` bag is present; `plugin-registry.test.ts` asserts **no duplicate ids** and **no count**. |

---

## 3. Findings requiring plan revision

### CRITICAL-1 — `Dockerfile` is a hard break the plan and the issue both omit

`Dockerfile` enumerates package manifests and dists in **three** places, and its own comment (lines 20-21)
warns *"A new plugin package MUST be added here"*:

| Site | Lines | Required addition |
|---|---|---|
| `base` stage manifest COPYs | 26-43 | `COPY libs/oms/package.json ./libs/oms/` |
| production stage manifest COPYs | 75-93 | same line |
| production stage **dist** COPYs | 111-126 | `COPY --from=base --chown=node:node /app/libs/oms/dist ./libs/oms/dist` |

Once `apps/{api,worker}/src/plugins.ts` imports `@openlinker/oms`, an image built without these fails at
install or at runtime module resolution. `libs/test-kit` is deliberately absent from the dist list (test-only);
`libs/oms` is **runtime**, so it takes the `libs/core` posture, not the `test-kit` one.

`docker-compose.yml:343` bind-mounts `./libs` wholesale — AUTO, no edit. This gap is production-only, which is
exactly why no local gate would have caught it.

### CRITICAL-2 — the plan understates the tsconfig work

- `tsconfig.base.json` paths pair — **in the plan**.
- **`apps/api/tsconfig.json` and `apps/worker/tsconfig.json` `paths`** — *not* in the plan. Both enumerate
  per-package paths and both apps will import `@openlinker/oms`.
- **root `tsconfig.json` `references`** — *not* in the plan. Precedent is mixed (`libs/plugin-sdk` and
  `libs/test-kit` are already absent), so this is a decision to state, not an automatic add.

### IMPORTANT-3 — `lint` / `type-check` / `test` scripts are unguarded

`pnpm -r <script>` **silently no-ops** for a package lacking the script. Only `build` is guarded
(`check-libs-build-scripts.mjs`). A `libs/oms` shipping `build` but not `lint` would be silently unlinted in CI
and every local gate — the precise failure class #2390 exists to close, one level down.

**Verified safe to close now**: all 16 existing `libs/*` and `libs/integrations/*` packages already declare all
four scripts, so extending the existing guard from `build` to `{build, lint, type-check, test}` passes today and
costs one loop. Recommend including it.

### IMPORTANT-4 — documented contracts go stale if untouched

- `docs/architecture-overview.md:1621` states the cross-context walker's scope *by name*, listing what is
  deliberately outside it. Adding `libs/oms` to the walker without amending this sentence makes a documented
  contract wrong.
- `docs/engineering-standards.md:1299` (§ Import Aliases — the alias list) and `:813` (the enumeration of
  ESLint deep-path-blocked scopes) both need `libs/oms`.
- `docs/testing-guide.md` § jest-integration mapper guard (#917) — referenced by the guard script.

### MINOR-1 — decisions to state rather than silently take

- **root `jest.config.js` `projects`** (`apps/api`, `libs/core`, `libs/shared`): a *coverage-reporting* list,
  not what CI executes (`pnpm test:ci` is `pnpm -r test`). `libs/plugin-sdk` / `libs/test-kit` are already
  absent. Recommend **leave**, and say so.
- **`.github/workflows/scaffold-smoke.yml:21-35` `paths:`** — filtered to the adapter scaffolder's inputs. A
  `libs/oms` change will never fire that job, which is correct (the scaffolder templates do not depend on it).
  Recommend **leave**, and say so.
- **`check-outbound-http.mjs` + `.eslintrc.js:618`** are a **pair** and must move together; adding one leaves
  the other's shapes uncovered.

---

## 4. Backward-compatibility checklist

| Surface | Result |
|---|---|
| Top-level barrels | OK — nothing removed or renamed |
| Port signatures | OK — none touched |
| DTO shapes | OK — none touched |
| Symbol tokens | OK — none added or removed |
| ORM schema / migrations | OK — none; an **empty registered** migrations dir is legal, but the directory must exist on disk |
| `check:invariants` rules | WARNING — the change *extends* several scripts and adds one; every extension must be seen red before trust |
| `CoreCapabilityValues` (10) + 3 mirrors | OK — untouched; #2403 owns 10 to 13 |

---

## 5. Open questions carried to `/tech-review`

1. **The plan's BLOCKING-1 stands and is confirmed by this gate**: `libs/core/src/fulfillment/` does not
   exist and has zero importers, so #2390's acceptance criterion *"boot int-test asserts the `fulfillment`
   module graph contains no `orders`/`inventory` service token"* is unsatisfiable as written. The plan's
   conditional-but-total guard (`WATCHED_CONTEXTS`: a watched directory that exists but is unregistered
   hard-fails) is the right shape and has a live in-repo precedent in `check-ui-vocabulary.mjs`. **Report to
   the requester before implementing.**
2. **Is the `OmsModule` boot int-test vacuous today?** An empty module trivially injects nothing — the same
   objection the plan raises against writing the test against `fulfillment-authority`. It must either be
   reframed (its non-vacuous claim today is *"the composition seam boots in both hosts"*) or verified red by
   temporarily adding an `orders` provider. Both, ideally.
3. Root `tsconfig.json` `references` — add, or follow the `plugin-sdk`/`test-kit` precedent of omission?

---

## 6. Required plan edits before implementation

1. Add `Dockerfile` (3 sites) to the file list and to Phase 3. **Highest priority.**
2. Add `apps/{api,worker}/tsconfig.json` paths; state the root `tsconfig.json` references decision.
3. Add the `check-libs-build-scripts.mjs` four-script hardening (verified safe).
4. Add the docs amendments (`architecture-overview.md:1621`, `engineering-standards.md:1299` + `:813`,
   `testing-guide.md`).
5. Record the `jest.config.js` and `scaffold-smoke.yml` **leave** decisions explicitly.
6. Reframe the boot int-test's claim per open question 2, and add its red-first row.
7. Note that `REQUIRED_BASE` and both `jest-integration.cjs` files must change in one commit.
