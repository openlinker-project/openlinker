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
- **Keep Delivered Events (days)**: retention horizon for delivered rows (default: 7, range 1-365). See Outbox Retention below.

## Event Deduplication

PrestaShop's hooks (especially `actionProductSave`) can fire **multiple times** during a single operation (e.g., 6 times when saving a product). This is expected PrestaShop behavior.

The module implements **automatic deduplication**, keyed on queue state rather than on a clock:
- Every outbox row carries a `dedup_key` derived from connection + event type + object type + object ID. No timestamp goes into it.
- A unique index on `dedup_key` makes `INSERT IGNORE` drop a repeat fire while the first row is still waiting to be sent.
- The key is set to `NULL` the moment the row leaves the queue - when the cron claims it for delivery, when it is delivered, and when it fails for good. A `NULL` never collides in MySQL.
- The key covers the event's subject, not its payload. Two `order.status_changed` fires while a row is queued deliver only the first `newStatusId`. That is correct: the webhook is a trigger and the sync job re-reads current shop state.

**Result**: only 1 event is created per product save, even if the hook fires 6+ times - and a *later* change to the same product always gets its own row, whatever the cron cadence. There is no deduplication-window setting to tune; the earlier one could silently drop real changes when the cron ran faster than the window (#2603).

## Cron Setup

Nothing is delivered to OpenLinker until something triggers a delivery pass on a
schedule. The module ships a file that does the whole job with no arguments and
no token: `cron/openlinker-cron.php`.

```bash
# Every 2 minutes, on a host that lets you write a cron command
*/2 * * * * /usr/bin/php /path/to/shop/modules/openlinker/cron/openlinker-cron.php > /dev/null 2>&1
```

On a host where the schedule is the file's name and no arguments can be passed
(home.pl, AZ.pl), copy that file into the host's cron directory and rename it to
whatever name means the interval you want, for example `cron-5min.php`. Set
`OPENLINKER_PS_ROOT` if the copy lives outside the shop's directory tree.

Where a PHP file cannot be scheduled, POST to the endpoint instead and send the
token in a header. The token is never read from the address, because an address
ends up in server logs and browser history:

```bash
*/2 * * * * curl -s -X POST -H "X-OpenLinker-Cron-Token: YOUR_CRON_TOKEN" \
  "https://your-shop.com/index.php?fc=module&module=openlinker&controller=cron" > /dev/null 2>&1
```

**Recommended frequency**: every 1-5 minutes. Once an hour is the least some
hosting tiers allow; it works, but stock and price changes then take up to an
hour to reach a marketplace, and every retry waits a full hour too.

**Do not use `cron.prestashop.com`.** The service was switched off in December
2025 and now answers with a success code while doing nothing, so a shop relying
on it looks healthy and delivers nothing.

The config page's **Delivery Last Ran** row is how you check any of this is
actually happening.

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

### `product.deleted`
Triggered when a product is deleted. Shares the product-events toggle with
`product.saved`. OpenLinker treats it as a trigger to re-read the product: the
shop answering "no such product" is what pauses the listings, so a rolled-back
delete costs one redundant re-sync and nothing more.

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

This is normal PrestaShop behavior. The module coalesces repeat fires while the event is still queued. If you see duplicates:
- Verify the `dedup_key` column exists and has a unique index
- Check whether the rows describe genuinely different changes - once an event has been delivered, the next change is a new event and a new row (this is correct behavior)

## Architecture

### Outbox Pattern

The module uses an **outbox pattern** to ensure reliable webhook delivery:

1. **Hooks** capture PrestaShop events and enqueue to outbox table (fast, non-blocking)
2. **Cron** periodically claims batches from outbox and delivers via HTTP
3. **Retry logic** handles failures with exponential backoff
4. **Stale row recovery** prevents stuck events if cron crashes
5. **Retention** deletes finished rows so the table cannot grow without bound

This ensures:
- Hooks never block (checkout/admin operations remain fast)
- Events survive OpenLinker downtime (retry later)
- No duplicate deliveries (atomic claiming by runId)
- No lost events (durable outbox table)
- No unbounded table (retention prunes finished rows)

### Outbox Retention

Only **finished** rows are ever deleted:

| Status | Meaning | Deleted? |
|---|---|---|
| `pending` | queued, or waiting on a retry backoff | never |
| `processing` | leased by a cron run in flight | never |
| `delivered` | OpenLinker has the event | after the configured horizon (default 7 days) |
| `failed` | gave up after the maximum attempts | after 30 days, so the evidence outlives the success history |

A pass runs from the cron controller, at most once an hour, after delivery so
it can never delay an event. It deletes in batches of 1000 and stops after
10000 rows; whatever is left is picked up by the next pass, so an outbox that is
already enormous drains gradually instead of locking the table in one statement.
"Run delivery now" in the module configuration forces a pass immediately.

There is also a hard cap of 100000 rows. Over the cap, the oldest delivered and
failed rows are deleted even if they are inside their horizon. **The cap never
deletes queued or in-flight rows and never refuses a new event** - dropping a
hook fire would be silent data loss. So if the table is still over the cap once
every finished row is gone, the excess is genuinely undelivered work: the
statistics panel says so, the cron logs an error, and webhook delivery needs
fixing.

### State Machine

Events flow through these states:
- `pending` → `processing` → `delivered` (success)
- `pending` → `processing` → `pending` (retry with backoff)
- `pending` → `processing` → `failed` (max attempts reached)

`delivered` and `failed` are terminal. Retention deletes them once they are past
their horizon; nothing else in the table is ever deleted.

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

## Running PHP Unit Tests

Pure-function classes (`HmacRequestVerifier`, `EventIdGenerator`) have PHPUnit tests that run without a live PrestaShop instance.

```bash
# From repo root — installs Composer deps then runs PHPUnit
pnpm test:php

# Or directly inside the module directory
cd apps/prestashop-module/openlinker
composer install
vendor/bin/phpunit
```

### PHP version

Classes are found through a Composer classmap that is generated on install, not
committed. If the suite reports `Class ... not found`, the classmap predates the
classes: run `composer dump-autoload` and run it again. The module runtime does
not use Composer at all - it loads its classes with explicit `require_once`
calls - so this only ever affects the test run.

The module **runtime** targets PHP `>=7.4` (PrestaShop 1.7 baseline). The **dev/test** toolchain (PHPUnit 10) requires PHP `>=8.1`. CI uses 8.1 to run tests; production deploys are unaffected. Contributors on PHP 7.4 can edit module classes but cannot run `composer install` for the dev dependencies — install PHP 8.1+ locally to run the unit suite.

### Scope and non-goals

The PHPUnit harness covers **pure-function classes only** — those with no PrestaShop globals (`Db::`, `Configuration::`, `Cart`, etc.):

| Class | Tests |
|---|---|
| `HmacRequestVerifier` | Happy path + all documented failure modes (missing headers, bad format, replay, tampered body/timestamp) |
| `EventIdGenerator` | Per-call event-id uniqueness, dedup-key determinism per subject, discrimination on connection / object type / event type / external id, UUID-like output format |

**Out of scope (explicit non-goals)**:
- `CartShippingRepository`, `WebhookSender`, install/uninstall hooks, and controllers all depend on PS globals — they are **not** tested here and require a real PrestaShop (see issue #506).
- No PHPStan / Psalm / phpcs — static analysis is a separate concern.

### Optional MySQL suite

`tests/Integration/OutboxDedupSqlTest.php` covers `OutboxRepository`'s coalescing against a real server, because the rule is a unique index over a nullable column and no unit test can reach it. It stubs the small PrestaShop surface the repository calls (`Db`, `pSQL`, `Configuration`, `PrestaShopLogger`) and points it at a throwaway MySQL. It is **not** part of `vendor/bin/phpunit`, so the default run stays dependency-free:

```bash
docker run -d --rm --name ol-outbox-mysql -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=outbox -p 3399:3306 mysql:8.0

OPENLINKER_TEST_MYSQL_DSN='mysql:host=127.0.0.1;port=3399;dbname=outbox' \
OPENLINKER_TEST_MYSQL_USER=root OPENLINKER_TEST_MYSQL_PASSWORD=root \
  vendor/bin/phpunit --testsuite Integration
```

Without the DSN the suite skips. This is not the full real-PrestaShop harness (#506) - it exercises SQL semantics only.

### Adding new pure-function tests

1. Confirm the class has **no calls** to `Db::`, `Configuration::`, `PrestaShopLogger::`, `Cart`, `Carrier`, or `Module`.
2. Create `tests/Unit/{ClassName}Test.php` extending `PHPUnit\Framework\TestCase`.
3. Run `vendor/bin/phpunit` to verify.

If a class does touch PS globals, it belongs in the real-PS integration test suite (#506), not here.

## Related Documentation

- [PrestaShop Webhook Integration](../../../docs/webhooks/prestashop.md) - OpenLinker webhook integration guide
- [PrestaShop Module Testing Guide](../../../docs/prestashop-module-testing-guide.md) - Testing and troubleshooting
- [Architecture Overview](../../../docs/architecture-overview.md) - System architecture
