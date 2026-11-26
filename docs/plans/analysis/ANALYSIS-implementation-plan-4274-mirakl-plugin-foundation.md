# Pre-implement gate: implementation-plan-4274-mirakl-plugin-foundation

**Plan:** `docs/plans/implementation-plan-4274-mirakl-plugin-foundation.md` · **Issue:** #4274 · **Date:** 2026-11-23

## Verdict: READY (with three warnings to fold in during implementation)

No critical findings:

- The plan changes no existing contract surface. It touches no core barrel, port, DTO, token or ORM entity, and adds no migration.
- It reinvents nothing that would collide.

Three wiring and reuse items are missing from the plan's step list. Each is mechanical and is caught by `check:invariants` if forgotten.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| Mirakl / Empik package, platformType `empik`, adapterKey `empik.mirakl.v1` | NEW (confirmed absent) | No `mirakl` / `'empik'` hit in `libs`, `apps`, `scripts` |
| Package skeleton (package.json, tsconfig(.spec), jest config, plugin, module, factory, types) | **EXISTS → reuse** | `pnpm create-adapter <name>` (`scripts/create-adapter.mjs`, templates in `scripts/create-adapter-templates/`, drift-guarded by `scripts/check-create-adapter.mjs`, CI `scaffold-smoke.yml`). It produces the `createNestAdapterModule` pattern the plan chose. |
| HTTP client | NEW (per-package by convention) | Every integration owns its client (`erli-http-client.ts`, `shoper-http-client.ts`); no shared client to reuse |
| Offset / seek pagination helpers | NEW (per-package) | `libs/integrations/shoper/src/infrastructure/http/shoper-pagination.ts` is Shoper-specific; nothing shared |
| Async import tracker | NEW | No `ImportTracker` / `import_id` handling anywhere in `libs` |
| CSV error-report parser | NEW | `libs/shared/src/csv` is writer-only (`csvCell`, `csvLine`, `csvStream`). Its `csvCell` formula guard must **not** be used for Mirakl import files in #4277, because the files are machine-read. |
| Multipart upload | NEW in integrations | Only `prestashop-webservice.client.ts` builds form data; not reusable |
| Connection tester, validators, classifiers | NEW (per-package, Erli shape) | `libs/integrations/erli/src/infrastructure/adapters/*` |
| `ConnectionTestOutcome` warning value | Not added (plan § 6.2) | `libs/core/src/integrations/domain/types/connection-test.types.ts`: no warning member; correct to defer |
| Capabilities | None declared | `supportedCapabilities: []`; `check-core-capability-mirror.mjs` unaffected |

## Backward-compat / invariant findings

| Severity | Surface | Finding | Fix |
|---|---|---|---|
| Warning | `check-jest-integration-mappers.mjs` | Every package imported by `apps/{api,worker}/src/plugins.ts` needs `^@openlinker/integrations-mirakl$` and `^…/(.*)$` entries in `apps/{api,worker}/test/jest-integration.cjs`. The plan's wiring list (§ 2, § 3.3) omits these two files. | Add both entries, as Erli does at `apps/api/test/jest-integration.cjs:168` |
| Warning | `check-jest-esm-deps.mjs` | The package depends on `@openlinker/shared`, so its `jest.config.mjs` must merge `jest.esm-deps.cjs` | Comes for free when the skeleton is generated with `pnpm create-adapter` |
| Warning | `check-adr-numbers.mjs` | The highest ADR is `085-connection-archive-hook-port.md`, so the new ADR is `086-…` | Use 086 and add it to the ADR index |
| Info | `check-libs-build-scripts.mjs`, `check-workspace-dep-declarations.mjs` | `build` / `lint` / `type-check` / `test` scripts required; every `@openlinker/*` import declared | Scaffolder output satisfies both |
| Info | `check-outbound-http.mjs`, `.eslintrc.js` fetch ban | Listed in the plan § 3.3 | Keep |
| Info | `check-locales.mjs`, `check-ui-vocabulary.mjs` | New `empik` web namespace (en + pl, limits) | Keep |
| Info | ORM / migrations | None | None |

## Open questions

None blocking. Two notes:

- **P41 and PRI02 status vocabulary is only partly observed.** Plan § 3.1 already maps unknown statuses to `pending`, never `done`.
- **The scaffolder names the module file `mirakl-integration.module.ts`.** Exporting `EmpikIntegrationModule` from it, or from a renamed file, is a naming choice. Keep one file per operator module, so a second operator adds a sibling module instead of editing this one.
