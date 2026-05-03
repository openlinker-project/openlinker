# OpenLinker PrestaShop Module

Host module for OpenLinker capabilities on PrestaShop. Provides two capabilities side-by-side:

1. **Webhook outbox** — emits secure webhook events to OpenLinker to support event-driven synchronization triggers ("trigger pull").
2. **Dynamic shipping carrier** — registers an OL-owned carrier on install. The OpenLinker backend writes per-cart shipping costs into a sidecar table; PrestaShop calls the carrier module at order-create time and reads the authoritative amount from the sidecar — no post-create reconcile, no `current_state=8`.

## Overview

This module captures PrestaShop events (product/order/stock) via hooks, writes them to a durable outbox table, and delivers them to OpenLinker via HTTP POST with HMAC signature and retry/backoff support. Alongside that, it registers a dynamic-pricing PrestaShop carrier (`is_module=1, shipping_external=1, external_module_name='openlinker'`) that lets the OpenLinker backend supply authoritative per-cart shipping costs.

**Key Features**:
- Non-blocking hook execution (fast writes to outbox)
- Durable outbox with retry/backoff
- HMAC signature compatible with OpenLinker
- Stable event IDs across retries
- Processing lease to prevent stuck rows
- Deterministic claiming to prevent overlap
- **Automatic event deduplication** (prevents duplicate events from multiple hook fires)
- **Custom menu tab** for easy access
- **Dynamic shipping carrier** — OL-supplied amount is authoritative on first POST `/orders`

## Accessing the Module

After installation, the OpenLinker module is accessible in two ways:

1. **Main Menu** (Recommended): 
   - Navigate to **Improve** → **OpenLinker** in the left sidebar menu
   - This provides quick access to the module configuration

2. **Module Manager**:
   - Navigate to **Modules** → **Module Manager**
   - Search for "OpenLinker"
   - Click **Configure**

## Installation

### Development (Bind-Mount)

1. **Add to docker-compose.yml**:
   ```yaml
   services:
     prestashop:
       volumes:
         - ./apps/prestashop-module/openlinker:/var/www/html/modules/openlinker
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```

2. **Start PrestaShop**: `docker compose up -d prestashop`

3. **Install module**: PrestaShop Backoffice → Modules → Module Manager → Install "OpenLinker"

4. **Edit code locally**: Changes apply instantly (no ZIP upload needed)

### Production (ZIP Upload)

1. **Create ZIP**: `cd apps/prestashop-module && zip -r openlinker.zip openlinker/`

2. **Upload**: PrestaShop Backoffice → Modules → Module Manager → Upload a module

3. **Install**: Click "Install" on the uploaded module

## Configuration

### Required Settings

- **Base URL**: OpenLinker API base URL
  - Dev: `http://host.docker.internal:3000`
  - Production: `https://your-openlinker-instance.com`
- **Connection ID**: UUID from OpenLinker connection
- **Webhook Secret**: Shared secret (must match OpenLinker env var)
- **Cron Token**: Random token for securing cron endpoint

### Event Type Toggles

- **Enable Product Events**: Capture product save/update events
- **Enable Stock Events**: Capture stock quantity changes
- **Enable Order Events**: Capture order creation and status changes

### Advanced Settings

- **Batch Size**: Number of events to process per cron run (default: 50)
- **Max Retry Attempts**: Maximum delivery attempts before marking as failed (default: 25)
- **Retry Backoff Multiplier**: Exponential backoff multiplier (default: 2.0)

## Event Deduplication

PrestaShop's hooks (especially `actionProductSave`) can fire **multiple times** during a single operation (e.g., 6 times when saving a product). This is expected PrestaShop behavior.

The module implements **automatic deduplication**:
- Event IDs are generated deterministically based on product ID + event type + time window (1 minute)
- Database unique constraint on `event_id` prevents duplicates
- `INSERT IGNORE` handles duplicate attempts gracefully

**Result**: Only 1 event is created per product save, even if the hook fires 6+ times.

## Cron Setup

Set up a system cron to trigger webhook delivery:

```bash
# Every 2 minutes
*/2 * * * * curl -s "https://your-shop.com/index.php?fc=module&module=openlinker&controller=cron&token=YOUR_CRON_TOKEN" > /dev/null 2>&1
```

**Recommended frequency**: Every 1-5 minutes

## Webhook Endpoint

The module sends webhooks to:
```
{OPENLINKER_BASE_URL}/webhooks/prestashop/{OPENLINKER_CONNECTION_ID}
```

With headers:
- `Content-Type: application/json`
- `X-OpenLinker-Timestamp: {unix_milliseconds}`
- `X-OpenLinker-Signature: sha256={hmac_signature}`

