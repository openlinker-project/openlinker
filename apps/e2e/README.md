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
  playwright.config.ts    # 10 projects (see Projects table), reporters, retries, storageState
  .eslintrc.cjs           # self-contained lint config (own tsconfig) so the pkg joins `pnpm -r lint`
  .env.example            # OL_WEB_URL, OL_API_URL, OL_ADMIN_USER/PASS, per-suite secrets/flags
  src/
    config/               # resolveEnv() with localhost defaults + package-local .env loader
    api/                  # node typed API client: login()->bearer, connections, products, listings, orders, invoices, sync jobs, routing rules; PS/WC REST helpers
    world/                # buildWorld(api): connections indexed by platformType + capability + master product/variant helpers
    fixtures/             # the extended Playwright `test` exposing { page, api, world, jobs, poll, pages }
    pages/                # page objects (kebab-case files, PascalCase exports)
    support/              # poller (pollUntil), jobs (trigger helpers), selectors, stock/orders/shipments/parity helpers, manual-checkpoint
  tests/
    auth.setup.ts         # global-setup auth project → writes .auth/admin.json
    connection-topology.setup.ts  # same `setup` project: preflight that fails a self-contradictory stack
    smoke/                # health + login + connections list (proves the substrate)
    golden-path/          # operator-setup.spec (S1-S4, unattended) + full-flow.spec (S0-S9, attended)
    webhooks/             # real signed inbound-webhook receiver path (#1512)
    woocommerce-parity/   # WC master / order destination / mapping / webhooks / config validation (#1571)
    shipping/             # unattended InPost coverage: labels, COD, insurance, protocol, tracking (#1572)
    invoicing/            # inFakt provider run, KOR, FA(3) parity, bank accounts (#1573)
    lifecycle/            # order-lifecycle idempotency + inventory propagation + stale-variant pruning (#1574)
    access-control/       # demo mode, registration, RBAC, UI-reflection checks
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
4. **Connections configured coherently** - enforced automatically by the `setup`
   project, see below. Fix a reported problem before you spend a session on it.

### Connection-topology preflight

`tests/connection-topology.setup.ts` runs inside the `setup` project, so **every**
browser project depends on it. It reads the active connections once and **hard-fails
the whole run** on one condition:

> A connection declares `config.masterCatalogConnectionId` (its catalogue comes
> from somewhere else) **and** also enables `ProductMaster` and/or
> `InventoryMaster`.

That combination is legal in the product, which is exactly why it is checked here
instead of at runtime. A live run found `WooCommerce (shop)` configured that way:
publishing a product to that shop let the shop's own master sync re-import the
copy as a **second** OpenLinker product. The damage was not test-shaped -

- a real marketplace order could not be created on the shop (`No WC product
  mapping for OL product …`), because the offer was built from one OL product
  while the shop copy was filed under the other; and
- the bulk product picker matched two rows for one SKU and stalled.

Fix: remove `ProductMaster` / `InventoryMaster` from the connection that borrows
its catalogue.

Two softer conditions are **annotated as `topology` notes, not enforced**:

- more than one connection enables `ProductMaster` - legal, but a spec that
  resolves "the master catalogue" by capability may pick either;
- two connections share one store with both order ingestion (`OrderSource`) and
  order creation (`OrderProcessorManager`) enabled - every order OpenLinker
  writes there reappears in the source feed and is ingested again. Legitimate
  when there is only one test store; match ingested orders by their source id,
  never by "the newest order".

The preflight also fails when **no** active connection enables `ProductMaster` -
nothing can seed the catalogue.

---

## Running

All scripts are under `test:e2e*` — there is intentionally **no `test` script**,
so the suite is never swept into the root `pnpm -r test` unit gate.

> ⚠️ **`test:e2e` runs only the UNATTENDED projects** (everything except
> `full-flow`). The attended S0-S9 `full-flow` project blocks on a manual buyer
> purchase (up to 2h per purchase platform) and mutates external systems, so it
> is **never** part of the default command — run it explicitly with
> `test:e2e:full-flow` (which sets `E2E_ATTENDED=1`; `full-flow` also self-skips
> without that flag, belt-and-suspenders).

