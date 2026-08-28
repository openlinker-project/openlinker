# PrestaShop adapter baseline (issue #2489)

Measures what one OpenLinker sync actually costs the shop, counted on the
**shop's side** rather than by any counter OpenLinker keeps about itself.
Nothing here changes product code; it is a measurement harness plus the
synthetic catalogue it needs.

## Why the shop's own log

The bitnami/Debian PrestaShop image symlinks
`/var/log/apache2/access.log -> /dev/stdout`, so every webservice request the
adapter makes lands in `docker logs <prestashop container>`. That is the
instrument: it cannot be biased by an OpenLinker-side counter, and
`--since <timestamp>` gives an exact window per run.

Two things must be filtered out of any window:

* the container healthcheck, a `GET /` every ~30 s from `127.0.0.1`;
* anything outside `/api/`, i.e. storefront traffic.

`analyze-log.py` does both.

## Scripts

| Script | What it does |
|---|---|
| `seed-products.sh [count]` | Clones a multi-variant template product `count` times directly in MySQL (default 10000, 3 combinations each). Every row is tagged `PERFBASE-`. |
| `cleanup-products.sh [--dry-run]` | Deletes everything tagged `PERFBASE-`, on both the PrestaShop and the OpenLinker side. Matches on the prefix only, so it cannot touch demo data. |
| `run-scenario.sh <jobType> [label]` | Enqueues one sync job, waits for the connection's queue to drain, then dumps and analyses the shop's access log for that window. The generic runner the four scenario scripts below specialise. |
| `run-a1a.sh [runs]` | A1a: cost per SKU for a catalogue sweep tick, repeated (default 3 runs, run 1 is the cold run and is discarded). Clears the sweep cursor and the queue before each run. |
| `run-a2.sh` | A2: does the shop slow down. Drives the storefront at 2 req/s through an idle / sweep-running / idle sandwich and reports `p95(load) / p95(idle)`. The result is the ratio; the absolute p95 is a property of the machine. |
| `run-a3.sh [runs]` | A3: the same as A1a for the inventory sweep (`master.inventory.syncAll`). |
| `run-a4.sh <internalOrderId> <label>` | A4: what one order dispatch costs. Counts the OL module's own front controllers too, which do not live under `/api/` and are invisible to the catalogue analyser. |
| `make-8line-order.sh` | Builds the eight-line order A4 needs, on the one `OrderSource` on this stack that can create a multi-line order programmatically. |
| `storefront-probe.sh <seconds> <label>` | Samples storefront response time and prints median / p95 / max. The load generator A2 drives. |
| `run-a4-ingest.sh <srcConn> <externalOrderId> [label]` | A4 driven by INGESTING the order instead of retrying a failed destination entry. `run-a4.sh`'s retry endpoint answers 404 unless that entry is already `failed`, whereas a freshly ingested order auto-dispatches - and that first dispatch is the event worth counting. Verifies a NEW shop order id, so a re-attach cannot be recorded as a create. |
| `analyze-log.py` | Turns an access-log window into per-resource counts, the per-product re-fetch distribution, and a requests-per-minute profile. |
| `slice-window.py` | Cuts an access log down to one window on the shop's own Apache timestamps, for re-analysing a saved log after the fact. |

## Configuration

Every script reads its stack from the environment and falls back to the
`ol-demo-fresh` values the campaign ran on:

