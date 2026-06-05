# Implementation Plan — #976 Stabilize `@openlinker/integrations-prestashop` Jest suite

> CI/test-infra flakiness only. **No `libs/`/`apps/` runtime code changes.** Test config + test-file split + a docs note.

## 1. Understand the task

**Goal:** Stop the `test` CI job (`pnpm test:ci`, self-hosted runner) from going red on `@openlinker/integrations-prestashop` with **zero actual test failures** — a Jest worker `SIGKILL`/`exitCode=null` (OS OOM-kill) under full-suite parallelism (`pnpm -r` fans every package's Jest out concurrently, each defaulting to ~`cores−1` workers). The Allegro `allegro-http-client.spec.ts` ballooning to ~950 s in the same red runs is the same memory/CPU-starvation symptom.

**Why it matters:** an OOM-killed suite is visually identical to a real test failure → trains everyone to "just re-run" (the #374 silent-failure trap; already flaked #962 and #974 CI).

**Layer:** Test infrastructure (DX). No domain/application/interface code touched.

**Non-goals (out of scope):**
- Migrating prestashop off ts-jest / to another runner.
- The already-fixed `apps/web` Vitest toast flake (#309).
- Reducing the *production* adapter's size/complexity — this is about test execution.
- Reproducing the 20×-green proof locally on Linux (darwin dev box can't OOM-repro the self-hosted Linux runner; the definitive proof is the PR's CI).

## 2. Research (findings)

- `libs/integrations/prestashop/jest.config.mjs` — sets **no** `maxWorkers` / `workerIdleMemoryLimit`. Identical config in `libs/integrations/allegro/jest.config.mjs`.
- `testSequencer: '<rootDir>/test/openlinker.sequencer.cjs'` — minimal deterministic alpha-sort by path; **filename-driven**, so adding split files just re-sorts. No code change needed there.
- Heaviest spec: `src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts` — **2279 lines, 63 `it()`s**, one outer `describe('PrestashopOrderProcessorManagerAdapter')` wrapping **8 nested describes**:

  | Lines | describe | Method area |
  |---|---|---|
  | 204–1114 | `createOrder` | createOrder (≈910 lines, the monster) |
  | 1115–1330 | carrier resolution (#455) | createOrder reads |
  | 1331–1596 | OL module sidecar write (#516) | createOrder reads |
  | 1597–1659 | pickup-point forwarding (#458) | createOrder reads |
  | 1660–1867 | DestinationOptionsReader (#472/#473) | reads |
  | 1868–1943 | order-state override resolution (#862) | createOrder reads |
  | 1944–2138 | `updateFulfillment` (#858) | updateFulfillment |
  | 2139–2279 | `getFulfillmentStatus` (#834) | getFulfillmentStatus |

- **Shared setup** (must be preserved across the split): imports (10–32), constants `OL_DYNAMIC_CARRIER_ID`/`IMPORT_ORDER_STATE_ID` (41–48), `METADATA_INTERNAL_ORDER_ID` (63), `createTestOrder()` builder (65–95, used 24×), `beforeEach` mock/adapter construction (97–176), and `setCreateResourceDispatch()` closure helper (189–202, used 13× — closes over `mockHttpClient` + `mockOpenLinkerModuleClient`).
- Existing shared test infra (reuse, don't recreate): `src/__tests__/mocks/{mock-http-client,mock-identifier-mapping}.factory.ts`, `src/__tests__/fixtures/connection.fixture.ts`.
- `testMatch: ['<rootDir>/src/**/*.spec.ts']` — a non-`.spec.ts` helper module in `__tests__/` is **not** collected as a test. Good: the extracted harness lives in a `.ts` (not `.spec.ts`) file.
- CI: `.github/workflows/ci.yml` `test` job → `pnpm test:ci` = `pnpm -r --filter "./libs/**" build && pnpm -r test`. The `pnpm -r test` fan-out is the cross-package concurrency knob.

## 3. Design

Three layers of fix, smallest blast radius first:

**(A) Per-package worker + memory caps** — the direct OOM lever.
Add to both `libs/integrations/prestashop/jest.config.mjs` and `libs/integrations/allegro/jest.config.mjs`:
```js
maxWorkers: 2,                   // absolute integer, NOT '50%' — the runner's core count is unknown;
                                 // a hard cap is deterministic regardless of runner sizing
workerIdleMemoryLimit: '512MB',  // recycle a worker once its heap crosses the ceiling → kills the unbounded-growth OOM
```
`workerIdleMemoryLimit` is the targeted SIGKILL fix (Jest restarts the worker instead of the OS OOM-killing it); `maxWorkers: 2` caps each heavy package's worker count so cross-package fan-out can't multiply to starvation. **Why an absolute `2` rather than `'50%'`** (tech-review IMPORTANT→accepted as SUGGESTION): `'50%'` is relative to the runner's core count — the very variable this fix is bounding. On a high-core self-hosted runner 50% is still many memory-hungry workers; a hard `2` gives the same memory ceiling on any runner.

**(B) Cross-package fan-out bound in `test:ci`** — `pnpm -r` runs every package's Jest at once; per-package caps don't bound *that* multiplication. Add `--workspace-concurrency` to the `pnpm -r test` in `test:ci`:
```jsonc
"test:ci": "pnpm -r --filter \"./libs/**\" build && pnpm -r --workspace-concurrency=2 test"
```
**Value is `2`, not `4`** (tech-review IMPORTANT): `pnpm config get workspace-concurrency` is unset on the runner, so pnpm falls back to its built-in default of **4** — `--workspace-concurrency=4` would be a no-op and fix (B) inert. The OOM is memory-bound, so the bound must go *below* the default; `2` halves the number of heavy packages' Jests running at once. `2` still parallelises (it doesn't serialise the suite) while leaving memory headroom on the starved runner.

**(C) Split the 2279-line spec** — reduces peak per-worker memory and improves parallelism (4 files spread across workers vs. one giant file pinned to a single worker).

Extract shared setup into a **shared mock-factory module** (placed in the package's existing `src/__tests__/mocks/` home, named `*.factory.ts` to match the established `mock-http-client.factory.ts` convention — **not** `*.harness.ts`, which is the integration-test vocabulary; tech-review IMPORTANT), then split the 8 describes into 4 sibling spec files:

```
src/__tests__/mocks/
└── prestashop-order-processor-manager.factory.ts          ← NEW (not *.spec.ts; sibling of mock-http-client.factory.ts)

src/infrastructure/adapters/__tests__/
├── prestashop-order-processor-manager.create-order.spec.ts        ← describe createOrder (204–1114)
├── prestashop-order-processor-manager.create-order-resolution.spec.ts ← #455 + #516 + #458 + #472/#473 + #862 (1115–1943)
├── prestashop-order-processor-manager.update-fulfillment.spec.ts  ← #858 (1944–2138)
└── prestashop-order-processor-manager.fulfillment-status.spec.ts  ← #834 (2139–2279)
```
*(original `…adapter.spec.ts` is deleted — its content is fully redistributed.)* The factory imports from `../../infrastructure/...` (3 levels — the same `../../../__tests__/mocks/...` depth the existing spec already uses for `mock-http-client.factory`, ESLint-clean).

**Allow-list ownership (BLOCKING fix — see §Backward-compat):** the factory file is the **sole owner** of the `CustomerProjectionRepositoryPort` import (the only deny-pattern cross-context import in the original spec). `scripts/check-cross-context-imports.mjs` must be edited in lockstep: drop the `…/__tests__/prestashop-order-processor-manager.adapter.spec.ts` entry, add `…/src/__tests__/mocks/prestashop-order-processor-manager.factory.ts → new Set(['CustomerProjectionRepositoryPort'])`. The 4 split specs must **not** import that type — they read `mockCustomerProjectionRepository` off the typed harness return with an **inferred** type (no annotation → no import → no allow-list entry).

Factory exports:
```ts
export const OL_DYNAMIC_CARRIER_ID = 99;
export const IMPORT_ORDER_STATE_ID = 2;
export const METADATA_INTERNAL_ORDER_ID = 'ol_order_allegro_abc123';
export function createTestOrder(overrides?: Partial<OrderCreate>): OrderCreate { /* verbatim 65–95 */ }
export interface OrderProcessorHarness { adapter; mockHttpClient; mockIdentifierMapping; mockOrderMapper;
  mockCurrencyResolver; mockTaxRateResolver; mockCustomerProjectionRepository; mockCustomerProvisioner;
  mockAddressProvisioner; mockOpenLinkerModuleClient; connection;
  setCreateResourceDispatch(cart: unknown, order: unknown): void; }
export function createOrderProcessorManagerHarness(): OrderProcessorHarness { /* verbatim 97–202, returns the bag */ }
```
Each split file:
```ts
let h: OrderProcessorHarness;
let adapter: PrestashopOrderProcessorManagerAdapter;
let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
// …same local lets as the area uses…
let mockCustomerProjectionRepository: OrderProcessorHarness['mockCustomerProjectionRepository']; // inferred — NO CustomerProjectionRepositoryPort import
let setCreateResourceDispatch: OrderProcessorHarness['setCreateResourceDispatch'];
beforeEach(() => { h = createOrderProcessorManagerHarness();
  ({ adapter, mockHttpClient, /* … */, setCreateResourceDispatch } = h); });
describe('PrestashopOrderProcessorManagerAdapter — <area>', () => { /* describe bodies copied VERBATIM */ });
```
Because local var names match the originals, each describe body is copied **verbatim** — no body rewrites, only the per-file `let`/`beforeEach` preamble changes. This is the low-risk way to move 2279 lines.

**Closed set of cross-referenced symbols** (tech-review SUGGESTION — anything outside this set in a describe body is a copy break, not a verbatim move): the ten mock `let`s (`mockHttpClient`, `mockIdentifierMapping`, `mockOrderMapper`, `mockCurrencyResolver`, `mockTaxRateResolver`, `mockCustomerProjectionRepository`, `mockCustomerProvisioner`, `mockAddressProvisioner`, `mockOpenLinkerModuleClient`), `adapter`, `connection`, the three constants (`OL_DYNAMIC_CARRIER_ID`, `IMPORT_ORDER_STATE_ID`, `METADATA_INTERNAL_ORDER_ID`), and the two helpers (`createTestOrder`, `setCreateResourceDispatch`). All are provided by the factory.

## 4. Step-by-step

1. **Baseline** — `pnpm --filter @openlinker/integrations-prestashop test` green; record the suite's total test count (**expected 63** in the order-processor spec; capture the package-wide total too). `--logHeapUsage` to capture pre-change peak per-worker heap. Also capture the **allegro** suite wall-time as a baseline (tech-review SUGGESTION — confirm the cap doesn't trade an OOM for a timeout). AC: baselines captured.
2. **(A)** Add `maxWorkers: 2` + `workerIdleMemoryLimit: '512MB'` to prestashop + allegro `jest.config.mjs`. AC: both suites still green; `--logHeapUsage` shows workers recycle, no monotonic growth; allegro wall-time not materially worse than baseline.
3. **(B)** Add `--workspace-concurrency=2` to the `pnpm -r test` in `test:ci`. AC: `pnpm test:ci` runs and is green locally.
4. **(C1)** Create `src/__tests__/mocks/prestashop-order-processor-manager.factory.ts` (extract lines 41–202 verbatim into exports; sole owner of the `CustomerProjectionRepositoryPort` import). AC: type-checks; not matched by `testMatch`.
5. **(C1b)** Edit `scripts/check-cross-context-imports.mjs` ALLOW_LIST: remove the old spec entry, add the factory-path entry for `CustomerProjectionRepositoryPort`. AC: `node scripts/check-cross-context-imports.mjs` passes.
6. **(C2)** Create the 4 split spec files; copy each describe body verbatim under the factory-backed preamble; specs use inferred types for the repo-port mock (no `CustomerProjectionRepositoryPort` import). AC: each file type-checks and runs in isolation.
7. **(C3)** Delete the original 2279-line spec. AC: `git status` shows it removed.
8. **Verify count** — `pnpm --filter @openlinker/integrations-prestashop test` reports the **same** total test count as step 1 (Σ across the 4 split files = 63 for the order-processor area; package total unchanged); sequencer still resolves. AC: count unchanged, green.
9. **Repeat-run** — run the prestashop suite ~10× locally (heap-logged) to confirm no growth/`SIGKILL`. AC: 10/10 green locally (the 20× CI proof is the PR).
10. **Docs** — add a `### Unit Tests` → "Red suite with `SIGKILL` / `worker terminated` (OOM, not a failure)" entry to `docs/testing-guide.md` Troubleshooting: explains the cause, the worker/memory caps, the `--workspace-concurrency=2` lever (and that pnpm's default is 4), and "don't reflexively re-run a red that's actually OOM". AC: section added.
11. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test` green (`pnpm lint` runs `check:invariants`, which includes the cross-context check edited in C1b).

## 5. Validation

- **Architecture/standards:** test-infra only; file headers added to all new files; the shared module follows the established `__tests__/mocks/*.factory.ts` convention (not the integration-test `*.harness.ts` vocabulary); no `any` beyond the existing `as unknown as jest.Mocked<…>` mock idiom already in the file.
- **Invariants:** `check-cross-context-imports.mjs` allow-list is updated in lockstep with the spec→factory move (the factory is the sole owner of the lone deny-pattern import; split specs use inferred types). All other `check:invariants` rules are untouched (no migrations, no service-interface files, no barrels).
- **Testing strategy:** behaviour-preserving — same 63 assertions, verbatim bodies, count-checked against the closed cross-referenced symbol set. No production code touched, so no behaviour change risk.
- **Security:** none (no runtime, no secrets, no I/O).
- **Migrations:** none.

## Resolved decisions (from pre-implement gate + tech-review)

- **Fix B scope:** include the `test:ci` concurrency bound now (user-confirmed). **Value = `2`** — pnpm's default `workspace-concurrency` is 4 and unset on the runner, so `=4` would be inert; the memory-bound OOM requires going below the default.
- **`maxWorkers`:** absolute `2`, not `'50%'` — deterministic across unknown runner core counts.
- **Shared-setup file:** `__tests__/mocks/prestashop-order-processor-manager.factory.ts` (convention-aligned), not `*.harness.ts`.
- **Cross-context invariant:** factory owns the `CustomerProjectionRepositoryPort` import; allow-list updated; split specs import-free for that type.
- **`workerIdleMemoryLimit`:** `512MB` starting ceiling; tunable to `256MB` if the runner is tight — recorded in the docs note.
