# Implementation Plan: `libs/oms` package scaffold + repo-wide walker/lint/composition wiring

**Date**: 2026-08-30
**Status**: Implemented (revised after `/pre-implement` + `/tech-review`)
**Issue**: #2390 (`W3a-1`) — epic #2412 (Wave 3a)
**Branch**: `2390-libs-oms-package-scaffold`, based on `origin/oms-programme-wave-2` (**not** `main`)
**Gate report**: `docs/plans/analysis/ANALYSIS-2390-libs-oms-package-scaffold.md`

---

## 1. Task Summary

**Objective**: create `libs/oms` (`@openlinker/oms`) as a first-class workspace member and register it in every
repo-wide walker, lint scope and composition seam, so that from its first commit the package is subject to the
same contract enforcement every other package is.

**Context**: `@openlinker/oms` is a first-party **product** package beside `libs/core` (DESIGN §9, ADR-055) —
deliberately *not* under `libs/integrations/`, whose `integrations-*` prefix means "an adapter to somebody
else's system" and would collide with a future `integrations-fluent` / `integrations-linnworks`. But every
invariant script and lint scope in this repo enumerates `libs/core/**`, `libs/integrations/**`,
`apps/{api,worker}/**`. A new top-level package that no walker knows about **silently escapes** the
cross-context contract, the deep-import ban and the outbound-HTTP ban. `scripts/check-cross-context-imports.mjs`
is the sharpest case: `importerScope()` returned `null` for any `libs/oms/...` path, so every import in the new
package would have been unchecked with no error and no signal.

**Classification**: **DX** (Shared). No domain logic, no ports, no adapters, no migrations, no schema.

---

## 2. Scope

### Delivered

1. **Package**: `libs/oms/{package.json, tsconfig.json, tsconfig.spec.json, jest.config.mjs, README.md}`,
   `src/{index.ts, oms.module.ts, index.spec.ts}`. Authored to publishing standard (barrel-only `exports`,
   `files` whitelist, `license`, README as product front door) with `"private": true`.
2. **Type resolution**: `tsconfig.base.json` + `apps/api/tsconfig.json` + `apps/worker/tsconfig.json` path pairs.
3. **Walkers / lint**: `check-cross-context-imports.mjs` (`WALKER_ROOTS` + a `kind: 'product'` `importerScope`
   branch + docblock), `check-jest-integration-mappers.mjs` (`REQUIRED_BASE`), `check-outbound-http.mjs`
   (`SCAN_ROOTS`), `.eslintrc.js` (both override blocks), `check-libs-build-scripts.mjs` (widened
   `build` → `{build, lint, type-check, test}`).
4. **New guard**: `scripts/check-no-injection-contracts.mjs` (+ `--self-check`), chained into
   `check:invariants` — see §4.
5. **Composition**: `apps/{api,worker}/src/plugins.ts`, `apps/{api,worker}/package.json` dependency
   declarations, `apps/{api,worker}/test/jest-integration.cjs` mapper pairs, **`Dockerfile` (3 COPY sites)**.
6. **Tests**: `libs/oms/src/index.spec.ts` (barrel smoke), the guard's `--self-check`,
   `apps/worker/test/integration/oms-module-boot.int-spec.ts` (composition boot).
7. **Docs**: `architecture-overview.md` (walker scope + monorepo tree), `engineering-standards.md`
   (alias list, ESLint-blocked scopes ×2), `testing-guide.md` (mapper guard base set).

### Deliberately deferred, with reason

| Item | Deferred to | Why |
|---|---|---|
| `libs/oms/src/migrations` in `plugin-migrations.ts` + `plugin-migration-dirs.json` | #2405 | No #2390 acceptance criterion mentions migrations. ADR-055 makes plugin-shipped migrations *likely*, not *declared*, and an empty registered dir passes forever while asserting a claim nothing checks — a declaration with nothing behind it. |
| `apps/web/src/plugins/oms/` FE contribution | #2405 / #2410 | An `id`-only plugin contributes no route, nav item or namespace, and — unlike `OmsModule` — makes no other registration load-bearing. Purely latent. |
| `src/contract-kit/` placeholder | #2404 | An empty directory plus a README; #2404 creates the directory anyway. |
| root `tsconfig.json` `references` entry | — (never) | `libs/integrations/*`, `libs/plugin-sdk` and `libs/test-kit` are all already absent; non-`apps` library packages stay out. Precedent followed, not an omission. |
| root `jest.config.js` `projects` entry | — (never) | That list is *coverage reporting*, not what CI executes (`pnpm test:ci` is `pnpm -r test`). `plugin-sdk`/`test-kit` already absent. |
| `.github/workflows/scaffold-smoke.yml` `paths:` | — (never) | Filtered to the adapter scaffolder's inputs; the scaffolder templates do not depend on `libs/oms`. |

