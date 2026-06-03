# Getting Started

End-to-end walkthrough: from a clean machine to a fully-configured OpenLinker instance with PrestaShop and Allegro connected, catalog synced, and categories mapped — ready to start creating offers and ingesting orders.

> **Using WooCommerce instead of PrestaShop?** Both shop adapters are fully supported.
> See the **[WooCommerce Setup Guide](./integrations/woocommerce/setup-guide.md)** for a
> WooCommerce-specific walkthrough. The dev stack includes WooCommerce at **http://localhost:8082**
> — run `pnpm dev:stack:wc-credentials` after startup to get the API credentials.

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

The first `docker compose up` automatically renames the admin folder, sets PLN as the default currency, and seeds 5 fixtures sourced from real Allegro listings — the entrypoint wrapper polls for install completion and runs every script in `docker/prestashop/post-install/` in order:

- `10-rename-admin.sh` — renames the random `/admin{hash}/` folder to a stable `/admin-dev/`
- `20-set-default-currency.sh` — flips the shop's default currency to **PLN** (EUR / USD remain active)
- `30-seed-test-products.sh` — replaces the upstream demo catalogue with **five fixtures** sourced from real Allegro listings (full table below)

All three scripts are idempotent — restarting the container or re-running the wrapper is a no-op once each piece has been applied.

To **force a re-seed** (e.g. after manually breaking PS data during development), run:

```bash
pnpm dev:stack:seed-prestashop
```

> If you're upgrading from a pre-#525 dev stack, the entrypoint change requires a one-time `docker compose down && docker compose up -d prestashop` (Compose's `restart` doesn't recreate containers on entrypoint change).

Log in to the PrestaShop admin at **http://localhost:8080/admin-dev/** with the default credentials (set in `docker-compose.yml`):

- Email: `demo@prestashop.com`
- Password: `prestashop_demo`

> If you still see `/install` in the URL, the auto-install hasn't completed yet — wait another minute, or `docker compose logs -f prestashop` to watch progress. Lines tagged `* [ps-post-install]` are the wrapper's progress output.

### Dev fixture catalogue

The seed populates exactly these five products, covering the variant × EAN-coverage matrix our codebase exercises (offer linking by barcode, simple-product synthetic variants, partial barcode coverage, etc.):

| Reference | Shape | EAN coverage | Source |
|---|---|---|---|
| `OL-BOSCH-GSR12V15` | simple, no variants | yes (`3165140846264`) | Bosch Professional cordless drill — Allegro: Narzędzia / Wkrętarki |
| `OL-MUG-LIN-300` | simple, no variants | empty | Handmade ceramic mug — Allegro: Dom i Ogród / Kuchnia |
| `OL-ADIDAS-IA4845` | variants × 3 sizes (S/M/L) | per-variant EAN on every combination | adidas Adicolor 3-Stripes Tee — Allegro: Moda / Odzież męska |
| `OL-SOAP-NATURAL` | variants × 2 colours (Lavender/Rose) | partial — Lavender has EAN, Rose doesn't | Artisan cold-process soap — Allegro: Dom i Ogród / Wyposażenie |
| `OL-RING-RESIN` | variants × 3 sizes (16/18/20mm) | empty on every combination | Handmade resin ring — Allegro: Biżuteria / Pierścionki |

**Reference prefix convention:** the seed treats `OL-*` as fixtures it owns (never wiped on re-seed) and **`OP-*`** as operator-preserve — if you hand-add a product through the PS admin during testing and want it to survive `pnpm dev:stack:seed-prestashop` re-runs, prefix its reference with `OP-`. Anything else is treated as upstream demo data and wiped.

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
pnpm start:dev:web       # http://localhost:4173
pnpm start:dev:worker    # background sync jobs
```

Health check:

```bash
curl -s http://localhost:3000/health/dev-stack | jq .
```

Once the worker is running (`pnpm start:dev:worker`), the **System Health** panel at **http://localhost:4173** (dashboard) will show four tiles: PostgreSQL, Redis, PrestaShop, and Worker. The Worker tile confirms the background sync worker is alive; if it remains red after the worker starts, check the worker logs for errors.

## 3. Admin user & login

Log in at **http://localhost:4173**.

On first boot the API seeds a default admin user if no users exist and prints the credentials to the log once:

```
[BootstrapAdminService] Default admin credentials: username=admin password=<generated>
```

Use those credentials on the login screen. The seed is idempotent — restarting the API will not overwrite a user that already exists.

### Password reset

Click **Forgot password?** on the login screen and enter the admin email (`admin@openlinker.local` by default). The API logs the reset link to the console:

```
[ConsolePasswordResetNotifierAdapter] [password-reset] user=admin email=admin@openlinker.local link=http://localhost:4173/reset-password/<token>
```

Open that link in your browser, enter a new password, and log in normally.

> The link always uses port **4173** (the Vite dev server). If you run the web app on a different port, set `WEB_URL=http://localhost:<port>` in `apps/api/.env.local`.

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
3. Click **Create connection**. You are redirected to the connection detail page.

