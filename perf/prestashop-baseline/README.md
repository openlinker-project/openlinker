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
| `run-scenario.sh <jobType> [label]` | Enqueues one sync job, waits for the connection's queue to drain, then dumps and analyses the shop's access log for that window. |
| `analyze-log.py` | Turns an access-log window into per-resource counts, the per-product re-fetch distribution, and a requests-per-minute profile. |

## Running it

```bash
./seed-products.sh 10000
./run-scenario.sh master.product.syncAll   run1
./run-scenario.sh master.inventory.syncAll run1-inv
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

