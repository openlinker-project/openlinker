# WooCommerce Master-Shop Setup Guide

**Setup Time:** ~25 minutes
**Target Audience:** Developers (local dev setup)
**Scope:** WooCommerce as a **master shop** — OpenLinker reads its product catalog and inventory, and can route marketplace orders into it as a destination shop. This is a local-development walkthrough (Docker dev stack + `start:dev` processes), not a production deployment guide.

> **Applies to:** the WooCommerce master-shop adapter (product spec #872). The runtime behaviour described here ships with the WooCommerce integration package; if your checkout predates it, the WooCommerce connection type and the `dev:stack:wc:up` / `dev:stack:wc-credentials` / `dev:stack:seed-woocommerce` scripts below will not be present yet.

---

## What this guide covers

By the end you will have:

1. ✅ WooCommerce running locally in Docker
2. ✅ OpenLinker API + worker + web app running
3. ✅ A WooCommerce connection created in OpenLinker
4. ✅ WooCommerce's product catalog and per-variant inventory read into OpenLinker
5. ✅ *(Optional)* WooCommerce products listed on a marketplace (Allegro), inventory propagated to those offers, and marketplace orders routed into WooCommerce as a destination shop

## What this guide does **not** cover

OpenLinker treats WooCommerce as a **master shop** (a source of products/inventory and a destination for orders), the same role PrestaShop plays. It is **not** a shop-to-shop bridge. Specifically, the following are **not implemented today** — see [§ 7 Known Limitations](#-7-known-limitations--not-yet-supported):

- Ingesting orders *out of* WooCommerce (`OrderSource`).
- Pushing products or inventory *from another shop into* WooCommerce (no shop→shop sync).
- Cross-platform category/attribute mapping (ADR — *Proposed*).

---

## Architecture: WooCommerce as a master shop

**Core flow — always available (the WooCommerce adapter):**

```
  WooCommerce  ──── read products ────▶  OpenLinker (catalog)
  WooCommerce  ──── read inventory ───▶  OpenLinker (per-variant stock)
```

**Optional flow — only with a marketplace connection (e.g. Allegro):**

```
  OpenLinker (catalog)  ──── create offers ─────▶  Allegro (offers)
  OpenLinker (stock)    ──── update quantity ───▶  Allegro (offer quantities)

  Allegro (order)  ── ingest ─▶  OpenLinker  ── create order ─▶  WooCommerce
```

**Data direction (implemented):**

*Core (WooCommerce adapter):*
- **Products:** WooCommerce → OpenLinker (read into the internal catalog).
- **Inventory:** WooCommerce → OpenLinker (per-variant read).

*Optional — requires a marketplace connection (e.g. Allegro):*
- **Offers:** OpenLinker catalog → marketplace offers; WooCommerce stock → marketplace **offer quantities**.
- **Orders:** marketplace → OpenLinker → WooCommerce (created via `OrderProcessorManager`).

WooCommerce is the source of truth for its own catalog and stock. OpenLinker reads from it; it does not write products or stock back into WooCommerce.

---

## Prerequisites

- **Docker & Docker Compose** v2.0+ (`docker compose version`)
- **Node.js** LTS (18.x or 20.x) and **pnpm** (`pnpm --version`)
- **Git** (the OpenLinker repo cloned)
- **`jq`** (used by the credentials helper script)
- Several GB free disk space (container images + databases)

**Ports used:**
- 3000 (OpenLinker API), 5173 (web UI), 5432 (PostgreSQL), 6379 (Redis)
- 8082 (WooCommerce), 3307 (WooCommerce MySQL)

No external API keys are needed for local testing.

---

## § 1: Start WooCommerce (Docker)

From the OpenLinker repo root:

```bash
# 1. Base stack (PostgreSQL, Redis, …)
pnpm dev:stack:up

# 2. WooCommerce + its dedicated MySQL
pnpm dev:stack:wc:up
```

**Wait ~3–5 minutes** for WordPress auto-install + WooCommerce plugin activation.

### Verify WooCommerce is running

```bash
# REST API health check — should return HTTP/1.1 200 OK
curl -sI http://localhost:8082/wp-json/wc/v3/ | head -1

# Container logs
pnpm dev:stack:logs
```

### Access WooCommerce admin (optional)

- **URL:** http://localhost:8082/wp-admin/
- **Username:** `admin`
- **Password:** `admin123`

> The dev container seeds a few sample products on first boot. Re-run the seeding any time with `pnpm dev:stack:seed-woocommerce` (idempotent).

---

## § 2: Get WooCommerce REST API credentials

OpenLinker authenticates to WooCommerce with a REST API **consumer key + secret**.

### Fast path (dev stack auto-seeds them)

The dev container generates a Read/Write key on first boot. Print it on the host:

```bash
pnpm dev:stack:wc-credentials
```

```json
{
  "consumer_key": "ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "consumer_secret": "cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Copy both values — you'll paste them in § 4.

### Manual path (real WooCommerce, or to rotate the key)

1. WooCommerce admin → **Settings → Advanced → REST API**
2. **Create an API key**
3. **Description:** `OpenLinker`; **Permissions:** `Read/Write`; **User:** an admin
4. **Generate API Key** and copy the **Consumer Key** (`ck_…`) and **Consumer Secret** (`cs_…`)

> The Consumer Secret is shown only once — copy it immediately.

---

## § 3: Boot OpenLinker

### 3.1 Environment files

```bash
cp apps/api/.env.example apps/api/.env.local
cp apps/worker/.env.example apps/worker/.env.local
```

The defaults target the local dev stack (Postgres `localhost:5432`, Redis `localhost:6379`).

### 3.2 Run database migrations

```bash
pnpm --filter @openlinker/api migration:run
# Expected: Migration up completed successfully
```

### 3.3 Start API, worker, web (three terminals)

```bash
pnpm start:dev:api      # http://localhost:3000
pnpm start:dev:worker   # background sync-job runner
pnpm start:dev:web      # http://localhost:5173
```

Wait for all three to report ready. Log in to the web app with the admin credentials printed in the API logs on first boot (`Default admin credentials: username=admin password=…`).

---

## § 4: Add the WooCommerce connection

1. In the web app, go to **Connections → Add Connection** (`/connections/new`).
2. Select **WooCommerce**.
3. Fill in the setup form:
   - **Connection name:** `WooCommerce Store`
   - **Shop URL:** `http://localhost:8082/`
   - **Consumer Key:** `ck_…` (from § 2)
   - **Consumer Secret:** `cs_…` (from § 2)
4. Click **Test connection** to verify the credentials, then **Create connection**.

**[Screenshot Placeholder: WooCommerce setup form, filled]**
- Fields: Connection name, Shop URL, Consumer Key (masked), Consumer Secret (masked); green "Test connection" result.

The connection detail page shows **Active** with capability pills.

> **Note on capability pills:** the WooCommerce adapter advertises `ProductMaster`, `InventoryMaster`, and `OrderProcessorManager`, all of which work. An `OrderSource` pill may also appear because it is advertised in the adapter manifest, but **WooCommerce order ingestion is not implemented yet** — do not rely on it (see [§ 7](#-7-known-limitations--not-yet-supported)).

---

## § 5: Verify OpenLinker reads the WooCommerce catalog + inventory

WooCommerce is a **master** for its own products and stock. OpenLinker pulls them into its internal catalog.

### 5.1 Trigger the product + inventory sync

On the **WooCommerce connection detail** page, open the **Trigger sync** dialog and run `master.product.syncAll`, then `master.inventory.syncAll` (or wait for the scheduled runs). Watch progress under **Jobs & Logs**.

### 5.2 Verify products in OpenLinker

Open **Products**. You should see the WooCommerce products with:
- Name, SKU/reference
- Variants (variable products list one row per variation; simple products map to a single deterministic synthetic variant)

**[Screenshot Placeholder: OpenLinker Products list populated from WooCommerce]**

### 5.3 Verify inventory in OpenLinker

Open **Inventory**. Stock is tracked **per variant**, read from each WooCommerce variation's `stock_quantity` (simple products report on their synthetic variant).

**[Screenshot Placeholder: OpenLinker Inventory list with per-variant stock]**

> This is a one-way read: OpenLinker reflects WooCommerce's stock. Changing stock in OpenLinker does not write back to WooCommerce.

---

## § 6: (Optional) Full flow — list on a marketplace and route orders

This section demonstrates the end-to-end multi-platform flow. It **requires a marketplace connection** (Allegro is the reference implementation).

1. **List the catalog as offers.** With WooCommerce products in OpenLinker's catalog, create offers on the marketplace (Allegro) for the variants you want to sell. Each offer links to its product by barcode/SKU.
2. **Propagate inventory to offers.** The `inventory.propagateToMarketplaces` job updates marketplace **offer quantities** from the master stock OpenLinker read from WooCommerce (fanning out to per-offer `marketplace.offerQuantity.update`). WooCommerce stock → Allegro offer quantity.
3. **Route incoming orders into WooCommerce.** A marketplace order ingested by OpenLinker is created in the destination shop via `OrderProcessorManager`. WooCommerce can be that destination — `createOrder` provisions the order (and customer, as a guest if needed), and `updateFulfillment` writes status changes to the WooCommerce order.

> **Tracking numbers:** `updateFulfillment` accepts a tracking number but does not yet persist it to the WooCommerce order — only the order status is written.

---

## § 7: Known Limitations / Not Yet Supported

*Accurate as of 2026-06-09 — revisit when the WooCommerce adapter gains the capabilities below.*

- **WooCommerce `OrderSource` is not implemented.** Orders created directly in WooCommerce **cannot** be ingested into OpenLinker — there is no order feed/poll for WooCommerce. The capability is advertised in the manifest but not wired. OpenLinker ingests orders from marketplaces (e.g. Allegro), not from WooCommerce.
- **No shop→shop product or inventory sync.** OpenLinker does not push products or stock from one shop into another (e.g. PrestaShop → WooCommerce). Inventory propagation targets marketplace **offers**, not other shops. WooCommerce's catalog/stock is read-only from OpenLinker's perspective.
- **No cross-platform category/attribute mapping.** Mapping categories and attributes between platforms (the subject of a *Proposed* ADR) is not implemented. Offers are created from raw product data; category/attribute mismatches may cause offer rejection on strict marketplaces.
- **No inventory reservation.** The WooCommerce adapter does not support `reserveInventory` / `releaseInventory` (the WooCommerce REST API does not expose reservation).

---

## Troubleshooting

1. **WooCommerce won't start / API 404** — give it the full 3–5 min; check `pnpm dev:stack:logs`. The healthcheck probes `/wp-json/wc/v3/`.
2. **Connection test fails (401/403)** — re-check the consumer key/secret (`pnpm dev:stack:wc-credentials`) and that the key is **Read/Write**.
3. **No products in OpenLinker** — confirm the sync job ran under **Jobs & Logs**; re-seed WooCommerce with `pnpm dev:stack:seed-woocommerce`.
4. **API/worker errors** — check the API and worker terminal output.

---

## Summary

You now have:

- ✅ WooCommerce running locally and connected to OpenLinker
- ✅ WooCommerce's catalog and per-variant inventory read into OpenLinker
- ✅ *(optional)* WooCommerce products listed on a marketplace with inventory propagated to offers, and marketplace orders routed into WooCommerce

**Key principle:** WooCommerce is a **master shop** — OpenLinker reads its products and inventory, lists them on marketplaces, and writes marketplace orders into it. OpenLinker does not write products/stock back into WooCommerce, and does not yet ingest orders out of WooCommerce.

---

## References

- `docs/specs/product-spec-872-woocommerce-shop-integration.md` — intended WooCommerce role (master shop at PrestaShop parity). Ships with the WooCommerce adapter work (PR #1002 / branch `975`); may not be present on `main` yet.
- [Architecture Overview](../../architecture-overview.md) — capability ports, inventory→offer data flow
- [Getting Started](../../getting-started.md) — broader dev-stack setup