| Variable | Default | Note |
|---|---|---|
| `CONNECTION_ID` | the campaign's PrestaShop connection uuid | **Set this.** The default is a uuid from one machine; left alone on any other stack the scripts measure a connection that does not exist. |
| `PURGE_QUEUE` | unset | **Set to `1` to allow a run.** `run-a1a.sh`, `run-a2.sh`, `run-a3.sh` and `run-a4.sh` delete every `queued`/`running`/`dead` `sync_jobs` row for the connection, because a measured window needs a clean queue. They print the row count and refuse without this opt-in. |
| `API` | `http://localhost:3000` | OpenLinker api |
| `PS_CONTAINER` | `ol-demo-fresh-prestashop` | the shop, whose log is the instrument |
| `PG_CONTAINER` | `ol-demo-fresh-postgres` | OpenLinker's database |
| `MYSQL_CONTAINER` | `ol-demo-fresh-mysql` | the shop's database, written directly by `seed-products.sh` / `cleanup-products.sh` |
| `PS_DB` | `prestashop` | database name inside `MYSQL_CONTAINER` |
| `WORKER_CONTAINER` | `ol-demo-fresh-worker` | the container A2 stops and starts. **The default does not reproduce the campaign.** The campaign ran a separate `ol-perf-worker` carrying `OL_WORKER_ROLE=jobs` so no cron tick could enqueue into a measured window; the default is the stock all-roles worker, whose ticks are exactly the contamination the Traps section warns about. Point this at a jobs-only worker before quoting a number. |
| `TEMPLATE_ID` | `22` | the PrestaShop product `seed-products.sh` clones. **The most machine-specific value here after `CONNECTION_ID`.** On a stack where product 22 is not multi-variant the seed silently inserts fewer combinations than intended, and per-SKU figures then measure a different shape of product. |
| `SEED_OFFSET` | `0` | Ordinal the generated series starts AFTER. A second generation must not reuse the first's ordinals: `reference` and `ean13` are both derived from it, so seeding 90 000 more at offset 0 mints 10 000 duplicate references and 10 000 duplicate barcodes - and a duplicate barcode is exactly what offer linking refuses to resolve. Set it to the count already seeded. |
| `SWEEP_PAGE_LIMIT` | unset | A2 only. Raises the sweep's page budget so the sweep spans phase B. At the shipped default a tick covers 500 products in ~46 s and leaves most of a phase idle, pulling the ratio toward 1.0 for a reason that has nothing to do with the shop. |
| `FORCE_SEED` | unset | `seed-products.sh` refuses to run when `PERFBASE-` products already exist, because a second generation under the same prefix stops the prefix identifying one seeded set. Set to `1` only if a second generation really is wanted. |
| `SRC_ORDER` | an order id from one machine | `make-8line-order.sh` copies this order's customer and snapshot. **Set this**; the default exists on no other stack. |
| `PHASE_SECS` | `180` | length of each of A2's three phases, in seconds |
| `INFLIGHT_MIN` | `10` | in-flight children A2 waits for before it calls phase B loaded. A store with fewer syncable products than this can never reach the threshold, so A2 now fails with a message instead of waiting forever. |
| `INFLIGHT_WAIT_SECS` / `API_WAIT_SECS` | `300` / `180` | bounds on A2's two waits |
| `WAIT_SECS` | `900` | bound on `run-a4.sh`'s wait for the order to dispatch and the queue to drain |
| `IDLE_TICKS` / `POLL_SECS` | `6` / `5` | `run-scenario.sh` calls the queue drained after `IDLE_TICKS` consecutive quiet polls, `POLL_SECS` apart. Also the granularity of every `elapsed_seconds` figure. |
| `RUNS` (first positional arg) | `3` | repeats in `run-a1a.sh` / `run-a3.sh`; run 1 is the cold run and is discarded |
| `LABEL_PREFIX` | empty | prepended to every output label, to keep two campaigns' results apart |
| `URL` | `http://localhost:8080/` | storefront page the probe fetches |
| `OL_ADMIN_USER` / `OL_ADMIN_PASSWORD` | `admin` / `admin` | only the demo stack's well-known defaults; no real credential is committed here |
| `OUT` | `./results` | where output lands (git-ignored) |

## Reports