## Event Types

### `product.saved`
Triggered when a product is created or updated.

### `order.created`
Triggered when a new order is validated/created.

### `order.status_changed`
Triggered when order status changes.

### `stock.changed`
Triggered when product stock quantity changes.

## Troubleshooting

### Module Not Appearing in Module Manager

- Clear PrestaShop cache: **Advanced Parameters → Performance → Clear cache**
- Check module files exist in `/modules/openlinker/`
- Verify `config.xml` is present and valid

### Events Not Being Created

- Check event type toggles are enabled in configuration
- Verify connection ID is configured
- Check PrestaShop logs: **Advanced Parameters → Logs**

### Events Stuck in Pending

- Check `next_attempt_at` - events scheduled for future won't be processed until due
- Use "Run Delivery Now" button to force immediate delivery
- Check OpenLinker API is accessible from PrestaShop

### Multiple Events for Single Action

This is normal PrestaShop behavior. The module automatically deduplicates events within the same time window (1 minute). If you see duplicates:
- Verify `event_id` column has unique constraint
- Check events are created in different time windows (this is correct behavior)

## Architecture

### Outbox Pattern

The module uses an **outbox pattern** to ensure reliable webhook delivery:

1. **Hooks** capture PrestaShop events and enqueue to outbox table (fast, non-blocking)
2. **Cron** periodically claims batches from outbox and delivers via HTTP
3. **Retry logic** handles failures with exponential backoff
4. **Stale row recovery** prevents stuck events if cron crashes

This ensures:
- Hooks never block (checkout/admin operations remain fast)
- Events survive OpenLinker downtime (retry later)
- No duplicate deliveries (atomic claiming by runId)
- No lost events (durable outbox table)

### State Machine

Events flow through these states:
- `pending` → `processing` → `delivered` (success)
- `pending` → `processing` → `pending` (retry with backoff)
- `pending` → `processing` → `failed` (max attempts reached)

### Concurrency Safety

- **Deterministic claiming**: Each cron run uses unique `runId` to claim events
- **Processing lease**: `processing_owner` and `processing_started_at` prevent overlap
- **Stale recovery**: Rows stuck in `processing` for >15 minutes are automatically requeued

## Dynamic Shipping Carrier

PrestaShop's `POST /orders` ignores `total_shipping` and recomputes shipping from the carrier's price-range tables. This module's second capability sidesteps that: it registers an OL-owned carrier with `is_module=1` + `shipping_external=1` + `external_module_name='openlinker'` so PS routes shipping cost queries through `getOrderShippingCostExternal($cart)`. The OpenLinker backend writes per-cart costs into a sidecar table (`{prefix}openlinker_cart_shipping`); the module reads from it. Result: OL's value is authoritative on first POST `/orders` — no reconcile, no `current_state=8`.

### Install effects

- Creates table `{prefix}openlinker_cart_shipping` (`id_cart` PK, `amount_tax_excl`, `amount_tax_incl`, `source`, timestamps).
- Registers one carrier row: `name='OpenLinker Dynamic'`, `is_module=1`, `shipping_external=1`, `external_module_name='openlinker'`, `need_range=0`, `id_tax_rules_group=0`, `active=1`, `deleted=0`, all currently-active zones assigned via `addZone()`.
- Copies `carrier.jpg` (shipped with the module) to `_PS_SHIP_IMG_DIR_/{id}.jpg`. Install **fails fast** if the copy fails — production PS-carrier-module convention (matches LP Express).
- Persists the live `id_carrier` in `Configuration::OPENLINKER_DYNAMIC_CARRIER_ID`.
- Registers `actionCarrierUpdate` hook — see "Editing the carrier in PS admin" below.

**Tax handling:** the carrier ships with `id_tax_rules_group=0` so PrestaShop does **not** apply tax on top of the OL-supplied amount. The OpenLinker backend's contract is therefore "`amount_tax_incl` is final on the wire". Without this guard PS would multiply our tax-incl value by the shop's tax rate → double tax on every order.

### Uninstall effects

- Soft-deletes the OL Dynamic carrier (`deleted=1`) — preserves order history per the canonical PS pattern.
- If the OL Dynamic carrier was set as `PS_CARRIER_DEFAULT`, reassigns to the next active non-OL carrier **before** soft-deleting (otherwise checkout would point at a `deleted=1` carrier and break).
- Removes `OPENLINKER_DYNAMIC_CARRIER_ID` from `Configuration`.
- Sidecar table is **preserved** by default (mirrors the outbox-table opt-in pattern). To drop it on uninstall, uncomment the `dropCartShippingTable()` call in `openlinker.php::uninstall()`.

