# One-Command Demo — Setup Guide

This guide walks through booting the full OpenLinker stack in Docker with a single
command and clicking through an end-to-end **PrestaShop → OpenLinker → Allegro**
flow. It expands on the short "One-command demo" section in the root
[`README.md`](../README.md).

The demo boots, from a clean checkout: PostgreSQL, Redis, MySQL, a seeded
PrestaShop (with the OpenLinker module pre-mounted), and the full OpenLinker app
tier — API + Worker + admin UI.

> **Local evaluation only.** Credentials are intentionally not production-safe and
> the stack is not hardened (no TLS, default passwords). Do not expose it publicly.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment variables (`.env`)](#2-environment-variables-env)
3. [Boot the stack](#3-boot-the-stack)
4. [Service URLs & credentials](#4-service-urls--credentials)
5. [Wire the PrestaShop connection](#5-wire-the-prestashop-connection)
6. [Wire the Allegro connection (optional)](#6-wire-the-allegro-connection-optional)
7. [Verify the end-to-end flow](#7-verify-the-end-to-end-flow)
8. [Troubleshooting](#8-troubleshooting)
9. [Teardown](#9-teardown)
10. [Running on a shared server / multiple instances](#10-running-on-a-shared-server--multiple-instances)

---

## 1. Prerequisites

- **Docker** and **Docker Compose ≥ 2.24** (`docker compose version`). The demo
  overlay uses `!reset` / merge features from 2.24+.
- **pnpm** and **Node.js LTS** (only to run the `pnpm demo:*` wrapper scripts).
- **~4 GB free disk** for the built images and a few minutes for the first build
  (the whole monorepo is compiled inside the image; the build is from your local
  checkout, not a pre-built registry image).
- **Free host ports:** `8090` (UI), `3000` (API), `8080` (PrestaShop), `8081`
  (phpMyAdmin), `8082` (WooCommerce), `5432` (Postgres), `6379` (Redis), `3306`
  (MySQL), `3307` (WooCommerce MySQL).

> ⚠️ **Shared volumes with the dev stack.** The demo shares the same Compose
> project (`openlinker`) and data volumes as `pnpm dev:stack:up`. On a machine
> that already runs the local dev stack, the demo **reuses and can clobber that
> data** — the two flows are *not* isolated. Stop (and, if needed, wipe) one
> before running the other: `pnpm dev:stack:down` or `pnpm demo:down -v`.

---

## 2. Environment variables (`.env`)

Docker Compose auto-loads a root `.env` file for `${VAR}` interpolation. **One
variable is required**; everything else has a working default baked into the
Compose files.

### Required

| Variable | Why | Example / how to generate |
|---|---|---|
| `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` | Encryption key for the `integration_credentials` store. Migration `1795000000000-encrypt-integration-credentials` **fails closed** under `NODE_ENV=production` if it is unset and aborts the whole boot; the API/Worker also need it to decrypt connection credentials at runtime. Base64-encoded 32 bytes. | `openssl rand -base64 32` |

### Create your `.env`

`.env` is gitignored — never commit real secrets. `.env.example` ships an empty
`OPENLINKER_CREDENTIALS_ENCRYPTION_KEY=` line, so drop it and append the
generated value instead of `>> .env` directly — appending onto the example as-is
would leave two lines with the same key (harmless, since env-file parsing is
last-wins, but confusing to anyone editing `.env` by hand):

```bash
grep -v '^OPENLINKER_CREDENTIALS_ENCRYPTION_KEY=' .env.example > .env
echo "OPENLINKER_CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
```

Example resulting `.env` (the value below is an example — generate your own):

```dotenv
# Local demo secret — gitignored, never committed.
OPENLINKER_CREDENTIALS_ENCRYPTION_KEY=rp92Yn0oNBH+VTIdcIpsXGJ8mcMg18w5mdNUPpLMoP8=
```

### Already set for you (baked into the Compose files — no action needed)

These are hardcoded in `docker-compose.yml` / `docker-compose.demo.yml` with
demo-safe values. Listed here so you know what's in play if you want to override:

| Variable | Value in the demo | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Production posture for the app tier. |
| `OL_BOOTSTRAP_ADMIN_PASSWORD` | `admin` | Keeps the seeded admin login `admin` / `admin` under `NODE_ENV=production`. |
| `OL_CORS_ORIGIN` | `http://localhost:8090` | API CORS allow-list — must match the UI origin or login fails with a CORS "NetworkError". |
| `VITE_API_BASE_URL` | `http://localhost:3000` | Baked into the UI bundle **at build time** — the browser-reachable API origin. |
| `DB_*` / `REDIS_*` | `postgres` / `redis` (service names) | App tier reaches Postgres/Redis over the Compose network. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev values | Auth token signing. |
| `OL_PII_HASH_SALT` | dev value | Customer-identifier hashing in sync jobs. |

> `VITE_API_BASE_URL` is a **build-time** input — changing it requires rebuilding
> the `web` image (`pnpm demo:up` rebuilds when the arg changes).

---

## 3. Boot the stack

```bash
pnpm demo:up        # builds the images and starts everything (first run: several minutes)
pnpm demo:logs      # follow the logs
pnpm demo:down      # stop the stack (add -v to also wipe the data volumes)
```

`pnpm demo:up` wraps:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build \
  postgres redis mysql phpmyadmin woocommerce-mysql woocommerce prestashop migrate api worker web
```

Boot order is enforced by `depends_on` (not the CLI service list):
**Postgres healthy → one-shot `migrate` runs to completion → `api` + `worker`
start**; PrestaShop and WooCommerce auto-install in parallel; `web` is static
(nginx) and needs nothing. Migrations run automatically — no manual
`migration:run`.

Wait until the app tier is healthy:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml ps
curl -s http://localhost:3000/v1/health         # expect {"status":"ok",...}
```

PrestaShop and WooCommerce take the longest (auto-install + seed / plugin
download); give them a few minutes on the first run.

---

## 4. Service URLs & credentials

| Service | URL | Credentials |
|---|---|---|
| OpenLinker admin UI | http://localhost:8090 | `admin` / `admin` |
| OpenLinker API | http://localhost:3000 | — (JWT via the UI) |
| PrestaShop storefront | http://localhost:8080 | — |
| PrestaShop admin | http://localhost:8080/**admin-dev** | `demo@prestashop.com` / `prestashop_demo` |
| phpMyAdmin | http://localhost:8081 | `root` / `root` |
| WooCommerce storefront | http://localhost:8082 | — |
| WooCommerce admin (`wp-admin`) | http://localhost:8082/wp-admin | `admin` / `admin123` |

> The PrestaShop admin folder is `admin-dev` (the post-install step renames the
> randomized install folder), **not** `/admin`.

---

## 5. Wire the PrestaShop connection

The PrestaShop ↔ OpenLinker connection is configured **manually** in the UI. Two
manual PrestaShop-side steps first, then the OpenLinker side.

### 5.1 Enable the PrestaShop Webservice + generate a key

1. Log in to PrestaShop admin (`http://localhost:8080/admin-dev`).
2. **Advanced Parameters → Webservice** → set **Enable PrestaShop's webservice** = **Yes** → Save.
3. **Add new webservice key** → **Generate!** → set **Status** = Enabled → grant
   permissions (the simplest is to check the "all" / view+modify boxes for the
   resources you'll sync: `products`, `combinations`, `stock_availables`,
   `orders`, `customers`, `addresses`, …) → Save. **Copy the generated key.**

### 5.2 Create the connection in OpenLinker

In the UI: **Connections → New → PrestaShop**.

| Field | Value | Notes |
|---|---|---|
| Connection name | e.g. `Demo PrestaShop` | Free text. |
| **Shop URL** | `http://prestashop` | **Not** `http://localhost:8080`. The API/Worker containers reach PrestaShop over the Compose network by its **service name**; `localhost` inside a container is the container itself. |
| **Storefront URL** | `http://prestashop` | Same reason — OpenLinker **downloads product image bytes server-side** (then re-uploads them to the marketplace CDN), so the image base must be container-reachable. |
| Webservice key | *(paste from 5.1)* | |
| Shop ID | *(blank)* | Single-shop install. |

The demo pre-configures PrestaShop so the `http://prestashop` host resolves the
shop without a canonical-domain redirect (a `prestashop`-domain `ps_shop_url`
row + `PS_CANONICAL_REDIRECT=0`, added by a post-install step), so the
`Verify credentials` step (`GET /api/products?limit=1`) succeeds.

> **Known limitation:** with the Storefront URL set to `http://prestashop`, image
> *download* works from the app tier, but your **browser** can't resolve
> `prestashop`, so product thumbnails in the OpenLinker UI won't render. This is a
> tracked follow-up (decoupling the server-side download base from the browser
> display base). For the demo, prefer a working image sync over rendered
> thumbnails.

After connecting, OpenLinker syncs the seeded catalog (6 products + variants). See
them under **Products**.

---

## 6. Wire the Allegro connection (optional)

Allegro is an external service — the credentials come from an app **you register**
in the Allegro developer portal; they cannot be seeded. Use the **sandbox** for
testing.

1. Create a sandbox account at `https://allegro.pl.allegrosandbox.pl`.
2. In the sandbox developer portal
   (`https://apps.developer.allegro.pl.allegrosandbox.pl`), create an app of type
   **"application with a browser-based flow (Authorization Code)"** — only that
   type has a Client Secret.
3. Register the redirect URI **exactly** as the wizard shows:
   `http://localhost:8090/integrations/allegro/connect/callback`
4. In OpenLinker: **Connections → New → Allegro**, paste **Client ID** + **Client
   Secret**, and on the **Environment** step choose **Sandbox**. Complete the OAuth
   redirect.
5. **Seller defaults** — before creating offers, fill the seller-defaults section
   on the Allegro connection's edit page: **ship-from location**, **Responsible
   Producer** (GPSR), and **safety information** (GPSR). Offer creation fails with
   `SELLER_DEFAULTS_NOT_CONFIGURED` until these are set. The values come from your
   Allegro account.

> **Required category parameters (e.g. "Stan"/Condition).** Most Allegro
> categories require offer parameters like `Stan`. In the **single-offer** wizard
> (Listings → "Create offer") you pick a category and fill the parameter step
> (set `Stan = Nowy`). Supplying these in the **bulk** flow requires
> [#1367](https://github.com/openlinker-project/openlinker/issues/1367) /
> [#1370](https://github.com/openlinker-project/openlinker/pull/1370).

---

## 7. Verify the end-to-end flow

1. **Products synced:** `Products` lists the 6 seeded PrestaShop items, each with a
   `prestashop` source mapping.
2. **Create an offer** (with an Allegro sandbox connection): Listings →
   "Create offer" → pick a product/variant → resolve/pick the Allegro category →
   fill required parameters (`Stan = Nowy`) → submit. The Worker processes the
   `marketplace.offer.create` job; watch it with:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.demo.yml logs -f worker
   ```
3. **Sync jobs:** the `Diagnostics` / sync-jobs view shows job status and outcome.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot aborts; `migrate` exits 1 with `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY is required` | The required key is unset. | Set it in `.env` (section 2), then `pnpm demo:up` again. |
| UI login fails: `NetworkError when attempting to fetch resource` | API CORS doesn't allow the UI origin. | Ensure `OL_CORS_ORIGIN` matches the UI origin (`http://localhost:8090`; already set in the demo overlay). Hard-refresh the browser. |
| `mysql` reported `unhealthy`, `prestashop`/`phpmyadmin` don't start | On a slow host, MySQL first-boot init exceeded the healthcheck window. | The demo sets `start_period: 180s`; if it still trips, retry `pnpm demo:up` — the second start (initialized volume) is fast. |
| PrestaShop admin 404 at `/admin` | The install folder is renamed to `admin-dev`. | Use `http://localhost:8080/admin-dev`. |
| Connection `Verify credentials` fails / webservice 301-redirects | Shop URL set to `localhost`, or Host≠shop-domain redirect. | Use `http://prestashop` for Shop URL (section 5.2). Confirm Webservice is enabled and the key is active. |
| Offer fails `IMAGE_DOWNLOAD_FAILED` | Image base not container-reachable (Storefront URL was `localhost`). | Set the connection's Storefront URL to `http://prestashop` and re-sync products. |
| Offer fails `SELLER_DEFAULTS_NOT_CONFIGURED` | Allegro seller-defaults missing. | Fill ship-from location / Responsible Producer / safety information on the connection edit page (section 6). |
| Offer fails `PARAMETER_REQUIRED` (`Stan`, …) | A required Allegro category parameter has no value. | Set it in the offer wizard's parameter step (single-offer wizard renders it). |

Useful commands:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml ps          # service states
docker compose -f docker-compose.yml -f docker-compose.demo.yml logs migrate  # migration output
docker compose -f docker-compose.yml -f docker-compose.demo.yml logs -f api worker
curl -s http://localhost:3000/v1/health
```

---

## 9. Teardown

```bash
pnpm demo:down       # stop the stack, keep data volumes
pnpm demo:down -v    # stop and WIPE the data volumes (fresh start next time)
```

Because the demo shares the `openlinker` Compose project with `pnpm dev:stack:up`,
`-v` wipes volumes shared with the dev stack too — see the warning in section 1.

---

## 10. Running on a shared server / multiple instances

By default every published port binds to `127.0.0.1` and every container name
is prefixed `openlinker-` — safe on a single-user laptop, but two things to
know before running this on a shared/public host (#1400):

- **Loopback binding is the default, not an accident.** `postgres` / `redis` /
  `mysql` / `phpmyadmin` / `prestashop` / `api` all publish on `127.0.0.1` so
  they're never reachable from outside the host just because a firewall
  wasn't configured — put a reverse proxy in front of `web` (and `api`, if the
  browser needs to reach it directly) for anything beyond localhost access.
  Override the bind interface with `OL_BIND_ADDRESS` in `.env` only if a
  service genuinely needs to be reachable beyond loopback.
- **Running a second instance alongside an existing one** (e.g. a per-PR
  preview environment, or a staging + demo pair on the same host): set a
  distinct `COMPOSE_PROJECT_NAME` (renames the project and every
  `container_name`) plus distinct `*_HOST_PORT` overrides
  (`POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `MYSQL_HOST_PORT`,
  `PHPMYADMIN_HOST_PORT`, `PRESTASHOP_HOST_PORT`,
  `WOOCOMMERCE_MYSQL_HOST_PORT`, `WOOCOMMERCE_HOST_PORT`, `API_HOST_PORT`,
  `WEB_HOST_PORT`) in that instance's own `.env` — see `.env.example` for the
  full list and defaults.

> `pnpm dev:stack:seed-woocommerce` / `pnpm dev:stack:wc-credentials` invoke
> `docker exec openlinker-woocommerce` directly and don't yet respect a custom
> `COMPOSE_PROJECT_NAME` — a known limitation when running a second instance,
> tracked as a documented gap rather than fixed here.
