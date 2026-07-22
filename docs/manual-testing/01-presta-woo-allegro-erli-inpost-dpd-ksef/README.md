# Manual E2E walkthrough — PrestaShop, WooCommerce, Allegro, Erli, InPost, DPD, KSeF

**Purpose**: local, click-by-hand confirmation that the full demo stack works end-to-end across
every shipped integration, on top of a freshly-merged `main` (+ demo/proxy hardening PRs).
Not a Playwright script — you click, I document steps and drop in the screenshots you post in
chat as we go.

**Status**: local-only, not meant to be pushed/committed upstream. Lives in this repo just so it's
easy to keep next to the code while we work through it.

## Index

| # | Doc | Scope | Status |
|---|---|---|---|
| 1 | [`01-prestashop.md`](./01-prestashop.md) | Master catalog connection + product sync | ✅ Confirmed — sync clean |
| 2 | [`02-woocommerce.md`](./02-woocommerce.md) | Second shop connection + publish flow | ✅ Confirmed — 4 UI bugs found & fixed along the way |
| 3 | [`03-allegro.md`](./03-allegro.md) | Marketplace offer creation + order sync | ✅ Part A/B confirmed (3/3 offers created); Part C (orders) pending; found #1438 (FE) + a dead-tunnel env issue (fixed) |
| 4 | [`04-erli.md`](./04-erli.md) | Marketplace offer creation + order sync | ✅ Confirmed — 3/3 offers created; found & fixed 5 real bugs along the way |
| 5 | [`05-inpost.md`](./05-inpost.md) | Shipping label generation | ✅ Confirmed — label→download→dispatch clean; sandbox tracking limitation researched (InPost-side, not OL) |
| 6 | [`06-dpd.md`](./06-dpd.md) | Shipping label generation | ⏭️ Skipped — no sandbox credentials available |
| 7 | [`07-ksef.md`](./07-ksef.md) | Invoicing + regulatory clearance | ✅ Confirmed — full issue→clearance→UPO cycle verified against real KSeF; found & fixed #1447 (missing Test connection) |

## Environment

- **Worktree**: `/home/nor/projekty/blocky/openlinker-demo-full`
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
Three `cloudflared` quick tunnels are running in the background on this host:

| Tunnel | Points at | Used as |
|---|---|---|
| API | `localhost:3000` | webhook `callbackBaseUrl` for Erli |
| PrestaShop | `localhost:8080` | PrestaShop connection's **Storefront URL** (restarted 2026-07-09 after the tunnel's control stream died silently — same connection, new ephemeral URL, updated on the connection config) |
| WooCommerce | `localhost:8082` | WooCommerce connection's **Site URL** (also required for REST auth — WooCommerce rejects Basic-Auth over plain HTTP, see #1416) |

⚠️ **These URLs are ephemeral** — a fresh `trycloudflare.com` subdomain is minted every time
`cloudflared` restarts, and the tunnel dies if the process is killed or the host reboots. If a
connection test suddenly fails with a DNS/timeout error, check `ps aux | grep cloudflared` first
— the tunnel may have dropped and the connection's stored URL is stale. Ask me to restart them
and update the connection config if so.

### Connections already configured

| Platform | Connection ID | Name | Status |
|---|---|---|---|
| PrestaShop | `b4c4b6f3-ebca-4aa3-8613-e4fafc688d4d` | PrestaShop (demo) | active — master catalog for Allegro + WooCommerce |
| WooCommerce | `c0f5217b-0bdd-49a3-b78a-4db3ae112898` | WooCommerce (demo) | active |
| Allegro | `b1b78862-27f8-4555-b883-dfd345d1b1f1` | allegro | active — sandbox, seller defaults filled |
| Erli | `4137021d-6395-47e9-a8ec-3518ba99381c` | api | active — sandbox |
| InPost | `61db01f1-af06-4242-bd92-7f18690e80e5` | test inpost | active — sandbox |
| DPD | — | — | not created — skipped, no sandbox credentials |
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
| `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED` | WooCommerce order ingestion (poll-only, no webhook, ~5 min) | **OFF** | `true` |
| `OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED` | DPD tracking poll (`dpd-shipment-status-sync`, ~30 min; DPD has no webhook) | **ON** (`(env ?? 'true') !== 'false'`) | leave unset / `true` |

Allegro and PrestaShop schedulers are on by their own defaults and need no demo-specific flag.
PrestaShop and InPost also deliver via webhook (see each integration's walkthrough); DPD and
WooCommerce are poll-only.

## How we're running this

1. For each integration doc, I write out the concrete steps (what page, what button, what to
   type) as a numbered checklist.
2. You click through it by hand in the browser at http://localhost:8090.
3. At each meaningful checkpoint the doc has a placeholder like:

   ```
   [SCREENSHOT: connection detail page showing "Test connection" = success]
   ```

   Paste the screenshot in chat when you get there and I'll save it under
   `docs/manual-testing/01-presta-woo-allegro-erli-inpost-dpd-ksef/screenshots/<integration>/`
   and wire the placeholder into a real `![...](...)` embed.
4. If something breaks, we note it inline as a **Finding** callout (not silently skipped) so the
   final doc doubles as a real E2E confirmation record, not just a happy-path script.

## Conventions used in the per-integration docs

- `[ ]` checkboxes for each manual step — check them off as you go.
- `[SCREENSHOT: ...]` placeholders — replaced with real images as we go.
- `> **Finding:**` callouts for anything unexpected discovered mid-walkthrough (bug, doc gap,
  confusing UX) — these become candidate `/create-issue` material afterward, same as the
  #1415/#1416/#1417 batch.
