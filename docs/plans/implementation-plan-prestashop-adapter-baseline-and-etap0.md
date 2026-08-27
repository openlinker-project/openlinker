# Implementation plan — PrestaShop adapter: close the baseline, then fix the adapter (#2489)

**Issue:** #2489 — *[FEATURE] PrestaShop module to better integrate with OpenLinker*
**Branch:** `2489-prestashop-baseline` (stage A) → `2489-etap0` (stage B)
**Classification:** Measurement / DX (stage A) + Integration adapter (stage B)
**Status:** proposed, not started

---

## 1. Goal

Issue #2489 proposes a dedicated PrestaShop PHP module (estimated 352–576 person-days)
to cut the request load OpenLinker puts on a shop. Its acceptance criterion 10 requires a
performance comparison against the current API-based solution. Half of that comparison —
the "before" number — is unrecoverable once the adapter changes, so it is taken first.

A first run already established four facts on a live 10 000-product / 30 000-combination
catalogue, measured from PrestaShop's own Apache access log:

| Finding | Value | Status |
|---|---|---|
| The same product is fetched three times per sync | exactly 3.00 per product | measured |
| Adapter construction re-reads the shop currency | 3.2 requests per product | measured |
| The resolver caches never survive a job | — | confirmed by the code's own docblock |
| Price pinning costs a POST + DELETE per order line | 1 + 1 for a 1-line order | measured + confirmed in code |
| A bulk read of the same data | 3 requests, 0.38 s per 100 products | measured |

Six things remain unmeasured, and they are what block the decision.

**Goal:** close those six, then apply the adapter-side fix on a separate branch and
re-measure, so the decision rests on three real numbers — today, after the fix, and the
bulk floor — rather than one number and two estimates.

**Non-goals:** designing or writing the PHP module; changing the sweep budget, lane caps
or scheduler cadence as a shipped default; touching `libs/core`.

---

## 2. Constraints that shape the method

* **A request count is invariant to concurrency.** It is a pure function of the code path.
  Only wall-clock time scales with how many jobs run at once. Every scenario that measures
  *requests* may therefore run with raised lane caps; every scenario that measures *time* or
  *contention* must run at defaults. This is what makes a 5-hour campaign as defensible as a
  31-hour one, and it is stated in the report rather than left implicit.
* **Cycle time is computed from two measurements, not sampled.**
  `cycleTime = (requestsPerSku × N) ÷ (concurrency ÷ latency)`, where `requestsPerSku`,
  `latency` and the default `concurrency` are each measured. Labelled COMPUTED.
* **The instrument is the shop's own access log** (`docker logs` — the image symlinks
  `access.log → /dev/stdout`), never an OpenLinker-side counter.
* **The demo stack is not clean.** The previous run had to repair five things before
  anything ran. A0 re-verifies them and records the result.

---

## 3. Stage A — six measurements

### A0. Stack verification (20 min)

Verify, and record in the report whether each still holds:

1. `connections.config.baseUrl` for the PrestaShop connection resolves from inside the
   worker container (`http://prestashop`, not `http://localhost:8080`).
2. The `openlinker` module has files on disk, not only a `ps_module` row.
3. `OPENLINKER_WEBHOOK_SECRET` and `OPENLINKER_BASE_URL` are set in `ps_configuration`.
4. The webservice key carries `specific_prices` permissions (GET/POST/PUT/DELETE/HEAD).
5. `sync_jobs` carries no multi-thousand backlog. **Count it before purging**, broken down
   by `jobType` and `status` — the previous run found 15 066 rows from 19–27 Aug, which is
   itself a finding about what saturates, not noise to discard.

Plus one addition, because it falsifies every timing measurement:

6. The worker logs at `debug` with full response bodies. Set the log level to `warn` for
   the campaign and record that it was changed — otherwise a large part of the measured
   time is OpenLinker writing its own logs.

### A1. Catalogue replication cost and cycle time (55 min)

**A1a — cost per SKU (45 min, raised lane caps).**
Clear the `master.product` sweep cursor for the connection, enqueue `master.product.syncAll`
with `payload.pageLimit = 500`, drain, and count from the access log:

* total `/api/` requests, broken down per resource;
* the repeat distribution of `GET /api/products/<id>` (the 3× claim, on a wider sample);
* the count of `/api/configurations` + `/api/currencies` pairs;
* requests per SKU.