| File | What it holds |
|---|---|
| `results-2026-08-27.md` | The first pass: a cold, partly contaminated window. Superseded by stage A, kept because it is where the three hypotheses were first answered. |
| `results-A-2026-08-27.md` | **Baseline.** Pre-fix code, six scenarios, median of runs 2 and 3. |
| `results-B-2026-08-27.md` | **After the adapter fix**, same catalogue, same instrument, same repeat counts, plus the control run that isolates code from environment and the raised-throughput re-measurement. |
| `results-C-2026-08-27.md` | **After epic #2590** (#2625), same catalogue and instrument. Also the first store-impact figure taken with the status-code-checking probe, which corrects the sub-1.0 p95 ratios in A and B. |
| `results-D-2026-08-28.md` | **At 100 000 products** (#2644). A different question from C: whether the epic's bounds still hold an order of magnitude above the catalogue they were sized against. |

Every figure names its method and its repeat count where it is stated. A figure
that was not measured is labelled either *derived* (arithmetic on a measured
window, e.g. removing the duplicate reads from a counted total) or
*extrapolation* (a 10 000-product number reached from a 100-product tick,
because one sweep tick is budgeted at 100 products). Nothing unlabelled is
anything but a count.

## Running it

```bash
./seed-products.sh 10000
./run-scenario.sh master.product.syncAll   run1
./run-scenario.sh master.inventory.syncAll run1-inv

# The scenario runners purge the connection's queue, so they need the opt-in:
CONNECTION_ID=<uuid> WORKER_CONTAINER=<jobs-only worker> PURGE_QUEUE=1 ./run-a1a.sh 3
```

Results land in `./results/<label>.{summary.txt,access.log,enqueue.json}`.

## Traps

* **The demo stack's queue is not empty.** A stale backlog (this machine had
  ~15 000 queued jobs from days when the worker was down) will drain into the
  same access-log window and make the numbers unreadable. Purge
  `sync_jobs` rows for the connection in `queued`/`dead` before measuring.
* **The scheduler keeps ticking.** `master.product.syncAll` fires every 20 min
  and `master.inventory.syncAll` every 15 min on their own. A measured window
  can catch one. `run-scenario.sh` reports `jobs_created` and
  `attempts_delta` so contamination is visible; repeat the run if it is.
* **A sweep is budgeted at 100 products per tick**, so one run covers at most
  100 products regardless of catalogue size. Per-SKU figures are therefore
  measured; anything stated for a full 10 000-product cycle is extrapolation
  and is labelled as such in the results.
* **The webservice key must go in the query string** (`?ws_key=...`) when
  probing by hand: this image does not forward the `Authorization` header to
  PHP, so `curl -u` returns "Authentication key is empty".
* **The seeded products are left in place on purpose.** Run
  `cleanup-products.sh` when the measurement campaign is over.
* **Purging the queue is destructive, and it is the method.** Every scenario
  runner deletes the connection's `queued`/`running`/`dead` `sync_jobs` rows,
  because a stale backlog drains into the measured window. On a live connection
  that is real pending work. The runners print the count and refuse without
  `PURGE_QUEUE=1`; read the count before you set it.
* **`elapsed_seconds` is not accurate to the second.** The drain loop sleeps
  before its first check, so every elapsed figure carries at least one
  `POLL_SECS` of systematic upward bias plus `POLL_SECS` of granularity - 5 s
  each at the defaults. The reports quote elapsed to the second (977 s, 590 s,
  471 s) because that is what the script printed; read them as +/- ~5 s, and
  never compare two elapsed figures taken at different `POLL_SECS`.
* **A storefront sample only counts if the shop answered 2xx.** `storefront-probe.sh`
  records the status code alongside the timing, drops non-2xx from the
  percentiles, and exits non-zero if any window recorded one. Without that a
  shop returning fast errors under sync load reads as "unaffected", which would
  invert the A2 conclusion. The measurements already in `results-A` /
  `results-B` were taken before this check existed - see the note in each.
* **Retries pollute a request count.** A retried child job re-issues every
  request it had already made, so a window with a retry in it over-counts.
  Every runner prints `attempts_delta`; anything above one attempt per job
  means throw the run away and repeat it.
* **The first run is not the same code path.** On a cold run the identifier
  mapping does not exist yet, so the sweep takes the create branch and reads
  more than a warm run does. Run 1 is always discarded and the reported figure
  is the median of runs 2 and 3.