```bash
# From the repo root:
pnpm --filter @openlinker/e2e test:e2e                       # all UNATTENDED projects (safe default)
pnpm --filter @openlinker/e2e test:e2e:unattended            # same as above, explicit
pnpm --filter @openlinker/e2e test:e2e:full-flow             # ATTENDED S0-S9 (headed; E2E_ATTENDED=1)
pnpm --filter @openlinker/e2e test:e2e -- --project=smoke    # smoke only (read-only)
pnpm --filter @openlinker/e2e test:e2e -- --project=golden-path
pnpm --filter @openlinker/e2e test:e2e -- --project=webhooks # signed inbound-webhook receiver path (#1512)
pnpm --filter @openlinker/e2e test:e2e -- --project=woocommerce-parity # WC master/destination/webhooks/mapping (#1571)
pnpm --filter @openlinker/e2e test:e2e -- --project=shipping  # unattended InPost coverage (#1572)
pnpm --filter @openlinker/e2e test:e2e -- --project=invoicing # inFakt provider / KSeF parity (#1573)
pnpm --filter @openlinker/e2e test:e2e -- --project=lifecycle # lifecycle + inventory resilience (#1574)
pnpm --filter @openlinker/e2e test:e2e -- --project=access-control
pnpm --filter @openlinker/e2e test:e2e:ui                    # Playwright UI mode
pnpm --filter @openlinker/e2e test:e2e:headed                # headed browser
pnpm --filter @openlinker/e2e test:e2e:report                # open last HTML report
pnpm --filter @openlinker/e2e lint
pnpm --filter @openlinker/e2e type-check
```

### Projects

`playwright.config.ts` ships **10** projects. All except `full-flow` are
unattended (no human-in-the-loop) and run under `test:e2e`. "Mutates?" means it
changes stack/marketplace state (offers, orders, invoices, stock, webhook
secrets); "Attended?" means it needs a human (manual buyer purchase + external
dashboard checkpoints).