Three runs; discard the first (cold PrestaShop cache and InnoDB buffer pool); report the
median of runs 2 and 3. After each run, check that `SUM(attempts)` did not exceed the job
count — a run polluted by retries is repeated and the fact is written down.

**A1b — cycle time (10 min, default caps).**
Measure per-request latency and the effective default concurrency, then compute the full
10 000-SKU cycle time from A1a's cost per SKU. Marked **COMPUTED**, with its inputs shown.

Also record how many scheduler ticks actually fired in the window. Fewer than the cron
implies something blocks them, which is its own finding.

### A2. Does the shop slow down (20 min, DEFAULT caps — non-negotiable)

`storefront-probe.sh` drives the storefront at 2 req/s over localhost only (no tunnel, no
VPN) and reports percentiles. Three phases of 3 minutes: idle → sweep running → idle.

**The result is the ratio p95(B) ÷ p95(A)**, never the absolute p95, which is a property of
this machine and comparable with nothing.

Lane caps stay at their defaults here, because concurrency is the very thing under test.

### A3. Inventory sweep cost (30 min, raised lane caps)

`master.inventory.syncAll`, same method as A1a. Report requests per stock position, split
into `/stock_availables` and `/products/<id>`. The second is the
`throwForAbsentStockRecords` safety probe; report its cost **separately**, because a bulk
variant removes it and the report must say exactly what is being given up. Three runs,
median of 2 and 3.

Already established and carried forward: the guard works (a stock-less product logged
`master_inventory_zero_stock_rows … NOT classified as a deletion` and staled nothing) and
costs exactly one extra request, only on the empty-stock path.

### A4. Eight-line order (45 min, default caps)

Every order on the demo stack has one line, so the per-line effect is visible in its
weakest form. Build one order with eight distinct positions and count **all** of its
requests, including the module front-controller calls that fall outside `/api/`.

Report separately: `POST /specific_prices`, `DELETE /specific_prices`, VAT lookups. Compare
against the measured 1-line order and state the shape as a formula: *k fixed requests plus
m per line*.

One run, not three — the mechanism is already confirmed in the adapter source (an
unconditional `for` loop over `order.items` creating one specific price each, and a
sequential `for` loop deleting them) and observed once live. The repeat count is stated in
the report.

### A6. Resolve the denominator behind "+3.2" (0 min, derived)

The first run reported 3.2 requests **per product**, while the working document said +2 per
**child job**. If one product spawns more than one job these are two different numbers and
the ratio was computed against the wrong denominator. Count child jobs, products and
`/configurations` + `/currencies` pairs in one A1a window and report **both** figures.

### Stage A deliverable

`perf/prestashop-baseline/results-A-<date>.md`, in English, with:

* every number carrying its method and repeat count;
* anything unmeasured written as "not measured" **and why** — never filled with an estimate
  presented as a measurement;
* anything computed rather than measured marked **COMPUTED**;
* any result contradicting the first run stated plainly, not smoothed over.

Committed on `2489-prestashop-baseline` with `git commit -s -S`, explicit paths, no
`git add -A`.

---

## 4. Stage B — the adapter fix, on its own branch

Runs only after stage A is committed. Branch `2489-etap0`, cut from the baseline branch.
**Not to be merged before the numbers are read** — merging it destroys baseline A's meaning.

### B1. Three changes (1 h 15)

**B1.1 — the adapter factory stops being rebuilt on every capability resolution.**
`prestashop-plugin.ts` currently does `new PrestashopAdapterFactory(...)` inside
`createCapabilityAdapter`, so `PrestashopShopCurrencyResolver`, `PrestashopFeatureResolver`
and `PrestashopTaxRateResolver` all lose their caches immediately — the currency resolver's
own docblock says so: *"Every build re-reads regardless of TTL."* Hoist the factory into the
plugin closure so its resolver fields survive across child jobs.
*Precondition to verify first:* the factory must hold no per-connection state.
`createAdapters(connection, …)` takes the connection as a parameter, which suggests it does
not, but this is checked before the change, not assumed.
*Expected effect:* removes most of the 3.2 `/configurations` + `/currencies` requests per
product.

