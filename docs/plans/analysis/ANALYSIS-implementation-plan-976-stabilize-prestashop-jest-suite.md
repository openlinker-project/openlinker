# Pre-implement gate — #976 Stabilize prestashop Jest suite

**Plan:** `docs/plans/implementation-plan-976-stabilize-prestashop-jest-suite.md`
**Gate run:** read-only, against the live worktree tree.

## Verdict: `NEEDS-REVISION`

One build-failing omission (an unaccounted-for `check:invariants` rule). Cheap to fix in the plan; not a major rethink. Everything else is `READY`.

## Reuse findings

This is a test-infra plan — it creates **no** ports, services, DI tokens, ORM entities, controllers, DTOs, events, or capabilities. The reuse audit collapses to file/config collisions:

| Plan artifact | Status | Evidence |
|---|---|---|
| `*.harness.ts` filename in the adapter `__tests__/` dir | **NEW (absent)** | dir listing — no `*harness*` present |
| 4 split `*.spec.ts` files | **NEW (absent)** | none of the proposed names exist |
| `maxWorkers` / `workerIdleMemoryLimit` in prestashop+allegro `jest.config.mjs` | **NEW (absent)** | `grep` across `libs/integrations` → no hits |
| `--workspace-concurrency` on `test:ci` | **NEW** | current `test:ci` = `pnpm -r … build && pnpm -r test` (no flag) |
| Shared mocks/fixtures the harness reuses | **ALREADY EXISTS → reuse** | `src/__tests__/mocks/{mock-http-client,mock-identifier-mapping}.factory.ts`, `src/__tests__/fixtures/connection.fixture.ts` — plan reuses, does not recreate |
| Test sequencer | **ALREADY EXISTS → no change** | `test/openlinker.sequencer.cjs` sorts by path (filename-driven); new files just re-sort |

No reinvention. ✅

## Backward-compat findings

| Surface | Finding | Severity |
|---|---|---|
| Barrels / ports / DTOs / Symbol tokens / ORM schema | None touched — no migration needed | — |
| **`check-cross-context-imports.mjs` ALLOW_LIST** | **BREAK.** The original spec imports `CustomerProjectionRepositoryPort` from `@openlinker/core/customers` (line 30) — a `*RepositoryPort` **deny-pattern** cross-context import, currently allow-listed by **exact path** at `scripts/check-cross-context-imports.mjs:321`. The plan deletes that spec and moves the mock setup (incl. this type) into the new `*.harness.ts`. The moved import lands in a file **not** on the allow-list → `check-cross-context-imports.mjs` fails the build (it runs in `pnpm lint` via `check:invariants`). The plan never mentions this file. | **Critical (build-failing)** |
| Stale allow-list entry | The script does **not** `existsSync`-validate allow-list paths (it only counts them — line 574), so the orphaned `:321` entry won't itself fail the build. But it becomes dead config pointing at a deleted file — should be removed for hygiene per the doc's "entries drop when the rewire ships" convention. | Warning |
| Spec deletion references | `grep` for the spec filename across `*.ts/.cjs/.mjs/.json` finds **only** the allow-list entry above — no sequencer hardcode, no coverage manifest, nothing imports a `.spec` file. Safe to delete once the allow-list is updated. | — |

### Required plan revision (single fix, with a design constraint that minimizes churn)

1. **Add `scripts/check-cross-context-imports.mjs` to the plan's touched files.** In the `ALLOW_LIST`: **remove** the `…/__tests__/prestashop-order-processor-manager.adapter.spec.ts` entry and **add** one for the new harness path (`…/__tests__/prestashop-order-processor-manager.harness.ts`) with `new Set(['CustomerProjectionRepositoryPort'])`.
2. **Design constraint that keeps the allow-list change to exactly one entry:** confine the only deny-pattern import (`CustomerProjectionRepositoryPort`) to the **harness file**. The split spec files must obtain `mockCustomerProjectionRepository` via the typed `OrderProcessorHarness` interface (destructure with **inferred** type — no explicit `: jest.Mocked<CustomerProjectionRepositoryPort>` annotation, hence no import) so none of the 4 new specs trip the deny pattern. Verified this is the only deny-pattern import in the file (the other `@openlinker/*` imports — `IdentifierMappingPort`, `OrderCreate`, `IMappingConfigService` — are allowed shapes).

## Open questions

- **OQ (resolved by user):** include fix (B) `--workspace-concurrency=4` now — confirmed in-scope.
- **OQ-2 (non-blocking):** `workerIdleMemoryLimit` ceiling (`512MB` proposed) is a tunable, not a contract; fine to ship and adjust.

## Bottom line

Plan is sound and reuses correctly. The single blocker is the **`check-cross-context-imports.mjs` allow-list** must be updated in lockstep with the spec deletion, and the harness should be the sole owner of the `CustomerProjectionRepositoryPort` import to keep that change to one entry. Fold this into the plan, then implement.
