# Implementation plan - epic #2590 verification and 100 000-product study (#2625 + #2644)

## 1. Task

Two measurement runs against `epic/2590-prestashop-no-module`. No product code changes.

| Issue | Question | Catalogue |
|---|---|---|
| #2625 | Did the epic's changes help, against the pre-change baseline? | 10 000 products x 3 combinations |
| #2644 | Do the changes still hold an order of magnitude above what they were sized against? | 100 000 products |

A regression found at 100 000 products is a sizing finding, not a failure of #2625's comparison.
Both reports stay valid independently.

**Layer**: DX / measurement. **Non-goals**: no product code, no module PHP, no merge to `main`,
no applying a recommended cap change (#2644 asks for the recommendation, not the change).

## 2. Research findings that change the method

Read from the branch, not assumed:

1. **The per-SKU denominator moved.** #2593 replaced the per-product sweep child with
   `master.product.syncBatch`, one child per PAGE, ids in `payloadJson.externalIds`.
   `BATCHED_SWEEP_BUDGET_DEFAULT = 500` at `SWEEP_BATCH_SIZE_DEFAULT = 100`, so one product
   sweep tick now covers **500** products in 5 children, where the baseline tick covered 100 in
   100 children. Counting children would divide by 5 instead of by 500.
2. **#2594 renamed the sweep-triggered children** to `master.product.syncFromSweep` /
   `master.inventory.syncFromSweep` and moved them from the `realtime` lane to `bulk`.
   The harness's `product_children` / `stock_children` queries named only the old types and
   would have reported 0. Patched in place (harness bug against the code under test).
3. **Three migrations, not the two the epic body states** - `lastAttemptDurationMs`,
   `buyerTaxId`, `deferredTotalMs`. All additive `ADD COLUMN IF NOT EXISTS`.
4. **Trap 3 is still live**: `apps/worker/src/main.ts:28` hardcodes
   `logger: ['error','warn','log','debug','verbose']`, with full response bodies. Lowered in the
   perf worker's COMPILED copy only, so no product code changes and the report says so.
5. **`sync_jobs` payload column is `payloadJson`**, not `payload`.

## 3. Method

Instrument: PrestaShop's own Apache access log (`docker logs`), filtered of `127.0.0.1`
healthchecks and non-`/api/` traffic. Not an OpenLinker-side counter.

- Every figure: median of runs 2-4 of four runs, run 1 discarded as the cold/create-branch path.
- `attempts_delta` checked after every run; anything above one attempt per job means repeat.
- Jobs-only worker (`OL_WORKER_ROLE=jobs`), so no cron tick can enqueue into a measured window.
- Store impact measured with the status-code-checking probe. This is the first run whose
  store-impact figures can claim the shop served correct pages.
- Numbers labelled **measured**, **derived**, or **extrapolated**. Machine and worker replica
  count recorded beside every figure.

## 4. Steps

| # | Step | Output |
|---|---|---|
| 1 | A0: record backlog + arrival/drain before any purge | `results/A0-2590.txt` |
| 2 | Build epic code, run 3 migrations, swap `dist` into api + worker | stand on epic code |
| 3 | A1a x4: requests per SKU, catalogue sweep | `results/c-a1a-run*.summary.txt` |
| 4 | A3 x4: requests per stock position | `results/c-a3-run*.summary.txt` |
| 5 | A2: storefront p95 ratio under sweep, fixed probe | `results/c-a2*` |
| 6 | A4: 8-line order request count, two fresh creates | `results/c-a4*` |
| 7 | Control run on pristine code under final stand conditions | isolates code from environment |
| 8 | Playwright golden path | `apps/e2e` |
| 9 | Seed to 100 000, re-run 3-5, probe the eight #2644 bounds | second report |
| 10 | Two `results-*.md` reports, README index, issue comments, correct #2590's two claims | shipped |

## 5. Validation

- No product code touched; `git diff` limited to `perf/**` and `docs/plans/**`.
- Harness patches are test-code fixes for renamed job types, stated in the report.
- Reports carry every unmeasured item with its reason rather than omitting it.
- #2644's cycle-time bound is **derivable, not measurable in one sitting**: 100 000 products at
  a 500-item budget on a 20-minute cron is 200 ticks, ~66 h per cycle. Measured per tick,
  derived for the cycle, labelled.
