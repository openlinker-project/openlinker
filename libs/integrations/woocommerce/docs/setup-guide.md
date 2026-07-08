# WooCommerce Integration Setup Guide

Step-by-step: from a fresh WooCommerce store to a working OpenLinker connection
with catalog sync, inventory propagation, order ingest, and offer creation.

## Prerequisites

- WooCommerce 8.x or later
- **HPOS enabled** — WooCommerce → Settings → Advanced → Features → Order Storage: "High-Performance Order Storage"
- WooCommerce REST API v3 accessible over **HTTPS**, terminated by a genuine TLS endpoint the
  Connection's `siteUrl` actually resolves to (see "The `is_ssl()` gotcha" below — this is
  stricter than it looks)
- Consumer key + secret with **read_write** scope (see Step 1)
- OpenLinker API server running

## The `is_ssl()` gotcha (read this before choosing a `siteUrl`)

WooCommerce's REST API (`WC_REST_Authentication::authenticate()`) only accepts Basic-Auth or
query-string `consumer_key`/`consumer_secret` credentials when PHP's `is_ssl()` returns `true`.
Over plain HTTP it demands OAuth 1.0a request signing instead — which OpenLinker's WooCommerce
adapter does not implement (#1416). Practically, this means:

- **A `siteUrl` that is plain HTTP always fails.** OpenLinker's own connection-config validator
  already rejects `http://` outright (`@IsUrl({ protocols: ['https'] })` on
  `WooCommerceConnectionConfigDto.siteUrl`) — you'll get a clear validation error at save-time,
  not a mysterious `401`.
- **A `siteUrl` that is HTTPS at the edge but plain HTTP behind a reverse proxy still fails**,
  unless the proxy's `X-Forwarded-Proto: https` header is explicitly trusted by WordPress. This
  is the scenario that bites the internal Docker addresses below (`http://woocommerce:8080`,
  `http://localhost:8082`) — they have no TLS anywhere in the path, so there's no fixing them;
  you need a `siteUrl` that terminates real (or locally-trusted) TLS. See the three options below.

Do **not** work around this by forcing WordPress to always believe `is_ssl()` is true
(e.g. an mu-plugin unconditionally setting `$_SERVER['HTTPS'] = 'on'`) — that makes WordPress
trust the header from *any* request, including ones that never touched TLS, which defeats the
whole point of the HTTPS gate (Basic Auth credentials would then happily travel over the
unencrypted hop). The only safe pattern is trusting `X-Forwarded-Proto` when it is set by a
proxy you actually control and that genuinely terminates TLS in front of WordPress — see Option 3.

### Option 1 — tunnel (fastest, any local dev)

Point a tunnel at whichever WooCommerce port you're running (`8082` for the dev stack, or the
demo's WooCommerce container's published port), then use the tunnel's `https://` URL as `siteUrl`:

```bash
cloudflared tunnel --url http://localhost:8082
# → prints something like https://random-words-1234.trycloudflare.com
```

No account needed for `cloudflared`'s quick tunnels; the URL rotates on every run, so re-run
`Test Connection` after restarting the tunnel.

### Option 2 — public-domain deployment via the proxy overlay (Docker demo)

If you're running the [Docker demo](../../../../docs/one-command-demo-setup-guide.md) on a real
server, the [public-domain deployment guide](../../../../docs/public-domain-demo-deployment-guide.md)'s
reverse-proxy/TLS overlay (`docker-compose.proxy.yml`) routes `WOOCOMMERCE_DOMAIN` to the
`woocommerce` service and includes a scoped `WORDPRESS_EXTRA_WP_CONFIG_CONTENT` override that
makes WordPress trust `X-Forwarded-Proto` **from Caddy specifically** (Caddy is the only thing
that can reach `woocommerce:8080` and set that header while also being the one place TLS is
genuinely terminated). This override only exists when `docker-compose.proxy.yml` is included —
a plain `pnpm demo:up` never enables it. Use `siteUrl: https://<WOOCOMMERCE_DOMAIN>`.

### Option 3 — self-signed cert on your own reverse proxy (advanced, no public domain)

If you're not using the demo's Caddy overlay but do have your own TLS-terminating reverse proxy
in front of WooCommerce (nginx, Caddy standalone, Traefik, …), apply the same
`X-Forwarded-Proto` trust pattern via `wp-config.php`:

```php
if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
```

Only add this if you control the network path such that nothing but your own proxy can reach
WordPress directly — otherwise a client could set the header itself and spoof `is_ssl()`.

## 1. Generate WC REST API credentials

1. Log in to WP Admin → WooCommerce → Settings → Advanced → REST API
2. Click **Add Key**
3. Description: `OpenLinker`
4. User: select your admin user
5. Permissions: **Read/Write**
6. Click **Generate API Key**
7. Copy the **Consumer Key** (`ck_...`) and **Consumer Secret** (`cs_...`) — shown only once

> **HTTPS required.** OpenLinker enforces HTTPS to protect Basic Auth credentials in transit.
> Pick one of the three options above for local/demo development.

## 2. Create a WooCommerce connection in OpenLinker

1. Open OL Admin → Integrations → Connections → **New Connection**
2. Platform: **WooCommerce**
3. Site URL: `https://your-shop.com` — **HTTPS is required** (the config validator rejects
   `http://` outright, even for local dev — see "The `is_ssl()` gotcha" above for a working
   `siteUrl` in local/demo contexts)
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

> **`http://localhost:8082` cannot be used as the Connection's `siteUrl` directly** — it's plain
> HTTP, and the config validator rejects it. The dev stack itself is unaffected (the seed script
> uses `wp eval` to call WC's PHP API directly, bypassing HTTP auth entirely — see
> `docker/woocommerce/01-seed-wc-data.sh`), but a real OpenLinker↔WooCommerce Connection needs
> Option 1 above: `cloudflared tunnel --url http://localhost:8082`, then use the printed
> `https://…trycloudflare.com` URL as `siteUrl` with the credentials from
> `pnpm dev:stack:wc-credentials`.

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
| Connection test fails with "HTTPS required" | HTTP URL provided | Change site URL to `https://` — see "The `is_ssl()` gotcha" above for a working option |
| `401 woocommerce_rest_cannot_view` even with valid consumer key/secret | `siteUrl` is HTTPS at the edge but the request reaches WordPress over plain HTTP behind a reverse proxy that isn't trusted (`is_ssl()` still false) | Use the proxy overlay's `WOOCOMMERCE_DOMAIN` (Option 2) which already wires the `X-Forwarded-Proto` trust, or apply the `wp-config.php` snippet from Option 3 for a custom proxy |
| Orders not appearing in OL | `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED=false` | Set to `true` in worker env and restart |
| Stock not propagating to Allegro | `InventoryMaster` capability not enabled on the connection | Enable in OL Admin → connection settings |
| WC product sync returns empty | HPOS not enabled | Enable HPOS in WooCommerce → Settings → Advanced → Features |
| `401 Unauthorized` on REST API call | Consumer key has wrong permissions | Regenerate with **Read/Write** scope |
