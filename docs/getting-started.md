# Getting Started

End-to-end walkthrough: from a clean machine to a first Allegro order synced into PrestaShop via OpenLinker.

> **Status:** work in progress. Built incrementally as part of [#152](https://github.com/SilkSoftwareHouse/openlinker/issues/152). Sections marked _TBD_ are not yet documented.

## Prerequisites

- Docker + Docker Compose
- Node.js LTS, pnpm
- An Allegro sandbox account (https://apps.developer.allegro.pl.allegrosandbox.pl/)

## 1. Clean dev stack

Wipe any previous state and bring up Postgres, Redis, MySQL, and PrestaShop:

```bash
docker compose down -v
pnpm install
pnpm dev:stack:up
```

Wait until PrestaShop finishes its unattended install (~2–3 min). Check:

```bash
docker compose ps
curl -sI http://localhost:8080 | head -1   # expect 302 → /en/
```

Log in to the PrestaShop admin at **http://localhost:8080/admin-dev/** with the default credentials (set in `docker-compose.yml`):

- Email: `demo@prestashop.com`
- Password: `prestashop_demo`

> If you still see `/install` in the URL, the auto-install hasn't completed yet — wait another minute, or `docker compose logs -f prestashop` to watch progress.

## 2. Environment, migrations & apps

Copy the example env file and adjust if needed (defaults match the dev stack):

```bash
cp apps/api/.env.example apps/api/.env.local
cp apps/worker/.env.example apps/worker/.env.local
```

Run migrations, then start the API and the web app (in separate terminals):

```bash
pnpm --filter @openlinker/api migration:run
pnpm start:dev:api       # http://localhost:3000
pnpm start:dev:web       # http://localhost:5173
pnpm start:dev:worker    # background sync jobs
```

Health check:

```bash
curl -s http://localhost:3000/health/dev-stack | jq .
```

Once the worker is running (`pnpm start:dev:worker`), the **System Health** panel at **http://localhost:5173** (dashboard) will show four tiles: PostgreSQL, Redis, PrestaShop, and Worker. The Worker tile confirms the background sync worker is alive; if it remains red after the worker starts, check the worker logs for errors.

## 3. Admin user & login

Log in at http://localhost:5173.

- Default admin seeding is tracked in [#157](https://github.com/SilkSoftwareHouse/openlinker/issues/157).
- Password reset flow is tracked in [#158](https://github.com/SilkSoftwareHouse/openlinker/issues/158).

## 4. PrestaShop connection

### 4.1 Generate a PrestaShop webservice API key

1. Open the PrestaShop admin → **Advanced Parameters → Webservice**.
2. The webservice is already enabled by the dev stack. Click **Add new webservice key**.
3. In the key form:
   - **Description**: e.g. `OpenLinker dev`
   - **Permissions**: tick the **View (GET)** column header to grant read on all resources (tighten later for production).
4. Save and copy the generated key.

> Ignore the "Webservice URL rewriting not functional" warning on the status panel — that check runs from inside the container against `localhost:8080` and is irrelevant for calls from the host.

### 4.2 Create the connection in OpenLinker

1. In the OpenLinker web app → **Add connection** → **Guided setup** → choose **PrestaShop**.
2. Fill in:
   - **Connection name**: e.g. `Prestashop store`
   - **Shop URL**: `http://localhost:8080/`
   - **Webservice key**: the key from step 4.1
   - **Shop ID**: leave blank (single-shop install)
3. Click **Create connection**.

> Post-create UX is a known gap — see [#163](https://github.com/SilkSoftwareHouse/openlinker/issues/163). The form clears silently; navigate to **Integrations** to see the new connection.

> **Credentials workaround** (until [#165](https://github.com/SilkSoftwareHouse/openlinker/issues/165) lands): the wizard stores the webservice key as the `credentialsRef` itself, and the backend resolves it via env var. Add this to `apps/api/.env.local` and restart the API:
>
> ```
> CREDENTIALS_<WEBSERVICE_KEY_UPPERCASE>=<WEBSERVICE_KEY>
> ```
>
> (e.g. if your key is `ABC123`, add `CREDENTIALS_ABC123=ABC123`.) **Add the same line to `apps/worker/.env.local`** and restart the worker, otherwise background sync jobs will fail too. Without this, every adapter-backed page returns a 500.

### 4.3 Verify

Open the connection detail page. You should see:

- Platform `prestashop`, Adapter `prestashop.webservice.v1`, status **active**.
- Config `{ "baseUrl": "http://localhost:8080/" }`.

A dedicated "Test connection" button and capability list are tracked in [#164](https://github.com/SilkSoftwareHouse/openlinker/issues/164).

## 5. Allegro connection (OAuth sandbox)

### 5.1 Register a sandbox application on Allegro

1. Sign in at https://apps.developer.allegro.pl.allegrosandbox.pl/ (use your real Allegro account — sandbox shares the auth).
2. **My applications → Register new application** → select **Application with user authorization (OAuth)**.
3. Fill in:
   - **Name**: e.g. `OpenLinker dev`
   - **Redirect URI**: `http://localhost:5173/integrations/allegro/connect/callback`
4. Save and copy the generated **Client ID** and **Client Secret**.

### 5.2 Create the connection in OpenLinker

1. In the OpenLinker web app → **Add connection** → **Guided setup** → choose **Allegro**.
2. Fill in:
   - **Connection name**: e.g. `Allegro sandbox`
   - **Environment**: **Sandbox**
   - **Client ID** / **Client Secret**: from step 5.1
3. Click **Connect**. You're redirected to Allegro → authorize the app → redirected back to the OpenLinker web app. The connection should appear with status **active**.

> You may see a burst of `OAuth state not found or expired` warnings in the API log after a successful connect — the callback effect fires multiple times in dev and only the first exchange succeeds. Harmless; tracked in [#172](https://github.com/SilkSoftwareHouse/openlinker/issues/172).

### 5.3 Verify

Open the connection detail page. You should see:

- Platform `allegro`, Adapter `allegro.publicapi.v1`, status **active**.
- Capabilities resolved to `Marketplace` (Test connection button + capability pills tracked in [#164](https://github.com/SilkSoftwareHouse/openlinker/issues/164)).

> Do **not** click **Category Mappings** on the Allegro connection detail — it currently crashes (tracked in [#173](https://github.com/SilkSoftwareHouse/openlinker/issues/173)). Category mapping is driven from the PrestaShop (source) side — see §7.

## 6. Initial catalog & inventory pull

**Products — automatic:** creating a PrestaShop connection (step 4) automatically
enqueues a one-shot `master.product.syncAll` job. Once the worker picks it up,
the source catalog is enumerated and a per-product sync job is fanned out for
every product. You should see products appear in OpenLinker within a minute or
two of the worker starting.

Recurring catalog re-sync runs every 20 minutes by default (configurable via
`OL_PRODUCT_SYNC_CRON` / `OL_PRODUCT_SYNC_ENABLED` in `apps/api/.env`).

**Products — manual:** on the connection detail page, click **Sync products now**
to enqueue a catalog discovery pass on demand. Safe to run anytime; subsequent
runs update existing projections rather than duplicating.

**Inventory:** the `OL_INVENTORY_SYNC_ENABLED` scheduler refreshes stock every
15 minutes for all products already discovered by the catalog sync above.

If no products appear: confirm the worker is running (`pnpm start:dev:worker`)
and check the Jobs & Logs page for the `master.product.syncAll` job status.

## 7. Category & attribute mapping

_TBD_

## 8. First offer

_TBD_

## 9. First order end-to-end

_TBD_
