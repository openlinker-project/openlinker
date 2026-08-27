# Handoff — PrestaShop adapter performance campaign (#2489)

Everything needed to re-run, extend or challenge the measurements. Self-contained.

## 1. What the campaign was for

Issue #2489 proposes a dedicated PrestaShop PHP module (reviewer estimate
352–576 person-days) to cut the request load OpenLinker puts on a shop. Its
acceptance criterion 10 requires a before/after performance comparison. The
"before" is unrecoverable once the adapter changes, so it was measured first;
then three adapter changes were made and the same measurements retaken.

## 2. Environment

| | |
|---|---|
| Compose project | `ol-demo-fresh` |
| Worktree | `/home/nor/projekty/blocky/openlinker-pnpm-10/.worktrees/2489-baseline` |
| Branches (pushed, **no PR**) | `2489-prestashop-baseline` (measurement + harness), `2489-etap0` (the fix, contains the first) |
| Ports | web 8090, api 3000, PrestaShop 8080, WooCommerce 8082, phpMyAdmin 8081 |
| OL login | `admin` / `admin` → `POST /v1/auth/login` |
| PrestaShop connection id | `44bb1f3f-17ae-4038-ab48-413ce54a71c7` |
| WooCommerce connection id | `ddb3072f-0b22-4906-8e9e-0cc626689744` (normally `disabled`) |
| PS webservice key | `E2E1689STALEOFFERPAUSEKEY0000001` |
| Catalogue under test | 10 000 products / 30 000 combinations, all `reference LIKE 'PERFBASE-%'` |

**Every `docker compose` call needs**
`--env-file /home/nor/projekty/blocky/openlinker-demo-fresh/.env`
(without it compose picks another stack's env: different ports, different
credential-encryption key).

The compose project directory the stack was originally created from no longer
exists, so containers are managed with plain `docker start` / `docker run`, not
`docker compose`.

## 3. The instrument

PrestaShop's own Apache access log. This image symlinks
`/var/log/apache2/access.log -> /dev/stdout`, so it is read with
`docker logs ol-demo-fresh-prestashop`. Counting on the shop's side means no
OpenLinker-side counter can bias the result.

Two things are always filtered out: the container healthcheck (a loopback
`GET /` every ~30 s from `127.0.0.1`) and everything outside `/api/`.

## 4. The tests

| # | What it measures | Script |
|---|---|---|
| A0 | Stack verification + the `sync_jobs` backlog counted before purging | manual SQL, see §6 |
| A1a | Requests per SKU for one catalogue sweep tick | `run-a1a.sh [runs]` |
| A1b | Full-catalogue cycle time (**COMPUTED** from A1a + measured rate) | arithmetic, see `results-A` |
| A2 | Whether the storefront slows down under sync | `run-a2.sh` |
| A3 | Requests per stock position for one inventory sweep tick | `run-a3.sh [runs]` |
| A4 | Requests for one eight-line order | `run-a4.sh <orderId> <label>` + `make-8line-order.sh` |
| A6 | The denominator behind the adapter-build overhead | derived from an A1a window |
| control | Baseline re-taken on pristine code, to separate code from environment | `run-a1a.sh` on a container built from the unmodified image |
| bulk floor | What the same data costs through the stock webservice | manual `curl`, see §7 |

Supporting: `seed-products.sh` (seed the catalogue), `cleanup-products.sh`
(remove it, both sides), `analyze-log.py` (turn a log window into counts),
`slice-window.py` (cut a capture to one run's window), `storefront-probe.sh`
(latency percentiles).

## 5. How to run

```bash
cd <worktree>/perf/prestashop-baseline

# once, if the catalogue is not seeded
./seed-products.sh 10000

# catalogue cost per SKU, 3 runs (run 1 is cold and discarded)
./run-a1a.sh 3

# inventory cost per position
./run-a3.sh 3

# storefront A/B — MUST run at default lane caps, concurrency is the subject
WORKER_CONTAINER=ol-demo-fresh-worker ./run-a2.sh

# order path
./make-8line-order.sh          # prints the new internal order id
./run-a4.sh <internalOrderId> a4-label
```

Results land in `./results/<label>.{summary.txt,access.log}`. Reports:
`results-A-2026-08-27.md` (baseline), `results-B-2026-08-27.md` (after the fix).

`LABEL_PREFIX=b-` distinguishes a post-fix run from a baseline one.

## 6. A0 — the two queries worth running before any measurement

```sql
-- backlog, counted BEFORE purging: it is a finding, not noise
SELECT status, "jobType", COUNT(*), MIN("createdAt")::date
FROM sync_jobs WHERE "connectionId" = '44bb1f3f-17ae-4038-ab48-413ce54a71c7'
GROUP BY 1,2 ORDER BY 3 DESC;

-- then clear it, or it drains into every measured window
DELETE FROM sync_jobs WHERE "connectionId" = '44bb1f3f-17ae-4038-ab48-413ce54a71c7'
  AND status IN ('queued','running','dead');
```

Also verify: the connection's `config.baseUrl` is `http://prestashop` (reachable
from the worker container, unlike `localhost`), the `openlinker` module has files
on disk and not just a `ps_module` row, `OPENLINKER_WEBHOOK_SECRET` is set, and
the webservice key has `specific_prices` permissions.

## 7. Bulk floor — the four-line check