* **Worker debug logging inflates OpenLinker-side timings.** The campaign's
  worker logged at `debug` with full response bodies. It does not touch the
  shop-side counts, which are the point, and it sits inside the slack the
  concurrency cap creates, so the elapsed figures were kept and the caveat
  stated rather than quietly dropped (see A0.6 in `results-A`). If you can set
  the level, set it to `log` before measuring elapsed time.
* **Basic auth over plain HTTP, a customer-mapping collision, and a first name
  with a digit** all showed up during the campaign. They are artefacts of this
  test stand, not product defects. They are recorded here so a later reader
  does not file them.

## What this campaign changed on the demo stack

Restore these when the stack is handed back to ordinary use:

| Change | Why | How to undo |
|---|---|---|
| `ol-perf-worker` container replaced `ol-demo-fresh-worker` | it carries `OL_WORKER_ROLE=jobs`, so no cron tick could enqueue into a measured window | `docker stop ol-perf-worker && docker rm ol-perf-worker && docker start ol-demo-fresh-worker` |
| Patched `dist` copied into that container | to measure the fix without rebuilding the image | discarded with the container |
| PrestaShop connection `config.baseUrl` | was `http://localhost:8080`, unreachable from the worker | original value in `results/ORIGINAL_baseUrl.txt` |
| `config.openlinkerCallbackBaseUrl` set to `http://api:3000` | webhook install refuses without it | remove the key if unwanted |
| `openlinker` module files copied into the shop | the `ps_module` row existed with no files on disk | leave — the row was already there |
| `specific_prices` webservice permissions granted | the order path 401'd without them | leave — the order path needs them |
| ~15 000 stale `queued`/`dead` `sync_jobs` purged | they would have drained into every measured window | nothing to undo; the count is recorded in `results-A` |
| 10 000 `PERFBASE-` products seeded | the store had 6, far too few to measure per-SKU cost | `./cleanup-products.sh` |
| One synthetic 8-line order | an attempt at A4 that no supported path can dispatch | `DELETE FROM order_records WHERE "sourceEventId" LIKE 'a4-8line-%'` |


### Additional changes from the A4 (eight-line order) measurement

| Change | Why | How to undo |
|---|---|---|
| WooCommerce containers started | WooCommerce is the only `OrderSource` on this stack that a multi-line order can be created in programmatically | `docker stop ol-demo-fresh-woocommerce ol-demo-fresh-woocommerce-mysql` |
| WooCommerce connection temporarily enabled and repointed at a TLS proxy | OL's WooCommerce client sends Basic auth only, and WooCommerce refuses Basic over cleartext | **already restored** to `disabled` and its original `siteUrl` |
| `ol-wc-tls` nginx TLS proxy container | to give the shop an https origin on the internal network | **already removed** |
| A worker with `NODE_TLS_REJECT_UNAUTHORIZED=0` | to accept the proxy's self-signed certificate | **already removed**; the stock worker is back |
| 8 WooCommerce products `A4LINE-1..8` (ids 12–19) | the order's lines | `wp wc product delete <id> --force` per id |
| WooCommerce order 20 | the eight-line order itself | leave — it is the evidence |
| 8 `identifier_mappings` rows mapping WC ids 12–19 onto `PERFBASE-` internal products | so the order's lines resolved to products that already had PrestaShop mappings | `DELETE FROM identifier_mappings WHERE "connectionId" = '<wc-connection>' AND "entityType" = 'Product' AND "externalId" ~ '^1[2-9]$';` |
| PrestaShop order #11 | created by the measured dispatch | leave — it is the evidence |
| Customer mapping for PrestaShop customer 13 cleared once | a failed first attempt had mapped it to a different internal customer and the conflict guard correctly refused to overwrite | nothing to undo |


### Additional changes from the #2625 / #2644 verification run (2026-08-27/28)