**B1.2 — memoise `GET /api/products/<id>` within one adapter instance.**
The three call sites are `getProduct` (`:187`), `getProductVariants` (`:395`) and
`getProductCategories` (`:699`) — all fetching the same resource. An adapter instance lives
for one capability resolution, i.e. one job, so a per-instance memo is exactly the right
scope: fresh per job, no cross-job staleness.
*Expected effect:* 3.00 → 1.00 product fetches per product.

**B1.3 — set `config.currency` on the connection.**
`prestashop-adapter.factory.ts:139` reads `config.currency ?? <resolver>`, so a configured
value skips the resolver entirely. Configuration change, no code, no risk. Kept as a
separate item because it is the belt to B1.1's braces.

**Dropped, on the evidence:** caching the VAT rate by tax group. The catalogue sweep window
contained **zero** `/api/taxes` and `/api/tax_rules` requests — they appear only on the
order path (2 per order). It is not a catalogue cost, so it does not belong in a change set
justified by catalogue measurements. Reconsider if A4 shows it dominating an 8-line order.

**Architecture note:** B1.1 changes a documented lifetime property that the resolvers'
docblocks explicitly describe. That is an architectural decision with a real trade-off
(cache lifetime versus per-connection isolation), so it carries an ADR — drafted as the
first step of B1, with `Status: Proposed`, and its docblocks updated in the same commit so
the code stops describing behaviour it no longer has.

**Gate:** `pnpm lint` and `pnpm type-check` must pass. `pnpm test` is not run locally on
this machine (see § 6); CI covers it.

### B2. Re-measure (30 min)

Repeat A1a, A3 and A4 **exactly** as specified above — same catalogue, same lane caps, same
repeat counts — plus A2 at default caps.

### Stage B deliverable

`perf/prestashop-baseline/results-B-<date>.md` with one table, number beside number:

| | Baseline A (today) | Baseline B (after the fix) | Bulk floor |
|---|---|---|---|
| requests per SKU | | | measured, 0.03 |
| requests per 8-line order | | | — |
| computed 10 000-SKU cycle time | | | |
| p95(B) ÷ p95(A) | | | — |

Plus the percentage of requests removed. The table is presented without interpretation.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| The scheduler's own ticks contaminate a measured window | `run-scenario.sh` reports `jobs_created` and `attempts_delta`; a contaminated run is repeated and the fact recorded |
| Raised lane caps are read as the measured condition | Every table states the caps in force; A2 runs at defaults and says so |
| Raising concurrency saturates the machine and inflates latency | Latency for the cycle-time computation is measured at default caps, separately from the cost-per-SKU runs |
| Building an 8-line order proves harder than budgeted | The mechanism is already confirmed in source; if the live order cannot be built, A4 is reported as "not measured" with the code-level finding standing in, explicitly labelled |
| B1.1 turns out to hold per-connection state | Checked before the change; if it does, the hoist is abandoned and B1.3 carries the currency saving alone |
| The demo stack breaks mid-campaign (PrestaShop/WooCommerce MySQL OOM, exit 137) | `up -d mysql woocommerce-mysql`; every `docker compose` invocation passes `--env-file …/openlinker-demo-fresh/.env` |

---

## 6. Working constraints

* Resource-constrained machine: no `pnpm test`, no `pnpm test:integration`, no full
  `pnpm build` unless required. Local gate is lint + type-check.
* Extend the existing harness in `perf/prestashop-baseline/`; do not start a second one.
* Never `git add -A` — stage explicit paths. Commits signed (`git commit -s -S`).
* Never `pkill -f '<pattern>'` — the pattern matches the shell running it.
* The 10 000 seeded `PERFBASE-` products stay in place after the campaign;
  `cleanup-products.sh` removes them from both sides when it is over.

---

## 7. Questions and assumptions

* **Assumed:** raising `OL_LANE_*_CAP` does not change requests per SKU. This is the whole
  basis of the 5-hour schedule. It is asserted from the code path being concurrency-independent
  and is **verified in practice** by comparing A1a's cost per SKU against the first run's
  9.6, which was measured at default caps. A divergence invalidates the shortcut and the
  campaign falls back to default caps throughout.
* **Assumed:** one full 10 000-SKU cycle is not measured end to end. The evidence for
  multi-day queue growth is the 15 066-row backlog found in A0, gathered from real operation
  rather than reproduced.
* **Open:** whether `master.product.syncAll` runs in the `bulk` or `fan-out` lane decides
  which cap to raise. Resolved by reading the handler registration at the start of A1a.
