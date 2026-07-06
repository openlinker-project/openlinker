# WooCommerce Integration Setup Guide

Step-by-step: from a fresh WooCommerce store to a working OpenLinker connection
with catalog sync, inventory propagation, order ingest, and offer creation.

## Prerequisites

- WooCommerce 8.x or later
- **HPOS enabled** — WooCommerce → Settings → Advanced → Features → Order Storage: "High-Performance Order Storage"
- WooCommerce REST API v3 accessible over **HTTPS** (HTTP is blocked — Basic Auth credentials must not travel in cleartext)
- Consumer key + secret with **read_write** scope (see Step 1)
- OpenLinker API server running

## 1. Generate WC REST API credentials

1. Log in to WP Admin → WooCommerce → Settings → Advanced → REST API
2. Click **Add Key**
3. Description: `OpenLinker`
4. User: select your admin user
5. Permissions: **Read/Write**
6. Click **Generate API Key**
7. Copy the **Consumer Key** (`ck_...`) and **Consumer Secret** (`cs_...`) — shown only once

> **HTTPS required.** OpenLinker enforces HTTPS to protect Basic Auth credentials in transit.
> For local development you can use a self-signed certificate or the local dev stack (see below).

## 2. Create a WooCommerce connection in OpenLinker

1. Open OL Admin → Integrations → Connections → **New Connection**
2. Platform: **WooCommerce**
3. Site URL: `https://your-shop.com` — **HTTPS is required** (the config validator rejects `http://`, even for local dev; use a self-signed cert on your local dev stack, e.g. `https://localhost:8443`)
4. Consumer Key / Consumer Secret: paste from Step 1
5. Click **Test Connection** — expects `{ success: true, latencyMs: ... }`
6. Click **Save**

## 3. Enable capabilities

After the connection is saved, enable the capabilities you need:

| Capability | What it does |
|---|---|
| `ProductMaster` | Reads WC catalog into OL (products, variants, categories) |
| `InventoryMaster` | Syncs WC stock → Allegro offer quantities |
| `OrderSource` | Ingests WC orders into OL (watermark polling, `*/5 * * * *`) |
| `OrderProcessorManager` | Creates WC orders from Allegro order events |

## 4. Environment variables

| Variable | Default | Description |
|---|---|---|
| `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED` | `false` | Enable the `woocommerce-orders-poll` cron task in the worker. Set to `true` when using the `OrderSource` capability. |

Add to your worker `.env`:

```env
OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED=true
```

## 5. Local development

The dev stack includes a pre-configured WooCommerce instance at **http://localhost:8082**
(note: PrestaShop uses 8080; WooCommerce uses 8082 to avoid collision):

```bash
# Start the full dev stack (includes WC)
pnpm dev:stack:up

# Print the auto-generated WC consumer key + secret
pnpm dev:stack:wc-credentials

# Re-seed products if needed (idempotent — safe to run multiple times)
pnpm dev:stack:seed-woocommerce
```

**Dev stack WC credentials:**

| Field | Value |
|---|---|
| URL | http://localhost:8082 |
| Admin panel | http://localhost:8082/wp-admin (admin / admin123) |
| WC REST API | http://localhost:8082/wp-json/wc/v3/ |
| Consumer key | generated — run `pnpm dev:stack:wc-credentials` |

**Seed data** (available after `pnpm dev:stack:up`):

| SKU | Type | Stock |
|---|---|---|
| `WC-SHIRT-001` | Simple product | 50 |
| `WC-JEANS-S` | Variation (Size: S) | 30 |
| `WC-JEANS-M` | Variation (Size: M) | 20 |

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connection test fails with "SSRF blocked" | Site URL resolves to RFC-1918 address (10.x, 192.168.x, 172.16.x) | Use a publicly routable URL or loopback (127.0.0.1) for local dev |
| Connection test fails with "HTTPS required" | HTTP URL provided | Change site URL to `https://` |
| Orders not appearing in OL | `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED=false` | Set to `true` in worker env and restart |
| Stock not propagating to Allegro | `InventoryMaster` capability not enabled on the connection | Enable in OL Admin → connection settings |
| WC product sync returns empty | HPOS not enabled | Enable HPOS in WooCommerce → Settings → Advanced → Features |
| `401 Unauthorized` on REST API call | Consumer key has wrong permissions | Regenerate with **Read/Write** scope |
