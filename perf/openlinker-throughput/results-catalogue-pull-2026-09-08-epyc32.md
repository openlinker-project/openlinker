# Catalogue pull - requests per product and wall clock

_Run 2026-09-08 on the `lab` stand, host **`epyc32`** (see
`machine-spec-epyc32-2026-09-08.md`). Branch `perf-programme-2840` @
`4ff884d8e`. Raw artefacts: `results/catalogue-pull-epyc32/`._

> **This is NOT F6.** F6 (#2844, catalogue and inventory sweeps) does not
> exist in this worktree and nothing here pretends to be it. This is a
> purpose-built probe using only shipped pieces: the real
> `master.product.syncAll` sweep, driven through the ordinary
> `POST /v1/sync/jobs`, with `probes/ps-request-mix.sh` (#2840) counting
> PrestaShop's own access log over the window. It therefore has **no
> `lib.sh` guard chain and no `verdict.txt`** - it is a probe, not a
> scenario, and is labelled as such at every point of use.

---

## 1. Conditions

| | |
|---|---|
| Shop catalogue | **506** `ps_product` rows (500 seeded by `seed/seed-shop-catalogue.sh` + 6 fixture), 667 combinations, prices 8.78-2999.56, 7 distinct default categories |
| Referential integrity | 500 of a 500-mapping sample resolve to a real `ps_product` row (the seeder asserts this itself) |
| PrestaShop declared rate limit | `defaultRateLimit: { requestsPerMinute: 300, maxConcurrent: 4 }` (`prestashop-plugin.ts:125`) - the connection sets no override |
| Tax configuration | present, and it matters - see §4 |
| Runner | enabled; scheduler off; queue empty at start |
| Sweep cursor | empty at start, so this was a fresh cycle |

## 2. What the sweep actually did

| | |
|---|---|
| `master.product.syncAll` ticks | 1, succeeded, 931 ms |
| `master.product.syncBatch` children | **5**, all succeeded, mean 395 519 ms each (they overlap) |
| Products touched | **500** |
| Variants touched | **917** |
| Cursor after the run | `29a1d609-...:500` |
| Wall clock | **422 s** |

Both documented constants are confirmed in the field: **5 children x 100
products** is the `syncBatch` page size, and the cursor stopping at offset
**500** is `BATCHED_SWEEP_BUDGET_DEFAULT`. Six products were left for the next
tick, exactly as the budgeted-resumable design intends.

## 3. Requests per product - MEASURED

PrestaShop's own access log over the 422 s window, probe requests excluded
(there were none):

| count | resource | status | per product |
|---:|---|---|---:|
| 1 500 | `GET tax_rules` | 200 | 3.000 |
| 500 | `GET taxes` | 200 | 1.000 |
| 10 | `GET products` | 200 | 0.020 |
| 10 | `GET combinations` | 200 | 0.020 |
| 7 | `GET categories` | **401** | 0.014 |
| 1 | `GET product_option_values` | 200 | 0.002 |
| 1 | `GET product_options` | 200 | 0.002 |
| **2 029** | **total** | | **4.058** |

Three figures, all **measured**, and they must not be collapsed into one:

- **Total: 4.058 requests per product.**
- **Catalogue reads alone: 0.044 requests per product** (the 22
  products/combinations/options requests). This is the batched sweep (#2593)
  working as designed - 500 fully-hydrated products in 20 requests.
- **Tax resolution: 4.000 requests per product** (1 500 + 500), and it is
  **98.6% of the whole pull**.

## 4. The dominant cost is tax resolution, not the catalogue read

The batched sweep has essentially eliminated the catalogue read as a cost
(0.044 req/product). Everything left is per-product tax lookup: exactly
3 `tax_rules` + 1 `taxes` per product, un-batched and evidently un-cached
across products.

**One condition is load-bearing and must travel with this figure:** this
stand had no usable tax rule until this campaign created one (see
`campaign-notes-epyc32-2026-09-08.md` Finding 5 - the fixture ships zero
`ps_tax` / `ps_tax_rule` rows and OpenLinker refused every order until they
existed). So these 2 000 tax requests are the cost of a **correctly
configured** shop. A stand without tax configured would report a much lower
requests-per-product and a much faster pull - while being unable to create a
single order. Any comparison against a figure near 0.058 req/product should
first establish whether that measurement's shop had tax rules at all.

## 5. Wall clock

- **500 products in 422 s** - **measured**.
- **0.844 s per product** - **derived** (422 / 500).
- **100 products in ~84 s** - **derived** by linear scaling. It is not a
  measurement: the smallest unit this sweep will run is a 100-product batch,
  and here five of them overlapped. A single 100-product batch run alone
  would face less self-contention, so ~84 s is more likely an upper bound
  than a lower one. Nothing was run to check that.

### What binds it: the rate limiter, at 96% utilisation

2 029 requests / 422 s = **4.81 requests/second**, against a declared ceiling
of 300/min = 5.00/s. That is **96.2%** of the connection's own limit.

So the catalogue pull on this stand is **rate-limiter-bound, and the limiter
is essentially saturated**. The two consequences are worth stating separately:

- Raising the limit would speed this up almost linearly *until the shop
  itself becomes the constraint* - which this probe did not test.
- Cutting the 4 tax requests per product would cut the pull by ~98% at the
  same limit, because request count and elapsed time are the same quantity
  once the limiter is the ceiling.

## 6. Side effect worth recording

22 `marketplace.offer.updateFields` jobs went **dead** during the window:

    Allegro API error (404): http://allegro-stub:8080/sale/product-offers/perf-allegro-a-offer-1

The local Allegro stub implements the two order-ingestion endpoints and not
`/sale/product-offers/{id}`. These are downstream content-propagation
attempts triggered by the product sync, not part of the catalogue read, and
they consume no PrestaShop budget. They are counted here so the window's job
ledger is fully accounted for rather than partially quoted.

## 7. What this probe did NOT establish

- **A guarded verdict.** No `lib.sh` guard chain ran, so none of the
  attempts/deferrals/requeues/limiter-degradation conditions were checked.
  Treat these figures as a probe result, not as a scenario result.
- **A 100-product measurement.** §5 - it is scaled, not observed.
- **Inventory-sweep cost.** Only `master.product.syncAll` was driven.
  `master.inventory.syncAll` (and #2648's `syncBatch` rung) was not.
- **A full-catalogue cycle.** The budget stopped at 500 of 506 products, by
  design. Nothing here measures how a multi-tick cycle behaves across ticks.
- **Cache behaviour on a second pass.** One cold cycle only. Whether the tax
  lookups would collapse on a repeat run was not tested.
- **Whether the shop is the ceiling.** The limiter was at 96%, so the shop's
  own capacity was never reached.