```bash
KEY=E2E1689STALEOFFERPAUSEKEY0000001; B=http://localhost:8080/api
IDS=$(seq 100100 100199 | paste -sd'|')
curl -s "$B/products?ws_key=$KEY&display=full&limit=100" -o /dev/null -w '%{size_download} %{time_total}\n'
curl -s "$B/combinations?ws_key=$KEY&display=full&filter%5Bid_product%5D=%5B$IDS%5D&limit=1000" -o /dev/null -w '%{size_download} %{time_total}\n'
curl -s "$B/stock_availables?ws_key=$KEY&display=full&filter%5Bid_product%5D=%5B$IDS%5D&limit=1000" -o /dev/null -w '%{size_download} %{time_total}\n'
```

Measured: 3 requests, 1.33 MB, 0.38 s for 100 fully hydrated products.

## 8. Traps that cost time — read before starting

1. **`docker logs --since` with a bare timestamp is read as the DAEMON's local
   time, not UTC**, and this container's clock runs 2 h behind the host. The
   first capture covered the whole night. Pass **epoch seconds**, or slice the
   capture on the Apache timestamps with `slice-window.py`.
2. **The scheduler contaminates every window.** `master.product.syncAll` fires
   every 20 min and `master.inventory.syncAll` every 15. Run a
   scheduler-free worker for the campaign:
   ```bash
   docker inspect ol-demo-fresh-worker --format '{{json .Config.Env}}' \
     | python3 -c 'import sys,json;[print(e) for e in json.load(sys.stdin)]' \
     | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION)=' > /tmp/w.env
   echo 'OL_WORKER_ROLE=jobs' >> /tmp/w.env
   docker stop ol-demo-fresh-worker
   docker run -d --name ol-perf-worker --network ol-demo-fresh_default \
     --env-file /tmp/w.env -w /app ol-demo-fresh-worker \
     node apps/worker/dist/apps/worker/src/main.js
   ```
   Undo with `docker rm -f ol-perf-worker && docker start ol-demo-fresh-worker`.
3. **To measure changed code without rebuilding the image**: pull the built
   `dist` of `core`, `shared` and `plugin-sdk` **out of the container** into the
   worktree (`docker cp ol-perf-worker:/app/libs/<p>/dist libs/<p>/dist`) so
   `tsc` resolves, build only the prestashop package, then `docker cp` its
   `dist` files back in and restart.
4. **A probe by hand needs `?ws_key=`, not `curl -u`.** This image does not
   forward the `Authorization` header to PHP, so Basic auth returns
   `Authentication key is empty`.
5. **`pkill -f '<pattern>'` and `ps | grep <pattern> | kill` both kill the shell
   running them**, because the pattern matches your own command line. Match on
   `/proc/<pid>/cmdline` and skip `$$`.
6. **WooCommerce cannot authenticate over plain HTTP.** OL's client sends Basic
   auth only (`woocommerce-http-client.ts:282`) and WooCommerce refuses Basic
   over cleartext. Exercising that path locally needs a TLS reverse proxy plus a
   worker with `NODE_TLS_REJECT_UNAUTHORIZED=0`.
7. **PrestaShop rejects a first name containing a digit** —
   `Property Customer->firstname is not valid`.
8. **PrestaShop / WooCommerce MySQL fall over on OOM (exit 137).** Revive with
   `docker start ol-demo-fresh-mysql ol-demo-fresh-woocommerce-mysql`.

## 9. Headline numbers

| | Baseline | After 3 adapter changes | With realtime lane cap raised |
|---|---:|---:|---:|
| Requests per SKU, catalogue | 7.96 | **3.97** | 3.97 |
| `GET /products/<id>` per product | 3.00 | **1.00** | 1.00 |
| Requests per stock position | 3.00 | **1.00** | 1.00 |
| Requests per 8-line order | 29 | 27 | 27 |
| Sustained rate | ~50/min | ~50/min | **~277/min** |
| Storefront p95 ratio | 0.989 | 1.005 | **0.995** |
| *COMPUTED* 10 000-SKU cycle | ~26.5 h | **~13.2 h** | **~2.4 h** |
| Bulk floor, same data via webservice | — | — | **3 requests / 0.38 s per 100** |

Control: pristine code re-measured after every environment change gave 799
requests and 975 s against the original 796 / 977 — the drop is the code.

## 10. Open items

* Removing the per-line `specific_prices` pin+unpin is worth **16 of 27**
  requests on an eight-line order. Not implemented; needs no new module
  endpoint, only the line price travelling in the payload the OL module already
  receives.
* `PrestashopProductMasterAdapter.getProducts` (`:305`, `display=full`) exists
  and its only caller in the repository is `searchProducts` in the same file.
  Wiring it into the sweep needs two fixes first: `filter[id]` is joined with a
  comma and PrestaShop reads `[a,b,c]` as a **range** (measured: 1 row returned
  versus 3 with pipes), and no `sort` parameter is emitted at all.
* Every first dispatch of a fresh WooCommerce-sourced order failed on a customer
  mapping conflict, twice out of two. Cause not established.
* The functional half of the module proposal — returns, partial cancellation,
  cash on delivery, buyer tax id, whole-order discount, bundles, one-way
  multilingual, and acceptance criteria 5–7 — is untouched by any of this and no
  measurement settles it.

## 11. Stack state as handed over

Restored: stock worker, no helper containers, PrestaShop connection without the
test `rateLimit`, WooCommerce connection back to `disabled` with its original
`siteUrl`.

Left in place deliberately: the 10 000 `PERFBASE-` products (run
`./cleanup-products.sh` when done), WooCommerce orders 20 and 21, PrestaShop
orders #11 and #12 — those four are the order-path evidence. The full list of
what the campaign changed and how to undo each item is in `README.md`.