### 4.3 Verify

Open the connection detail page. You should see:

- Platform `prestashop`, Adapter `prestashop.webservice.v1`, status **active**.
- Config `{ "baseUrl": "http://localhost:8080/" }`.
- Capability pills: **ProductMaster**, **InventoryMaster**, **OrderProcessorManager**.

Click **Test connection** — it should return a green success indicator confirming the webservice key is valid and all capabilities resolve correctly.

## 5. Allegro connection (OAuth sandbox)

### 5.1 Register a sandbox application on Allegro

1. Sign in at https://apps.developer.allegro.pl.allegrosandbox.pl/ (use your real Allegro account — sandbox shares the auth).
2. **My applications → Register new application** → select **Application with user authorization (OAuth)**.
3. Fill in:
   - **Name**: e.g. `OpenLinker dev`
   - **Redirect URI**: `http://localhost:4173/integrations/allegro/connect/callback`
4. Save and copy the generated **Client ID** and **Client Secret**.

### 5.2 Create the connection in OpenLinker

1. In the OpenLinker web app → **Add connection** → **Guided setup** → choose **Allegro**.
2. Fill in:
   - **Connection name**: e.g. `Allegro sandbox`
   - **Environment**: **Sandbox**
   - **Client ID** / **Client Secret**: from step 5.1
3. Click **Connect**. You are redirected to Allegro → authorize the app → redirected back to the OpenLinker web app. The connection should appear with status **active**.

> You may see a burst of `OAuth state not found or expired` warnings in the API log after a successful connect — the callback fires multiple times in dev and only the first exchange succeeds. Harmless; tracked in [#172](https://github.com/openlinker-project/openlinker/issues/172).

### 5.3 Verify

Open the connection detail page. You should see:

- Platform `allegro`, Adapter `allegro.publicapi.v1`, status **active**.
- Capability pill: **Marketplace**.

Click **Test connection** — it should return a green success indicator.

> **Category Mappings** on the Allegro connection detail is hidden — category mapping is driven from the PrestaShop (source) side, see §7.

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

**Inventory levels:** once the inventory scheduler runs, open **Inventory** in the left nav (http://localhost:4173/inventory) to see available and reserved quantities per product.

If no products appear: confirm the worker is running (`pnpm start:dev:worker`)
and check the Jobs & Logs page for the `master.product.syncAll` job status.

## 7. Category & attribute mapping

Category mapping connects your PrestaShop categories to Allegro's category tree so offers can be created in the correct Allegro category.

### 7.1 Open the mapping page

1. In OpenLinker → **Integrations** → click your **PrestaShop connection**.
2. Click **Category Mappings** in the connection detail page.
3. The page loads with:
   - **Left panel**: PrestaShop category tree
   - **Right panel**: Allegro category browser
   - **Marketplace connection** selector at the top (auto-picks your Allegro connection if only one exists)

> The **Category Mappings** entry is only shown on ProductMaster-capable connections (PrestaShop). It is hidden on Allegro connection detail pages.

### 7.2 Map a category

1. Click a PrestaShop category in the left panel — it highlights and the right panel activates.
2. Browse the Allegro category tree using **Browse** to drill into subcategories. Use the breadcrumb at the top to navigate back up.
3. When you find the right Allegro category, click **Select** — a blue preview bar appears at the top of the right panel showing your pick.
4. Click **Save mapping** to persist. The row in the left panel updates to show the mapped Allegro category name.

### 7.3 Change or remove a mapping

- To **change**: click the PS category again, pick a different Allegro category, click **Select** → **Save mapping**.
- To **remove**: click the PS category → click **Clear mapping** in the green bar at the top of the right panel.

Repeat for each category you intend to list products in on Allegro.

## What's next

With both connections active, products discovered, and at least one category mapped, you're ready to:

- **Create your first Allegro offer from a PrestaShop product.** Walkthrough in progress — tracked in [#429](https://github.com/openlinker-project/openlinker/issues/429) (Allegro offer-creation epic). The flow is functional today; the screenshot-level guide is the next doc to land.
- **Watch an Allegro order land in PrestaShop.** End-to-end sandbox walkthrough tracked in [#152](https://github.com/openlinker-project/openlinker/issues/152) (clean-state E2E epic). The ingestion path is exercised today by the carrier-mapping vertical-slice int-spec (landed in [PR #671](https://github.com/openlinker-project/openlinker/pull/671), closing [#535](https://github.com/openlinker-project/openlinker/issues/535)) — the user-facing walkthrough is the missing piece.

Until those walkthroughs land, the **Jobs & Logs** page in the OpenLinker web app (`http://localhost:4173/jobs-logs`) is the best place to watch sync activity, and the **Orders** page (`http://localhost:4173/orders`) surfaces orders as they ingest.