| Project | What it does | Mutates? | Attended? |
|---|---|---|---|
| `setup` | Logs in via the `/login` UI once, writes `.auth/admin.json`; also runs the connection-topology preflight (see above). | No | No |
| `smoke` | Health + node login + world + connections page render. | **No — safe on a shared stack** | No |
| `golden-path` | Operator setup S1-S4 (product sync, WooCommerce publish, Allegro + Erli bulk offers). | **Yes** | No |
| `full-flow` | S0-S9 full golden path across all 6 systems, field/amount parity. | **Yes — heavily** | **Yes** |
| `webhooks` | Fires a real signed inbound webhook, asserts verify → record → enqueue → dedup (#1512). | Yes (rotates secret, enqueues a job) | No |
| `woocommerce-parity` | WC as master / order destination / mapping / inbound webhooks / config validation (#1571). | Yes (WC-native orders, webhook secret, throwaway connection) | No |
| `shipping` | Unattended InPost: courier + paczkomat labels, COD, insurance, protocol, cancellation, tracking, ShipX webhook (#1572). | Yes (real ShipX calls) | No |
| `invoicing` | inFakt run, payment marking, bulk issue/resend/e-mail, KOR corrections, FA(3) parity + preview, Transfer bank accounts (#1573). | Yes (issues/corrects invoices, synthesizes orders) | No |
| `lifecycle` | Order-lifecycle idempotency, cross-channel stock propagation + oversell safety, stale-variant pruning (#1574). | Yes (real PS stock; pruning is destructive, opt-in) | No |
| `access-control` | Demo mode, registration, RBAC, and UI-reflection checks. | Provisions a viewer (idempotent) | No |

> ⚠️ **Every project except `smoke`/`setup` mutates the stack** (publishes
> products, creates offers, generates labels, issues invoices, rotates webhook
> secrets, dispatches ShipX calls). Run them only against a stack you control, in
> a coordinated session — never against a shared demo stack in active manual use.
> The `full-flow` project additionally drives a **manual buyer purchase** and
> external-dashboard checkpoints, so it is **attended** (`retries: 0`, run headed,
> guarded on `E2E_ATTENDED=1`) and is excluded from the default `test:e2e`. The
> `smoke` project is read-only and safe to run anytime.

### Run-ordering hazard: the webhook suites break PrestaShop order creation

**One shared secret signs both directions** of the PrestaShop integration: inbound
webhooks *from* the shop, and OpenLinker's outbound call *to* the OL module (the
`importorder` front controller that actually creates the order).

`tests/webhooks/inbound-webhook.spec.ts` and
`tests/lifecycle/webhook-poll-idempotency.spec.ts` both call
`POST /v1/connections/:id/webhooks/secret/rotate` in their setup, on purpose: a
rotation is how they prove an old signature stops working. But the rotation
updates **OpenLinker only** - nothing pushes the new secret to PrestaShop. From
that point on, every order creation against PrestaShop fails with
`HTTP 401 (reason: invalid-signature)`.

So: after running `--project=webhooks` or `--project=lifecycle`, **reinstall the
webhooks before any run that creates a PrestaShop order** (the attended
`full-flow`, `invoicing`, anything reaching S7):

```
POST /v1/connections/:id/webhooks/install
```

That endpoint rotates **and** pushes, which is what restores both directions.
The connection page's webhook install action does the same thing.

`tests/woocommerce-parity/webhooks.spec.ts` rotates the **WooCommerce**
connection's secret in the same way; that suite also exercises the install
action, so it pushes the secret it leaves behind.

### Project → required env

Every value has a localhost default (`src/config/env.ts`), so `setup`/`smoke`
and the UI-driven mutating projects run with no `.env`. The columns below list
what a project additionally needs for its **deep** assertions (a missing secret
self-skips the affected scenarios, never fails). See `.env.example` for the full
annotated list.

| Project | Additional env it uses |
|---|---|
| `setup`, `smoke` | none (localhost defaults) |
| `golden-path` | `OL_PS_WEBSERVICE_KEY` (PS field parity); `E2E_FRESH_PRODUCT` + `E2E_FRESH_*` (opt-in fresh product) |
| `full-flow` | **`E2E_ATTENDED=1`** (gate); `OL_PS_WEBSERVICE_KEY`, `OL_WC_CONSUMER_KEY`/`OL_WC_CONSUMER_SECRET` (field parity); `E2E_SOURCE_PLATFORM`, `E2E_PACZKOMAT_ID`, `E2E_RESUME_DIR`, `E2E_PRODUCT_SKU`, `E2E_FRESH_*`; and the three knobs that decide how long the run takes and whether it can finish - `E2E_PURCHASE_PLATFORMS`, `E2E_FRESH_VARIANT_COUNT`, `E2E_RESUME_FROM_ORDER` (all three below) |
| `webhooks` | none (rotates the PS connection's secret itself); skips without a PrestaShop connection |
| `woocommerce-parity` | `OL_WC_CONSUMER_KEY`, `OL_WC_CONSUMER_SECRET` (WC REST seeding); skips without a WooCommerce connection |
| `shipping` | `E2E_ORDER_ID` (or a golden-path `ready` order); `E2E_TEST_INPOST_WEBHOOK=true` (opt-in inbound ShipX webhook); `E2E_PACZKOMAT_ID`; skips without an InPost connection |
| `invoicing` | `OL_PS_WEBSERVICE_KEY` (order synthesis); skips without an invoicing (inFakt) connection |
| `lifecycle` | `OL_PS_WEBSERVICE_KEY` (stock/pruning); **`E2E_ALLOW_DESTRUCTIVE_PRUNE=true`** (opt-in irreversible pruning spec) |
| `access-control` | `E2E_VIEWER_USER`/`E2E_VIEWER_PASS` (pre-seeded active viewer — see below); `E2E_TEST_RATE_LIMIT=true` (opt-in destructive register-429 assertion, demo mode only) |

#### Choosing where the operator buys (`E2E_PURCHASE_PLATFORMS`)

Comma-separated list of marketplace platform types the attended run stops for
(`allegro`, `erli`, or both). Each entry gets **its own purchase stop** with its
own up-to-2h budget, and S5-S9 then track one order per platform. Unset, it
defaults to the single `E2E_SOURCE_PLATFORM` (itself defaulting to `allegro`).

Use it to **drop a purchase platform that is unavailable**. A platform can go
down in ways nothing on the OpenLinker side can detect: in one session the Erli
sandbox shop had been disabled by Erli itself (`Status sklepu: Wyłączony przez
system`), which is invisible until you try to buy - the purchase stop then sits
for its full 2-hour budget and fails the run. Offer *creation* still worked
throughout. Setting `E2E_PURCHASE_PLATFORMS=allegro` skips that stop.

Note the asymmetry: **S4 still creates Erli offers regardless**, because it keys
off "is there an Erli connection", not off this variable. Dropping a platform
here drops its *purchase*, not its offer-creation coverage.

#### Fresh-product variant count (`E2E_FRESH_VARIANT_COUNT`)

How many variants `E2E_FRESH_PRODUCT=true` provisions. **Defaults to `1`, and 1
is the value that reliably completes an attended run.** A fresh product's
barcodes are synthetic, and Allegro's sandbox catalogue has no card for a code it
has never seen: it mints one, binds it to the *first* sibling's barcode, and
rejects every other sibling with `ProductConstraintViolationException.DataIntegrity`.
One sibling lists, the rest cannot, so the purchase and everything behind it
become unreachable.

Raise it to 2-4 only with barcodes that already resolve to **distinct existing
catalogue cards** in this sandbox. See
[`docs/manual-testing/e2e-golden-path.md`](../../docs/manual-testing/e2e-golden-path.md)
§ Fresh product per run for the full reasoning and the counter-experiment that
shows multi-variant listing itself is not the blocker.

#### Resuming `full-flow` from an existing order

`full-flow` is `mode: 'serial'` and every post-purchase segment reads state that
S0-S4 build up, so a failure anywhere before S5 destroys the rest of the run —
and getting back to S5 costs a fresh product, a fresh Allegro offer, ~40 minutes
waiting for that offer to leave `szkic`, and another human purchase.

Set `E2E_RESUME_FROM_ORDER` to an OpenLinker internal order id (`ol_order_…`)
that a previous session already produced, and:

- S0-S4 and the purchase PAUSE **skip**, each with a reason naming the mode and
  the order id;
- the driver product, its variants and the ingested order are **seeded from that
  order** (its source connection, its sold line, that line's product);
- S5 **verifies** the order it was handed (ready, lines, amounts, buyer, pickup
  point) instead of waiting for an arrival that already happened;
- S6 onward run unchanged.

Leave it unset and the flow behaves exactly as before.

**A resumed run is not equivalent to a full one.** Both stock baselines (OL
master availability, per-channel offer quantity) are pre-purchase readings that
cannot be recovered after the sale, and reconstructing one from the post-sale
value would make the delta assertion compare a number against itself. So the
master-stock delta (S7/S9) and the channel/WooCommerce stock checks (S5/S9) are
skipped and annotated `resume-degrade` in the HTML report with exactly what went
unchecked. Read those annotations before signing a resumed run off.

#### Providing a viewer for `access-control`

Three of the access-control cases need a **non-admin session**. They used to get
one by registering a throwaway account and logging straight in, which worked
because a demo-mode signup was created active.

Since #1624 that is no longer true: a demo-mode registration lands in
`pending_confirmation` and `POST /auth/login` answers **403** ("Please confirm
your email address…") until the emailed single-use link is followed. An API-only
test client cannot follow it, and there is no admin endpoint that activates such
an account — `UserManagementService.approveUser` accepts only `pending`. So on a
demo stack the suite cannot mint its own viewer any more.

Point `E2E_VIEWER_USER` / `E2E_VIEWER_PASS` at an existing **active** viewer and
those cases run against it; leave them unset and they `test.skip` with the
reason. Registration-based provisioning is still used (and still correct) in
non-demo mode, where the account is created `pending` and an admin approves it.

The `registration` spec needs no viewer — it asserts the `pending_confirmation`
contract itself, including the 403.

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
