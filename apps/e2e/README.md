# @openlinker/e2e

Browser-level end-to-end tests for OpenLinker operator flows, built on
[Playwright](https://playwright.dev/). This package is a **self-contained,
reusable E2E substrate**: an authenticated node API client, a dynamically
resolved "world" (connections + products), page objects, deterministic pollers,
and job-trigger helpers — so a new operator-flow test is cheap to write.

It runs against a **running** OpenLinker stack (local demo/dev today, CI later)
and asserts **OL UI + OL REST API** as the source of truth. Buyer-side
marketplace purchases (Allegro/Erli) are a **manual prerequisite** — tests pick
up from OL state, they do not automate external buyer sites.

> This package is intentionally isolated from the rest of the monorepo. It does
> not import from `libs/*` or `apps/web`; response shapes are mirrored locally in
> `src/api/api.types.ts`.

---

## Layout

```
apps/e2e/
  playwright.config.ts    # projects (setup / smoke / golden-path), reporters, retries, storageState
  .env.example            # OL_WEB_URL, OL_API_URL, OL_ADMIN_USER/PASS, E2E_ORDER_ID
  src/
    config/               # resolveEnv() with localhost defaults + package-local .env loader
    api/                  # node typed API client: login()->bearer, connections, products, listings, orders, invoices, sync jobs, routing rules
    world/                # buildWorld(api): connections indexed by platformType + master product/variant helpers
    fixtures/             # the extended Playwright `test` exposing { page, api, world, jobs, poll, pages }
    pages/                # page objects (kebab-case files, PascalCase exports)
    support/              # poller (pollUntil), jobs (trigger helpers), selector helpers
  tests/
    auth.setup.ts         # global-setup auth project → writes .auth/admin.json
    smoke/                # health + login + connections list (proves the substrate)
    golden-path/          # operator-setup.spec (S1-S4)
    webhooks/             # real signed inbound-webhook receiver path (#1512)
  .auth/                  # storageState (gitignored)
```

---

## Prerequisites

1. A running OpenLinker stack. For the local demo:
   ```bash
   pnpm demo:up          # from the repo root
   ```
   Defaults assume web on `http://localhost:8090` and API on `http://localhost:3000`.
2. The Chromium browser binary (one-time, per machine):
   ```bash
   pnpm --filter @openlinker/e2e exec playwright install chromium
   ```
3. (Optional) a local `.env`:
   ```bash
   cp apps/e2e/.env.example apps/e2e/.env
   ```
   Every value has a localhost default, so an unmodified demo stack needs no `.env`.

---

## Running

All scripts are under `test:e2e*` — there is intentionally **no `test` script**,
so the suite is never swept into the root `pnpm -r test` unit gate.

```bash
# From the repo root:
pnpm --filter @openlinker/e2e test:e2e                       # full suite
pnpm --filter @openlinker/e2e test:e2e -- --project=smoke    # smoke only (read-only)
pnpm --filter @openlinker/e2e test:e2e -- --project=golden-path
pnpm --filter @openlinker/e2e test:e2e -- --project=webhooks # signed inbound-webhook receiver path (#1512)
pnpm --filter @openlinker/e2e test:e2e -- --project=woocommerce-parity # WC master/destination/webhooks/mapping (#1571)
pnpm --filter @openlinker/e2e test:e2e:ui                    # Playwright UI mode
pnpm --filter @openlinker/e2e test:e2e:headed                # headed browser
pnpm --filter @openlinker/e2e test:e2e:report                # open last HTML report
pnpm --filter @openlinker/e2e type-check
```

### Projects

| Project | What it does | Mutates the stack? |
|---|---|---|
| `setup` | Logs in via the `/login` UI once, writes `.auth/admin.json`. | No |
| `smoke` | Health + node login + world + connections page render. | **No — safe on a shared stack** |
| `golden-path` | Operator setup S1-S4 (product sync, WooCommerce publish, Allegro + Erli bulk offers). | **Yes** |
| `full-flow` | Attended S0-S9 full golden path across all 6 systems, field/amount parity. | **Yes — heavily** |

> ⚠️ **The `golden-path` and `full-flow` projects mutate the stack** (publish
> products, create offers, generate labels, issue invoices). Run them only against
> a stack you control, in a coordinated session — never unattended against a
> shared demo stack in active manual use. The `full-flow` project additionally
> drives a **manual buyer purchase** and external-dashboard checkpoints, so it is
> **attended** (`retries: 0`, run headed). The `smoke` project is read-only and
> safe to run anytime.

The full S0-S9 flow — segments, automated-vs-manual split, expected-value
sources, how to run headed, and how to extend — is documented in
[`docs/manual-testing/e2e-golden-path.md`](../../docs/manual-testing/e2e-golden-path.md).

---

## Auth model

The FE uses a memory-only access token + HttpOnly refresh cookie + `ol_csrf` CSRF
cookie. The suite uses **two paths**:

- **Node API client** (`src/api`): `POST /auth/login` → bearer token on every
  request. No cookie/CSRF dance. Used for setup, verification, and job triggers.
- **Browser**: the `setup` project logs in through the UI and saves
  `storageState` to `.auth/admin.json`; browser projects seed it.

Because OL rotates refresh tokens with **single-use reuse-detection**
(`RefreshTokenReuseDetectedException`), a single shared saved cookie would be
revoked the moment a second browser context (or a retry) presented it. So the
auto `browserAuth` fixture establishes a **fresh session per test context** by
logging in through `context.request` (which shares the browser cookie jar) before
the page navigates. This sidesteps rotation while still honouring the
storageState seed, and keeps the `golden-path` project safe to run serially with
`retries: 1`. (`workers: 1` is set for the same serialization reason; a
per-worker parallel auth fixture is the documented next step if parallelism is
needed.)

---

## Determinism

No `waitForTimeout` for "eventually synced". Every asynchronous checkpoint =
**trigger the work explicitly** (a sync job via `support/jobs.ts`, or a UI
wizard) then **`poll.until(...)`** the OL state (API-authoritative, UI
cross-checked) with a bounded timeout and a clear message.

---

## How to add a test

1. Create a spec under `tests/<area>/<name>.spec.ts`.
2. Import the extended `test`:
   ```ts
   import { test, expect } from '../../src/fixtures/test';
   ```
3. Compose the fixtures you need:
   ```ts
   test('propagate inventory to a marketplace', async ({ api, world, jobs, pages, poll }) => {
     // Resolve topology dynamically — never hardcode ids/URLs.
     const allegro = world.requireConnection('allegro');

     // Trigger work explicitly, then poll OL state.
     await jobs.triggerAndWait({ connectionId: allegro.id, jobType: 'inventory.propagateToMarketplaces' });

     await poll.until(
       () => api.listings.list({ connectionId: allegro.id, limit: 25 }),
       (page) => page.total > 0,
       { message: 'offer mappings to appear for Allegro' },
     );
   });
   ```
4. Prefer role/label/text locators via existing page objects
   (`pages.*`); the app has **no `data-testid`s**, so specs never use raw
   selectors. If a new surface is needed, add a page object under `src/pages/`
   (kebab-case file, PascalCase export) and register it in `src/pages/index.ts`.
5. If the flow mutates the stack, place it under `tests/golden-path/` (or a new
   mutating area) — not `tests/smoke/`.

### Fixtures reference

| Fixture | Scope | Purpose |
|---|---|---|
| `page` | test | Playwright page (already authenticated). |
| `api` | worker | Authenticated node API client. |
| `world` | worker | Stack topology (`connectionFor`, `requireConnection`, product/variant helpers). |
| `jobs` | worker | Sync-job trigger helpers (`trigger`, `triggerAndWait`, `waitForJob`). |
| `poll` | test | `poll.until(probe, predicate, options)` — deterministic bounded polling. |
| `pages` | test | Page-object registry bound to `page`. |

---

## Scope

Delivered here: framework foundation + smoke + operator-setup segments **S1-S4**
(no manual purchase needed), **plus the full attended golden path S0-S9** across
all six systems with field- and amount-level parity
(`tests/golden-path/full-flow.spec.ts`, project `full-flow`). The full flow
covers the post-purchase half (order ingest, InPost label, KSeF invoice,
reconciliation) and drives a manual buyer purchase + external-dashboard
checkpoints. See [`docs/manual-testing/e2e-golden-path.md`](../../docs/manual-testing/e2e-golden-path.md).

Also delivered: the `webhooks` project (`tests/webhooks/inbound-webhook.spec.ts`,
#1512) — fires a real OL-HMAC-signed inbound webhook at
`POST /webhooks/:provider/:connectionId` and asserts verify -> record -> enqueue
-> dedup. The truly external platform-delivery round-trip stays a documented
manual check: see
[`docs/manual-testing/inbound-webhook-round-trip.md`](../../docs/manual-testing/inbound-webhook-round-trip.md).

Also delivered: the `woocommerce-parity` project (`tests/woocommerce-parity/`,
#1571) — WooCommerce as master catalogue (capability-resolved, not
platform-hardcoded — see `World.connectionWithCapability`), as an order
destination with customer/address reuse and variant mapping, inbound
webhooks, the `FulfillmentStatusReader` read-back, and connection config
validation (#1505/#1508). Fully unattended: orders are seeded directly via
`WooCommerceRestClient`, not a live marketplace purchase. Two scenarios from
the parent issue are intentionally not exercised (documented at the top of
`tests/woocommerce-parity/fulfillment-and-mapping-options.spec.ts`): WC's
`OrderStatusWriteback` direction has no HTTP entry point in this API surface
today (it's relay-driven from the shipment-dispatch/order-ingestion flows),
and the mapping UI's `DestinationOptionsReader` route is hardcoded to
Allegro<->PrestaShop — that test asserts the current 400 as a documented gap.
