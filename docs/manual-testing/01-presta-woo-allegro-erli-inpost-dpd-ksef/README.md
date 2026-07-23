# Manual E2E walkthrough — PrestaShop, WooCommerce, Allegro, Erli, InPost, DPD, KSeF

**What this is**: a durable record of one manual, click-by-hand end-to-end confirmation run of
the demo stack across the integrations in this batch, on top of a freshly-merged `main` (+ demo/
proxy hardening PRs). It is not a Playwright script and not a fully generic runbook — it documents
what was clicked, what happened, and every bug found and fixed along the way, with screenshots.

> **This is a record of one specific run.** The connection IDs, worktree path, tunnel URLs, and
> credentials below are the exact values used during that run (2026-07-08/09). On a freshly-booted
> demo stack these IDs are regenerated and will not resolve as-is — treat them as "what this run
> used", not as fixed addresses. Only DPD (`06-dpd.md`) walks connection creation from scratch;
> the other docs open an already-created connection by its then-current id.

**Scope (Phase 1 / demo-mode)**: this run covers connection setup + test-connection, the primary
"happy path" per integration (product sync, offer/product creation, label generation, invoice
issuance + clearance), and any bugs hit on that path. It deliberately does **not** cover several
central behaviors that are demo-verifiable but out of scope for this batch — master -> marketplace
inventory *propagation*, 0-stock authoritative-master semantics, Allegro auto-grouping, live
offer-status reconciliation, and PrestaShop-native order ingestion through `validateOrder`. Those
are tracked for a follow-up run in **[#1799](https://github.com/openlinker-project/openlinker/issues/1799)**.
Marketplace order *ingestion* (Allegro/Erli) is also only partially exercised because the sandboxes
have no order-create API — noted per-doc as an environment limitation, not a gap in OpenLinker.

## Index

| # | Doc | Scope | Status |
|---|---|---|---|
| 1 | [`01-prestashop.md`](./01-prestashop.md) | Master catalog connection + product sync | ✅ Confirmed — sync clean |
| 2 | [`02-woocommerce.md`](./02-woocommerce.md) | Second shop connection + publish flow | ✅ Confirmed — 4 UI bugs found & fixed along the way |
| 3 | [`03-allegro.md`](./03-allegro.md) | Marketplace offer creation + order sync | ✅ Part A/B confirmed (3/3 offers created); Part C (order ingestion) not run — no sandbox order-create API; found #1438 (FE) + a dead-tunnel env issue (fixed) |
| 4 | [`04-erli.md`](./04-erli.md) | Marketplace offer creation + order sync | ✅ Part A–D confirmed — 3/3 offers created; found & fixed 5 real bugs along the way; Part E (order ingestion) not run — no sandbox order-create API |
| 5 | [`05-inpost.md`](./05-inpost.md) | Shipping label generation | ✅ Confirmed — label→download→dispatch clean; Part C (tracking) is a sandbox-side limitation, researched (InPost-side, not OL) |
| 6 | [`06-dpd.md`](./06-dpd.md) | Shipping label generation | ✅ Confirmed — connection created + Active, real waybill generated (`0000876013430Q`), SOAP tracking path verified; 4 findings filed (#1775–#1778) |
| 7 | [`07-ksef.md`](./07-ksef.md) | Invoicing + regulatory clearance | ✅ Confirmed — full issue→clearance→UPO cycle verified against real KSeF; found & fixed #1447 (missing Test connection) |

## Environment (as used in this run)

- **Worktree**: `/home/nor/projekty/blocky/openlinker-demo-full` (this run's checkout; not fixed)
- **Branch**: `demo-full-1406-1407-1409` (base: `origin/main` + PR #1406, #1407, #1409 merged;
  #1409's content has since landed on `main` proper via #1421, so this branch is a superset of
  current `main` plus the Erli/Allegro category-catalog epic)
- **Compose project**: `ol-demo-full` (isolated — own named volumes, won't collide with any
  other demo instance on this host)
- **Boot command**: `pnpm demo:up` (from the worktree root), with a local untracked
  `docker-compose.dns-fix.yml` fourth overlay applied on this host only (WSL2 Docker Desktop
  DNS quirk, not a real product issue — see the compose file's header comment)

### URLs

| Service | Local URL | Notes |
|---|---|---|
| OpenLinker Web (admin UI) | http://localhost:8090 | login `admin` / `admin` |
| OpenLinker API | http://localhost:3000 | Swagger at `/api` |
| PrestaShop storefront | http://localhost:8080 | |
| PrestaShop admin | http://localhost:8080/admin-dev | admin folder is renamed on install |
| WooCommerce storefront | http://localhost:8082 | |
| WooCommerce admin (`wp-admin`) | http://localhost:8082/wp-admin | login `admin` / `admin123` |
| phpMyAdmin | http://localhost:8081 | |

### Public tunnels (cloudflared, ephemeral)

Erli (image URLs must be public) and any webhook-delivery flow need real public HTTPS endpoints.
Three `cloudflared` quick tunnels were running in the background on this host during the run:

| Tunnel | Points at | Used as |
|---|---|---|
| API | `localhost:3000` | webhook `callbackBaseUrl` for Erli |
| PrestaShop | `localhost:8080` | PrestaShop connection's **Storefront URL** (restarted 2026-07-09 after the tunnel's control stream died silently — same connection, new ephemeral URL, updated on the connection config) |
| WooCommerce | `localhost:8082` | WooCommerce connection's **Site URL** (also required for REST auth — WooCommerce rejects Basic-Auth over plain HTTP, see #1416) |

⚠️ **These URLs are ephemeral** — a fresh `trycloudflare.com` subdomain is minted every time
`cloudflared` restarts, and the tunnel dies if the process is killed or the host reboots. If a
connection test suddenly fails with a DNS/timeout error, check `ps aux | grep cloudflared` first
— the tunnel may have dropped and the connection's stored URL is stale (see the tunnel-death
Finding in `03-allegro.md` Part B for a worked example). The fix is to restart `cloudflared` and
update the connection config with the new URL.

### Connections used in this run

| Platform | Connection ID (this run) | Name | Status |
|---|---|---|---|
| PrestaShop | `b4c4b6f3-ebca-4aa3-8613-e4fafc688d4d` | PrestaShop (demo) | active — master catalog for Allegro + WooCommerce |
| WooCommerce | `c0f5217b-0bdd-49a3-b78a-4db3ae112898` | WooCommerce (demo) | active |
| Allegro | `b1b78862-27f8-4555-b883-dfd345d1b1f1` | allegro | active — sandbox, seller defaults filled |
| Erli | `4137021d-6395-47e9-a8ec-3518ba99381c` | Demo Erli | active — sandbox |
| InPost | `61db01f1-af06-4242-bd92-7f18690e80e5` | test inpost | active — sandbox |
| DPD | created during this run (see `06-dpd.md`) | DPD Demo | active — sandbox (test connection green; real waybill generated) |
| KSeF | `9dfadf50-454d-459a-b0c6-6db62e5a4058` | Demo KSEf | active — test environment |

### Scheduler flags (demo worker env)

Several poll-based flows are gated by env flags read by the **worker**. They must be set on the
demo worker or the corresponding flow silently never runs. Defaults differ per flag, so set them
explicitly rather than relying on the default:

| Env flag | Flow | Default | Demo value |
|---|---|---|---|
| `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED` | Erli order ingestion (`erli-orders-poll`, ~5 min) | **OFF** | `true` |
| `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED` | Erli offer-status / frozen-stock sync | **OFF** | `true` |
| `OL_ERLI_DISPATCH_WRITEBACK_ENABLED` | Erli dispatch/tracking write-back (else reports `unsupported`) | **OFF** | `true` (if dispatch write-back is wanted) |
| `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED` | WooCommerce order ingestion (`woocommerce-orders-poll`, ~5 min) — only polls connections that have `OrderSource` enabled | **OFF** | `true` |
| `OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED` | DPD tracking poll (`dpd-shipment-status-sync`, ~30 min; DPD has no webhook) | **ON** (`(env ?? 'true') !== 'false'`) | leave unset / `true` |

Allegro and PrestaShop schedulers are on by their own defaults and need no demo-specific flag.
PrestaShop and InPost also deliver via webhook (see each integration's walkthrough); DPD and
WooCommerce are poll-only.

## Troubleshooting / where to look

When a step doesn't produce the expected result, these are the first places to look — and the
exact way to force a poll-based flow to run instead of waiting for its cron cadence.

- **Jobs & Logs (web UI)** — left nav **Diagnostics → Jobs & Logs** (`/jobs-logs`). Lists every
  `sync_jobs` row with status (`queued` / `running` / `succeeded` / `dead`), the connection, the
  job type, attempts, and `lastError`. Filter by URL query: `/jobs-logs?status=dead`,
  `?status=queued`, `?connectionId=<id>`, `?jobType=<type>`. The dashboard's "Failed jobs" KPI
  links straight into `?status=dead`. This is the first stop for "the flow ran but nothing
  happened" — a `dead` row with a `lastError` is the usual culprit.
- **Worker logs (container)** — poll jobs and offer/order pipelines execute in the **worker**
  process, not the API. Tail them with `docker compose -p ol-demo-full logs -f worker`. Most
  adapter-level failures (e.g. the Erli `externalAttributes ... must be of type object` and the
  Allegro image-fetch-unreachable findings in this run) surfaced here first, before they showed
  up as a `dead` job.
- **Trigger a sync manually (web UI, preferred)** — on any connection's **Actions** tab, click
  **"Trigger sync…"**. Pick a job type (default `master.product.syncAll`, also `master.inventory.syncAll`)
  and payload, submit — it enqueues the job immediately instead of waiting for the scheduler. Use
  this for the "wait 5/20/30 min or trigger manually" steps in the per-integration docs.
- **Trigger a job manually (SQL, for job types the UI doesn't expose)** — some scheduled jobs
  (e.g. the KSeF `invoicing.regulatoryStatus.reconcile` reconcile job, see `07-ksef.md` Part C)
  aren't in the Trigger-sync dropdown. Insert a `sync_jobs` row directly (via phpMyAdmin against
  Postgres, or `docker compose -p ol-demo-full exec postgres psql`):

  ```sql
  INSERT INTO sync_jobs (job_type, connection_id, payload_json, status, idempotency_key, next_run_at)
  VALUES (
    'invoicing.regulatoryStatus.reconcile',
    '<connection-uuid>',
    '{"schemaVersion": 1}',            -- the handler validates this exact payload shape
    'queued',
    'manual:reconcile:' || gen_random_uuid(),  -- must be unique (idempotency_key is UNIQUE)
    now()
  );
  ```

  The worker picks up `queued` rows on its next tick and the job runs within seconds. `07-ksef.md`
  Part C is the worked reference for this recipe.

## How this run was carried out

1. For each integration doc, the concrete steps (what page, what button, what to type) were
   written out as a numbered checklist.
2. Each step was clicked through by hand in the browser at http://localhost:8090.
3. At each meaningful checkpoint a screenshot was captured and saved under
   `docs/manual-testing/01-presta-woo-allegro-erli-inpost-dpd-ksef/screenshots/<integration>/`,
   then embedded as a real `![...](...)` image in the step body.
4. Anything unexpected was recorded inline as a **Finding** callout (never silently skipped), so
   this doc doubles as a genuine E2E confirmation record rather than a happy-path script. Findings
   that warranted a code fix were fixed and shipped; those that warranted tracking became issues
   (the #1415/#1416/#1417 batch, plus #1438, #1447, and #1775–#1778).

## Conventions used in the per-integration docs

- `[x]` / `[ ]` checkboxes mark each manual step — a `[x]` means the step was completed and
  confirmed in this run; a `[ ]` marks a step that was intentionally not run (e.g. marketplace
  order ingestion, which needs a sandbox order-create API that doesn't exist).
- `![...](...)` embeds are the captured screenshots for each confirmed checkpoint. Steps that were
  not run carry an italic _(screenshot pending)_ note instead.
- `> **Finding:**` callouts record anything unexpected discovered mid-walkthrough (bug, doc gap,
  confusing UX). Several became `/create-issue` material afterward.