### Editing the carrier in PS admin

PrestaShop **duplicates a carrier row and assigns a new `id_carrier`** when an operator clicks "Save" on the carrier-edit page in the BO. The module registers `actionCarrierUpdate` to refresh `OPENLINKER_DYNAMIC_CARRIER_ID` automatically — operators don't need to do anything special after editing.

If you ever bypass the hook (e.g. by editing the row directly via SQL), refresh the config key manually:

```sql
UPDATE ps_configuration SET value = <new_id> WHERE name = 'OPENLINKER_DYNAMIC_CARRIER_ID';
```

### Cart-shipping endpoint (for the OpenLinker backend)

The OpenLinker backend writes per-cart shipping costs to this endpoint **before** the cart is converted to an order:

- **URL**: `{shop}/index.php?fc=module&module=openlinker&controller=cartshipping`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `X-OpenLinker-Timestamp: <unix ms>`
  - `X-OpenLinker-Signature: sha256=<64-char hex>` (HMAC-SHA256 of `timestamp + "." + rawBody` with the configured `OPENLINKER_WEBHOOK_SECRET`)
- **Body**: `{ "id_cart": <int>, "amount_tax_excl": <number>, "amount_tax_incl": <number>, "source": "<optional string>" }`
- **Auth**: HMAC, ±5 min skew window, constant-time comparison via `hash_equals` — same contract as the outbound webhook signer.

**Responses**:

| Status | Body                                                                                          | When |
|--------|-----------------------------------------------------------------------------------------------|------|
| `200`  | `{"ok": true, "id_cart": <int>}`                                                              | Sidecar row upserted. |
| `400`  | `{"ok": false, "error": "invalid-body"}` or `{"ok": false, "error": "invalid-fields"}`        | JSON malformed or required fields missing/non-numeric. |
| `401`  | `{"ok": false, "error": "missing-headers"\|"bad-signature-format"\|"timestamp-out-of-window"\|"invalid-signature"\|"misconfigured"}` | HMAC verification failed. |
| `405`  | `{"ok": false, "error": "method-not-allowed"}`                                                | Anything other than POST. |
| `500`  | `{"ok": false, "error": "persist-failed"}`                                                    | DB write failed (check PS log). |

**Idempotency**: re-posting the same `id_cart` rewrites the same row (only `updated_at` changes).

**Example signed-request curl** (replace `${SECRET}`, `${BASE_URL}`, and the body):

```bash
TS=$(date +%s%3N)
BODY='{"id_cart":42,"amount_tax_excl":12.20,"amount_tax_incl":15.00,"source":"allegro:order:abc123"}'
SIG="sha256=$(printf '%s' "${TS}.${BODY}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"

curl -sS -X POST "${BASE_URL}/index.php?fc=module&module=openlinker&controller=cartshipping" \
    -H "Content-Type: application/json" \
    -H "X-OpenLinker-Timestamp: ${TS}" \
    -H "X-OpenLinker-Signature: ${SIG}" \
    --data "${BODY}"
# → 200 {"ok":true,"id_cart":42}
```

### Behaviour when no sidecar row exists

If PrestaShop calls `getOrderShippingCostExternal()` for a cart that has no row in the sidecar, the module logs an **error**-level entry (`OpenLinker: no cart-shipping row for id_cart=<n> — refusing to ship via OL Dynamic carrier`) and returns `false`. PS then treats the OL Dynamic carrier as **unavailable for that cart**. This is intentional — silent zero-cost shipping would be worse than a loud refusal. Common causes: the OL backend never wrote the row (check OL-side logs), or the cart was created before OL-side dynamic-carrier resolution was wired up.

### Reinstall caveat

Each install/uninstall cycle leaves a soft-deleted carrier row behind plus stale `ps_carrier_zone` rows pointing at it. Behaviour is harmless to checkout, but operators wanting clean reinstalls can hard-delete soft-deleted OL carriers via SQL after confirming no order history references them:

```sql
SELECT id_carrier FROM ps_carrier
  WHERE external_module_name = 'openlinker' AND deleted = 1;
-- For each id, confirm `SELECT COUNT(*) FROM ps_orders WHERE id_carrier=<id>` is 0,
-- then `DELETE FROM ps_carrier WHERE id_carrier=<id>; DELETE FROM ps_carrier_zone WHERE id_carrier=<id>;`.
```

## Related Documentation

- [PrestaShop Webhook Integration](../../docs/webhooks/prestashop.md) - OpenLinker webhook integration guide
- [PrestaShop Module Testing Guide](../../docs/prestashop-module-testing-guide.md) - Testing and troubleshooting
- [Architecture Overview](../../docs/architecture-overview.md) - System architecture