The rule separating the kept from the deferred, and worth stating because it generalises:
**a prohibition is honest when it has no subject; a declaration is not.** The bare-`fetch` ban and the
outbound-HTTP scan are prohibitions — true whether or not code exists, and adding them before the code is the
only moment they are free. An empty migrations registration and an `id`-only FE plugin are declarations.

### Out of Scope (owned by named siblings)

`CoreCapabilityValues` 10 → 13 and its three mirrors (**#2403** — untouched here); `createOmsPlugin`, the
credential-less connection, `requiresCredentials` (**#2405**); the port-contract test kit (**#2404**); the
`fulfillment` core context and everything on it (**#2391** onward).

---

## 3. Architecture Mapping

`libs/oms` is an **integration-shaped consumer of core**: it will implement core-defined capability ports and be
resolved through the same `getCapabilityAdapter` path as any vendor, with the only asymmetry below the port line
(ADR-055). It therefore gets no privileged path into core and is constrained **exactly like a plugin** —
barrel-only imports, no deep paths, no `orm-entities`, no `*.tokens`. It is not *placed* under
`libs/integrations/` purely for the naming reason above; the no-privileged-path claim rests on the resolution
mechanism, not the directory.

| Walker | Treatment | Why |
|---|---|---|
| `check-cross-context-imports.mjs` | new `kind: 'product'` scope, **no same-context skip** | no counterpart core context, so every `@openlinker/core/<ctx>` import is cross-context |
| `.eslintrc.js` (both blocks) | added to the existing `files` arrays | identical constraint set; a sibling block would be a second copy that can drift |
| `check-outbound-http.mjs` | added to `SCAN_ROOTS` | turns the DESIGN §9 "no HTTP" *assumption* into an enforced fact |
| `check-workspace-dep-declarations.mjs` | **auto** | `WORKSPACE_PARENTS` includes `libs` |
| `check-libs-build-scripts.mjs` | **auto**, and widened | see §2 item 3 |
| `smart-test.mjs` | **auto** | derives `libs/<name>` |
| `tsconfig.eslint.json` | **auto** | `include: ["libs/**/*.ts"]` is a glob — no silent-unlint gap |
| `barrel-purity.spec.ts` | **n/a** | scoped to `libs/core/src/**`; `libs/oms` is a separate package guarded by the cross-context walker |

`OmsModule` is an empty NestJS composition seam (the `FxIntegrationModule` precedent: a `PluginEntry` carrying
no manifest and no capability). **It is not decorative** — without a real import of `@openlinker/oms` from
`apps/*`, the jest mappers, the per-app tsconfig paths and the Dockerfile COPYs are unexercised and therefore
unverifiable. That is the argument for keeping it.

---

## 4. The ADR-053 no-injection invariant

Issue #2390's acceptance criterion reads *"Boot int-test asserts the `fulfillment` module graph contains no
`orders`/`inventory` service token"*. **`libs/core/src/fulfillment/` does not exist on this branch** (only
`fulfillment-authority`, the ADR-053 vocabulary leaf) and has zero importers; the context is created by
**#2391**. The criterion is unsatisfiable here, and each way of appearing to satisfy it is worse than saying so:
writing the test against `fulfillment-authority` passes while proving nothing; a skipped test is the #2673
"pending reads as pass" shape; creating a stub context collides with #2391.

**`libs/oms` cannot be the subject either** — this was the review's BLOCKING finding. ADR-053 constrains a
**core context**; ADR-055 explicitly designs `libs/oms` to *receive* those services
(`createOmsPlugin({inventoryQuery, orderRecords, products, shipping, mappingConfig})`, all `I*Service`).
Registering `libs/oms` here would forbid what the design of record mandates and #2405 would delete it.

**Resolution (option A):** `scripts/check-no-injection-contracts.mjs` ships as a **prohibition** with three
total rules and no live subject:

- **R1** — a directory in `WATCHED_CONTEXTS` that *exists* must be registered in `NO_INJECTION_CONTRACTS`.
  `libs/core/src/fulfillment` is watched from this commit.
- **R2** — a registered contract must declare a **non-empty** `forbidden` list. This exists because the cheapest
  way to green R1 is `forbidden: []` — registered, asserting nothing, the exact shape the guard prevents.
- **R3** — within a registered directory, no file may import a forbidden specifier. Matching is on the **exact**
  specifier, so `@openlinker/core/orders/types` — the escape hatch ADR-053 itself names — is allowed.

`NO_INJECTION_CONTRACTS` is **empty today**, deliberately. The guard's claim is true now, fails closed, and arms
itself the moment #2391 creates that directory; a guard added *after* the context exists is one someone has to
remember to add.

**Stated limits, in the docblock:** a source-text scan cannot see `ModuleRef.get(TOKEN, { strict: false })`, and
that idiom is already established here (`InvoiceService` uses it to avoid a module cycle). This guard is the
**necessary-but-insufficient** half; #2391's boot test against the real container is the complement. It shells
out to no `git`, so the #1020 self-hosted-runner caveat does not apply — stated because neighbouring scripts all
say so and silence would read as an oversight.

**The boot int-test asserts none of this.** Its live, non-vacuous claim is that `OmsModule` composes and boots
in the real container as a member of `workerPlugins`, which exercises the mapper pair, the tsconfig paths and
module resolution of a brand-new package end to end.

---

## 5. Testing & Verification

### Red-first evidence (a guard nobody has seen fail is a claim)

| # | Temporary edit | Guard | Observed |
|---|---|---|---|
| R1 | deep `@openlinker/core/orders/domain/…` import in `libs/oms` | ESLint Block A + cross-context walker | §7 |
| R2 | `@openlinker/core/orders/orm-entities` import in `libs/oms` | ESLint Block A | §7 |
| R3 | bare `fetch(...)` in `libs/oms/src/index.ts` | `check-outbound-http.mjs` + ESLint | §7 |
| R4 | *(unplanned, real)* `apps/*` importing `@openlinker/oms` undeclared | `check-workspace-dep-declarations.mjs` | **fired during implementation** |
| R5 | delete one of the four new mapper lines | `check-jest-integration-mappers.mjs` | §7 |
| R6 | forbidden barrel import in a registered contract dir | `check-no-injection-contracts.mjs` | **verified red** |
| R7 | `libs/core/src/fulfillment` exists, unregistered | `check-no-injection-contracts.mjs` | **verified red** |
| R7b | same, registered with `forbidden: []` | `check-no-injection-contracts.mjs` | **verified red** |
| R8 | remove `scripts.lint` from `libs/oms/package.json` | `check-libs-build-scripts.mjs` | **verified red** |
| R9 | type error in `libs/oms/src` | package `type-check` / `build` | §7 — proves the config is not zero-input (#2380) |
| R10 | remove `OmsModule` from `workerPlugins` | boot int-spec | §7 |

### Suites
- `libs/oms/src/index.spec.ts` — barrel smoke, so the package's own `pnpm test` is not vacuous.
- `scripts/check-no-injection-contracts.mjs --self-check` — 8 inline-fixture cases covering R1/R2/R3 both ways.
- `apps/worker/test/integration/oms-module-boot.int-spec.ts` — composition boot. Note #786: `apps/worker/test/**`
  is excluded from `pnpm lint` and `pnpm type-check`, so a green gate says nothing about this file.

### Gates
`pnpm lint` · `pnpm type-check` · `pnpm test` · `pnpm test:integration` · `pnpm check:invariants` · a **cold**
`pnpm -r build`. Known pre-existing failures, named and not chased: **#2638** `earliest-order-date` (TZ offset)
and **#2639** `allegro-prestashop-carrier-mapping`. Unit and integration suites are never run concurrently.

`check:invariants` distinct-script count: **34 before → 35 after** (this change adds
`check-no-injection-contracts.mjs`).

---

## 6. Alternatives Considered

**Place the package at `libs/integrations/oms`.** Every walker would cover it for free and this change would be
~10 files shorter. Rejected by ADR-055/DESIGN §9 on naming: `integrations-*` means "an adapter to somebody
else's system" and would collide with a future third-party OMS adapter. The free coverage is exactly what this
issue exists to reproduce deliberately.

**A separate repository.** Rejected in ADR-055: forces publishing `@openlinker/core` during peak port churn and
buys no deployment separation, since the plugin is composed in `apps/*/src/plugins.ts` either way.

**Defer the walker wiring until `libs/oms` has real code (#2405).** Rejected: the window between the directory
existing and the walkers knowing about it is exactly when an unchecked import lands, and `importerScope`
returned `null` *silently* — the gap has no signal.

**Give the no-injection guard a live subject by registering `libs/oms`.** Rejected — see §4; it contradicts
ADR-055.

---

## 7. Results

Gate numbers, the cold-build result and the red-first observations are recorded in the PR/branch report for
this issue rather than duplicated here, since a count in prose goes stale.

---

## Related Documentation

- `docs/plans/analysis/ANALYSIS-2390-libs-oms-package-scaffold.md` — the readiness-gate verdict
- `docs/plans/analysis/DESIGN-oms-authority-model.md` §5, §5.5, §9
- `docs/plans/analysis/REVIEW-oms-authority-model.md` (H2, H7, P9)
- ADR-052 / ADR-053 / ADR-054 / ADR-055 / ADR-062
- `docs/engineering-standards.md` § Import Aliases, § Workspace dependency declarations
- `docs/testing-guide.md` § jest-integration `moduleNameMapper` guard (#917)