| Change | Why | How to undo |
|---|---|---|
| Three migrations applied to the demo Postgres | the epic adds `lastAttemptDurationMs`, `buyerTaxId`, `deferredTotalMs` | all additive `ADD COLUMN IF NOT EXISTS`; leave them |
| Built `dist` copied into `ol-demo-fresh-api` and a new `ol-perf-worker` | to run the epic branch without rebuilding images | `docker rm -f ol-perf-worker`, then `docker start ol-demo-fresh-worker`; restart the api to restore its image code |
| `product_options` + `product_option_values` granted GET on the webservice key | they were the only two of five referenced resources on the sweep path with no grant, and their absence cost 2 requests per SKU forever | leave - the reads are legitimate and the adapter needs them |
| openlinker shop module upgraded 1.2.0 -> 1.8.0 | the epic's `line_prices` order path only exists from 1.7.0/1.8.0 | leave - it is the version the branch ships |
| `ol-wc-tls` nginx TLS proxy + WooCommerce connection enabled against it | OL's WooCommerce client sends Basic auth only, which WooCommerce refuses over cleartext | `/tmp/2590-a4-teardown.sh`, or `docker rm -f ol-wc-tls` and restore the connection from `results/ORIGINAL_wc_connection_2590.txt` |
| WooCommerce orders 22 and 23; PrestaShop orders 13 and 14 | the A4 evidence | leave - they are the evidence |
| Catalogue seeded 10 000 -> 100 000 `PERFBASE-` products | #2644 | `./cleanup-products.sh` |
| Worker log level lowered in the perf container's compiled `main.js` | `apps/worker/src/main.ts:28` hardcodes `debug`+`verbose` with full response bodies | discarded with the container; no source change was made |

**Note on the module upgrade.** `Module::initUpgradeModule` + `runUpgradeModule()` reported
`available_upgrade => 0` and silently left the DB version at 1.2.0 while the disk said
1.8.0, because `installed_version` came back NULL in a CLI context. The chain was run
explicitly instead. Whether the back-office upgrade path behaves the same was NOT tested,
so this is a CLI-context observation rather than a module defect.

### Additional changes from the raised-throughput A2

| Change | Why | State |
|---|---|---|
| `config.rateLimit` added to the PrestaShop connection | to test whether the declared limit was the ceiling (it was not) | **already removed** |
| Worker with `OL_LANE_REALTIME_CAP=12` / `_SCOPE_CAP=12` | the real ceiling; default is 2 | **already removed** with the container |
| WooCommerce order 21 and PrestaShop order #12 | the second, like-for-like eight-line measurement | leave — they are the evidence |


## Relationship to #1134 (k6 harness)

Scoped apart, not merged. #1134 asks for a k6 scenario set driving OpenLinker's
**own** ingestion path (feed poll to enqueue to worker create) and reporting
OL throughput, queue depth and p95/p99, with upstream call counts per ingested
order across marketplaces.

This harness answers one axis of that question for one platform, and it
deliberately does not use k6: the instrument here is the shop's own Apache
access log, because the whole point was a count OpenLinker cannot bias. k6
measures the caller, and the caller was the suspect.

What this delivers that #1134 also wants:

* upstream request count per SKU and per order, for PrestaShop, counted
  shop-side (A1a, A3, A4);
* a store-impact ratio under sync load (A2);
* the doc you are reading, including how to re-run.

What #1134 still owns after this:

* k6 itself, and any load applied to OL's own HTTP surface;
* the Allegro and WooCommerce sides of the upstream budget;
* queue depth and p95/p99 of the ingestion path as OL sees them, rather than
  as the shop sees them;
* burst behaviour against the hand-rolled retry and backoff in the adapter
  HTTP clients.

## Report set

Read them in order; each states what it did not establish.

| Report | Question it answers |
|---|---|
| `results-A-2026-08-27.md` | pre-change baseline |
| `results-B-2026-08-27.md` | the adapter fix alone |
| `results-C-2026-08-27.md` | the whole epic against the baseline (#2625) |
| `results-D-2026-08-28.md` | does it hold at 100 000 products (#2644) |
| `results-E-2026-08-28.md` | the epic as it now stands, plus live deletion and the settings (#2657) |
