# Implementation Plan — #878 WooCommerce E2E + Dockerized Dev Stack

## Goal

1. **Dockerized WC dev stack** — add WooCommerce to `docker-compose.yml` so `pnpm dev:stack:up` gives contributors a local WC store alongside Postgres, Redis, MySQL, PrestaShop.
2. **Integration tests** — three vertical-slice int-specs exercising the full WC pipeline:
   - Stock-change propagation: WC stock change → Allegro offer quantity update
   - Order ingest: Allegro order → WC customer order
   - Bulk-listing wizard smoke: WC products → Allegro offers (fake Allegro adapter for CI)
3. **README update** — document the new dev-stack service.
4. **Environment variable documentation** — all env vars introduced or used.

## Classification

**Dev Infrastructure + Integration tests** — touches `docker-compose.yml`, `apps/api/test/integration/`, `docker/woocommerce/`, `.env.example`, and `README.md`.
No CORE port changes. No DB migrations. No new capability adapters.

## Non-goals

- New wizard FE work — wizard already exists; this validates it against WC
- HPOS-disabled WC stores — HPOS-only at v1 (per spec §6)
- Automated E2E browser tests — int-specs exercise the API layer, not the UI

---

## Environment Variables

### New OL application env var (worker + API)

| Variable | Default | Required | Description |
|---|---|---|---|
| `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED` | `false` | No | Enables the `woocommerce-orders-poll` cron task (`*/5 * * * *`) introduced in #876. Set to `true` only when a WC connection is active in the worker. Integration tests bypass this entirely — they call `OrderIngestionService.syncOrderFromSource()` directly. |

**No global WC credential env vars.** Consumer key + secret are per-connection, stored via `CredentialStorageService` in the encrypted `integration_credentials` table (the `credentialsRef` pattern). There is no `OL_WOOCOMMERCE_CONSUMER_KEY` global variable.

### docker-compose WC services (dev only, never production)

These are embedded in `docker-compose.yml`. Override in a local `.env` file:

| Variable | Service | Default | Description |
|---|---|---|---|
| `WORDPRESS_DATABASE_HOST` | `woocommerce` | `woocommerce-mysql` | MySQL host (Docker internal network alias) |
| `WORDPRESS_DATABASE_PORT_NUMBER` | `woocommerce` | `3306` | MySQL port inside Docker network |
| `WORDPRESS_DATABASE_NAME` | `woocommerce` | `woocommerce` | WordPress DB name |
| `WORDPRESS_DATABASE_USER` | `woocommerce` | `woocommerce` | MySQL app user |
| `WORDPRESS_DATABASE_PASSWORD` | `woocommerce` | `woocommerce` | MySQL app password |
| `WORDPRESS_USERNAME` | `woocommerce` | `admin` | WordPress admin username |
| `WORDPRESS_PASSWORD` | `woocommerce` | `admin123` | WordPress admin password (dev only) |
| `WORDPRESS_EMAIL` | `woocommerce` | `admin@openlinker.local` | WordPress admin email |
| `WORDPRESS_SITE_TITLE` | `woocommerce` | `OpenLinker WC Dev` | WordPress site title |
| `WORDPRESS_PLUGINS` | `woocommerce` | `woocommerce` | Plugins installed via WP-CLI at boot |
| `MYSQL_ROOT_PASSWORD` | `woocommerce-mysql` | `root` | MySQL root password |
| `MYSQL_DATABASE` | `woocommerce-mysql` | `woocommerce` | Database to create at boot |
| `MYSQL_USER` | `woocommerce-mysql` | `woocommerce` | Application DB user |
| `MYSQL_PASSWORD` | `woocommerce-mysql` | `woocommerce` | Application DB password |

### `.env.example` additions

```env
# ── WooCommerce dev stack ──────────────────────────────────────────────────────
# The WC services bind to 127.0.0.1 only. Override ports below if needed.
# WOOCOMMERCE_MYSQL_HOST_PORT=3307    # host port for woocommerce-mysql (default 127.0.0.1:3307)
# WOOCOMMERCE_HOST_PORT=8082          # host port for WordPress/WC     (default 127.0.0.1:8082)

# ── WooCommerce worker scheduler ──────────────────────────────────────────────
# Set to true when running the worker with an active WC connection.
OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED=false
```

---

## Design

### Docker dev stack

WooCommerce requires WordPress + MySQL. A dedicated `woocommerce-mysql` service (MySQL 8.4, port 3307) keeps the two shops isolated from PrestaShop's MySQL (port 3306).

WordPress image: **`bitnami/wordpress:6.7.2-debian-12-r0`** — pinned (not `latest`). WooCommerce pre-bundled. HPOS activated via the seed script.

**Consumer key handling:** bitnami/wordpress does NOT support consumer keys via env vars — they must be created by WP-CLI after WordPress boots. The seed script creates them and writes them to `.dev-secrets/woocommerce-credentials.json` inside the Docker volume.

**Port binding:** Both WC services bind to `127.0.0.1` only — no non-loopback exposure.

**Readiness probe:** The WC service healthcheck polls `/wp-json/wc/v3/` (the WC namespace index endpoint, publicly accessible without auth when WC is active). **Not** `/wp-json/wc/v3/system_status` (requires auth) and **not** `/wp-json/` (WordPress REST, not WC REST). The WC namespace index returns `200` without credentials as soon as WooCommerce has registered its REST routes.

### WC Testcontainer: two-container network

`bitnami/wordpress` requires an external MySQL. The Testcontainers `Network` approach:
1. `Network.newNetwork()` — shared isolated Docker network
2. `MySqlContainer` attached to the network with alias `woocommerce-mysql-tc`
3. `GenericContainer` (bitnami/wordpress) on the same network, pointing at the MySQL alias
4. `Wait.forHttp('/wp-json/wc/v3/', 8080)` — WC namespace index, no auth required

**Consumer key generation after readiness:** WP-CLI `wp eval` with `--no-debug 2>/dev/null` stdout-only. Parse the **last non-empty line** of stdout as JSON to avoid PHP notice contamination. Retry up to 5× with 10s gaps (WC may lag behind WordPress REST init).

**Consumer key return shape** from `new WC_Auth()->create_keys(...)`:
```json
{ "key_id": 1, "user_id": 1, "consumer_key": "ck_...", "consumer_secret": "cs_...", "key_permissions": "read_write" }
```

**OL credential storage (hexagonal boundary):** Every int-spec that creates a WC connection stores credentials via `createTestConnection(harness, { ..., credentials: { consumerKey, consumerSecret } })`. This helper calls `CredentialStorageService` (the same path as production). Direct DB insertion of credentials is an **architecture violation** — it bypasses the credential storage boundary.

### Identifier mapping setup (hexagonal-correct)

All three int-specs need WC product identifier mappings before running their scenarios. These must be created through the application service layer:

```
harness.getApp().get<IMasterProductSyncService>(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
  .syncFromMasterByExternalId(connectionId, externalId)
```

This calls `WooCommerceProductMasterAdapter.getProduct()` → `getProductVariants()` → `IdentifierMappingService.getOrCreateInternalId()` — the same path as production. **Direct DB insertion of identifier_mappings rows is an architecture violation** (bypasses the adapter layer).

The shared `drainProductSyncJobs` helper (Step 4a) wraps this for reuse across all three int-specs.

### Order ingest scheduler bypass

`woocommerce-orders-poll` is gated by `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED`. The int-spec bypasses this by calling `OrderIngestionService.syncOrderFromSource()` directly via `harness.getApp().get(...)` — identical to how `allegro-prestashop-carrier-mapping.int-spec.ts` calls the service directly. No env var or scheduler involved.

### Inventory sync in tests

The inventory propagation int-spec calls `IMasterInventorySyncService.syncFromMasterByExternalId(connectionId, externalProductId)` directly — same `harness.getApp().get(MASTER_INVENTORY_SYNC_SERVICE_TOKEN)` pattern. No queue, no scheduler.

---

## Step-by-step plan

### Step 1 — WooCommerce MySQL service in `docker-compose.yml`

```yaml
woocommerce-mysql:
  image: mysql:8.4.7
  container_name: openlinker-woocommerce-mysql
  environment:
    MYSQL_ROOT_PASSWORD: root
    MYSQL_DATABASE: woocommerce
    MYSQL_USER: woocommerce
    MYSQL_PASSWORD: woocommerce
  ports:
    - '127.0.0.1:3307:3306'
  volumes:
    - woocommerce_mysql_data:/var/lib/mysql
  healthcheck:
    # -proot matches MYSQL_ROOT_PASSWORD: root (no space between -p and password)
    test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-u', 'root', '-proot']
    interval: 10s
    timeout: 5s
    retries: 5
```

Add named volume: `woocommerce_mysql_data:`

---

### Step 2 — WooCommerce WordPress service in `docker-compose.yml`

```yaml
woocommerce:
  image: bitnami/wordpress:6.7.2-debian-12-r0
  platform: linux/amd64
  container_name: openlinker-woocommerce
  depends_on:
    woocommerce-mysql:
      condition: service_healthy
  environment:
    WORDPRESS_DATABASE_HOST: woocommerce-mysql
    WORDPRESS_DATABASE_PORT_NUMBER: 3306
    WORDPRESS_DATABASE_NAME: woocommerce
    WORDPRESS_DATABASE_USER: woocommerce
    WORDPRESS_DATABASE_PASSWORD: woocommerce
    WORDPRESS_USERNAME: admin
    WORDPRESS_PASSWORD: admin123
    WORDPRESS_EMAIL: admin@openlinker.local
    WORDPRESS_SITE_TITLE: OpenLinker WC Dev
    WORDPRESS_PLUGINS: woocommerce
  ports:
    - '127.0.0.1:8082:8080'
  volumes:
    - woocommerce_data:/bitnami/wordpress
    - ./docker/woocommerce:/docker-entrypoint-initdb.d:ro
  healthcheck:
    # /wp-json/wc/v3/ = WC namespace index, returns 200 without auth once WC is active.
    # Do NOT use /wp-json/wc/v3/system_status (requires consumer key auth — chicken-and-egg
    # at startup before the seed script has created credentials).
    test: ['CMD', 'curl', '-sf', 'http://localhost:8082/wp-json/wc/v3/']
    interval: 30s
    timeout: 10s
    retries: 10
    start_period: 120s
```

Add named volume: `woocommerce_data:`

**Acceptance:** `pnpm dev:stack:up` brings up WC; `curl -s http://localhost:8082/wp-json/wc/v3/ | jq .namespace` returns `"wc/v3"`.

---

### Step 3 — Seed script

**File:** `docker/woocommerce/01-seed-wc-data.sh`

```bash
#!/bin/bash
set -e

log() { echo "[WC seed] $*"; }

log "Waiting for WordPress core install..."
until wp core is-installed --allow-root --no-debug 2>/dev/null; do sleep 5; done

log "Waiting for WooCommerce class availability..."
until wp eval 'echo class_exists("WC_Auth") ? "ok" : "no";' \
    --allow-root --no-debug 2>/dev/null | grep -q "^ok$"; do sleep 5; done

# Activate HPOS (High-Performance Order Storage — v1 requirement per spec §6)
wp option update woocommerce_feature_hpos_enabled yes --allow-root --no-debug
log "HPOS activated."

# Generate WC REST API key — parse last line as JSON, stdout only (--no-debug 2>/dev/null)
# Shape: { key_id, user_id, consumer_key (ck_...), consumer_secret (cs_...), key_permissions }
wp eval \
  'echo json_encode((new WC_Auth)->create_keys("OL Dev Key", 1, "read_write"));' \
  --allow-root --no-debug 2>/dev/null \
  | tail -1 > /tmp/wc-creds.json

# Persist for host access via: docker exec openlinker-woocommerce cat /bitnami/wordpress/.dev-secrets/woocommerce-credentials.json
mkdir -p /bitnami/wordpress/.dev-secrets
cp /tmp/wc-creds.json /bitnami/wordpress/.dev-secrets/woocommerce-credentials.json
log "Consumer key written to .dev-secrets/woocommerce-credentials.json"

# Read credentials via jq — bitnami/wordpress includes jq; python3 is not guaranteed
CONSUMER_KEY=$(jq -r '.consumer_key' /tmp/wc-creds.json)
CONSUMER_SECRET=$(jq -r '.consumer_secret' /tmp/wc-creds.json)

BASE_URL="http://localhost:8080"
AUTH="$CONSUMER_KEY:$CONSUMER_SECRET"

wc_post() {
  # Usage: wc_post <path> <json-body>
  # Returns the parsed response body. Exits non-zero on HTTP error (curl -sf + set -e).
  curl -sf -u "$AUTH" -X POST "$BASE_URL/wp-json/wc/v3$1" \
    -H "Content-Type: application/json" \
    -d "$2"
}

# Idempotency guard — if WC-SHIRT-001 already exists the data is seeded; exit cleanly.
# This makes `pnpm dev:stack:seed-woocommerce` safe to run multiple times.
EXISTING_SHIRT=$(curl -sf -u "$AUTH" "$BASE_URL/wp-json/wc/v3/products?sku=WC-SHIRT-001" \
  | jq -r '.[0].id // empty')
if [ -n "$EXISTING_SHIRT" ]; then
  log "Seed data already present (WC-SHIRT-001 id=$EXISTING_SHIRT). Skipping."
  exit 0
fi

# Create Clothing category — parse id with jq (bitnami/wordpress includes jq; no python3)
CATEGORY_ID=$(wc_post '/products/categories' '{"name":"Clothing"}' | jq -r '.id')
log "Category 'Clothing' id=$CATEGORY_ID"

# Simple product
wc_post '/products' \
  "{\"name\":\"OL Test Shirt\",\"sku\":\"WC-SHIRT-001\",\"type\":\"simple\",\"regular_price\":\"49.99\",\"manage_stock\":true,\"stock_quantity\":50,\"categories\":[{\"id\":$CATEGORY_ID}]}" \
  > /dev/null
log "Simple product WC-SHIRT-001 created."

# Variable product
JEANS_ID=$(wc_post '/products' \
  "{\"name\":\"OL Test Jeans\",\"sku\":\"WC-JEANS\",\"type\":\"variable\",\"categories\":[{\"id\":$CATEGORY_ID}],\"attributes\":[{\"name\":\"Size\",\"options\":[\"S\",\"M\"],\"variation\":true,\"visible\":true}]}" \
  | jq -r '.id')

# Variations — use wc_post for consistency (DRY: same auth, base URL, content-type)
wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-S","regular_price":"79.99","manage_stock":true,"stock_quantity":30,"attributes":[{"name":"Size","option":"S"}]}' \
  > /dev/null

wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-M","regular_price":"79.99","manage_stock":true,"stock_quantity":20,"attributes":[{"name":"Size","option":"M"}]}' \
  > /dev/null

log "Variable product WC-JEANS (S/M) created. Seed complete."
```

**Acceptance:** After `pnpm dev:stack:up`, `curl -u $(docker exec openlinker-woocommerce cat /bitnami/wordpress/.dev-secrets/woocommerce-credentials.json | jq -r '.consumer_key+":"+.consumer_secret') http://localhost:8082/wp-json/wc/v3/products` returns 2 products.

---

### Step 4 — WC Testcontainer helper

**File:** `apps/api/test/integration/helpers/woocommerce-container.helper.ts`

```ts
/**
 * WooCommerce Testcontainer Helper (#878)
 *
 * Boots a real WordPress + WooCommerce instance (bitnami/wordpress + MySQL 8.4)
 * on a shared Testcontainers Network, generates consumer keys via WP-CLI,
 * activates HPOS, and seeds sample products via WC REST API.
 *
 * Suite-scoped — call from beforeAll, NOT from the global Postgres+Redis harness.
 * Follows the prestashop-container.helper.ts two-container pattern.
 *
 * Readiness probe: /wp-json/wc/v3/ (WC namespace index, public endpoint).
 * NOT /wp-json/wc/v3/system_status (requires auth — chicken-and-egg before
 * consumer keys exist) and NOT /wp-json/ (WordPress only, not WC).
 *
 * Boot-time budget:
 *   Warm Docker image cache (dev laptop, CI re-runs): ~90-120 s
 *   Cold cache (CI first run, image pull + WP install): ~5 min
 *   Deadline: 10 * 60 * 1000 ms (matches prestashop-container.helper.ts pattern)
 *
 * Consumer key shape from WC_Auth::create_keys():
 *   { key_id, user_id, consumer_key: "ck_...", consumer_secret: "cs_...", key_permissions }
 *
 * @module apps/api/test/integration/helpers
 */
// MySqlContainer is in @testcontainers/mysql (already in apps/api/package.json@10.28.0)
// matching the import pattern in prestashop-container.helper.ts
import { GenericContainer, Network, StartedNetwork, StartedTestContainer, Wait } from 'testcontainers';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';

export interface WooCommerceTestContainer {
  /** http://localhost:{random-port} */
  baseUrl: string;
  /** WC REST API consumer_key (ck_ prefix) */
  consumerKey: string;
  /** WC REST API consumer_secret (cs_ prefix) */
  consumerSecret: string;
  /** WC integer id of the simple shirt product (WC-SHIRT-001), as string */
  simpleProductExternalId: string;
  /** WC integer id of the variable jeans product (WC-JEANS), as string */
  variableProductExternalId: string;
  /** WC integer ids of the S and M variations, as strings */
  variationIds: [string, string];
  /** Stop and remove both containers and the shared network. */
  cleanup(): Promise<void>;
}

export async function startWooCommerceContainer(): Promise<WooCommerceTestContainer> {
  // Typed as undefined initially so cleanup() is safe even if startup throws mid-way
  let network: StartedNetwork | undefined;
  let mysql: StartedMySqlContainer | undefined;
  let wordpress: StartedTestContainer | undefined;

  try {
  // Progress logs give developers visibility during the 5-min cold boot.
  // Without these, a hanging test is indistinguishable from slow startup.
  console.log('[WC] Starting MySQL companion...');

  // 1. Shared network — WordPress must reach MySQL by hostname
  network = await Network.newNetwork();

  // 2. MySQL companion on the shared network
  mysql = await new MySqlContainer('mysql:8.4.7')
    .withNetwork(network)
    .withNetworkAliases('woocommerce-mysql-tc')
    .withDatabase('woocommerce')
    .withUsername('woocommerce')
    .withPassword('woocommerce')
    .start();

  console.log('[WC] MySQL ready. Starting WordPress+WooCommerce (warm: ~2min, cold: ~5min)...');

  // 3. WordPress+WooCommerce — wait for WC namespace index (public, no auth)
  //    /wp-json/wc/v3/ returns 200 once WC has registered its REST routes.
  //    /wp-json/wc/v3/system_status CANNOT be used here (requires consumer key auth
  //    that doesn't exist yet — chicken-and-egg deadlock).
  //    withStartupTimeout takes milliseconds — no Duration class needed (matches
  //    the prestashop-container.helper.ts pattern: .withStartupTimeout(240_000))
  wordpress = await new GenericContainer('bitnami/wordpress:6.7.2-debian-12-r0')
    .withNetwork(network)
    .withEnvironment({
      WORDPRESS_DATABASE_HOST: 'woocommerce-mysql-tc',
      WORDPRESS_DATABASE_PORT_NUMBER: '3306',
      WORDPRESS_DATABASE_NAME: 'woocommerce',
      WORDPRESS_DATABASE_USER: 'woocommerce',
      WORDPRESS_DATABASE_PASSWORD: 'woocommerce',
      WORDPRESS_USERNAME: 'admin',
      WORDPRESS_PASSWORD: 'admintest',
      WORDPRESS_EMAIL: 'test@openlinker.local',
      WORDPRESS_SITE_TITLE: 'OL WC Test',
      WORDPRESS_PLUGINS: 'woocommerce',
    })
    .withExposedPorts(8080)
    .withWaitStrategy(
      Wait.forHttp('/wp-json/wc/v3/', 8080)
        .withStartupTimeout(10 * 60 * 1000), // 10 min in ms — matches PS helper budget
    )
    .start();

  const baseUrl = `http://localhost:${wordpress.getMappedPort(8080)}`;
  console.log(`[WC] WordPress+WooCommerce ready at ${baseUrl}. Generating consumer keys...`);

  // 4. Activate HPOS (v1 requirement per spec §6)
  await wordpress.exec([
    'wp', 'option', 'update', 'woocommerce_feature_hpos_enabled', 'yes',
    '--allow-root', '--no-debug',
  ]);

  // 5. Generate WC REST API credentials via WP-CLI.
  //    --no-debug + stderr redirect prevent PHP notices contaminating stdout.
  //    Parse only the LAST non-empty line — WP-CLI may emit progress lines first.
  //    Retry 5× with 10s gaps: WC class init may lag behind WordPress REST readiness.
  let consumerKey = '';
  let consumerSecret = '';

  for (let attempt = 0; attempt < 5; attempt++) {
    const { output, exitCode } = await wordpress.exec([
      'sh', '-c',
      `wp eval 'echo json_encode((new WC_Auth)->create_keys("ol-test", 1, "read_write"));' \
        --allow-root --no-debug 2>/dev/null`,
    ]);
    if (exitCode !== 0) {
      await delay(10_000);
      continue;
    }
    const lastLine = output.trim().split('\n').filter(Boolean).at(-1) ?? '';
    try {
      const parsed = JSON.parse(lastLine) as {
        consumer_key: string;
        consumer_secret: string;
      };
      if (parsed.consumer_key?.startsWith('ck_') && parsed.consumer_secret?.startsWith('cs_')) {
        consumerKey = parsed.consumer_key;
        consumerSecret = parsed.consumer_secret;
        break;
      }
    } catch {
      // JSON parse failed — WC not ready yet
    }
    await delay(10_000);
  }

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      'WooCommerceTestContainer: failed to generate consumer keys after 5 attempts. ' +
      'WC may not have completed initialisation.',
    );
  }

  console.log('[WC] Consumer keys generated. Seeding products...');

  // 6. Seed products via WC REST API (preferred over WP-CLI — validates via WC model layer)
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };

  const seedPost = async (path: string, body: unknown): Promise<{ id: number }> => {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WC seed POST ${path} failed ${res.status}: ${text}`);
    }
    return res.json() as Promise<{ id: number }>;
  };

  const { id: categoryId } = await seedPost('/products/categories', { name: 'Clothing' });

  const { id: shirtId } = await seedPost('/products', {
    name: 'OL Test Shirt', sku: 'WC-SHIRT-001', type: 'simple',
    regular_price: '49.99', manage_stock: true, stock_quantity: 50,
    categories: [{ id: categoryId }],
  });

  const { id: jeansId } = await seedPost('/products', {
    name: 'OL Test Jeans', sku: 'WC-JEANS', type: 'variable',
    categories: [{ id: categoryId }],
    attributes: [{ name: 'Size', options: ['S', 'M'], variation: true, visible: true }],
  });

  const { id: varSId } = await seedPost(`/products/${jeansId}/variations`, {
    sku: 'WC-JEANS-S', regular_price: '79.99',
    manage_stock: true, stock_quantity: 30,
    attributes: [{ name: 'Size', option: 'S' }],
  });

  const { id: varMId } = await seedPost(`/products/${jeansId}/variations`, {
    sku: 'WC-JEANS-M', regular_price: '79.99',
    manage_stock: true, stock_quantity: 20,
    attributes: [{ name: 'Size', option: 'M' }],
  });

  console.log(`[WC] Seed complete. baseUrl=${baseUrl} shirt=${shirtId} jeans=${jeansId} vars=[${varSId},${varMId}]`);

  return {
    baseUrl,
    consumerKey,
    consumerSecret,
    simpleProductExternalId: String(shirtId),
    variableProductExternalId: String(jeansId),
    variationIds: [String(varSId), String(varMId)],

    // try/finally chains release all resources even when startup throws mid-way
    // (typed as undefined above so each stop() is guarded with ?.)
    async cleanup(): Promise<void> {
      try {
        await wordpress?.stop();
      } finally {
        try {
          await mysql?.stop();
        } finally {
          await network?.stop();
        }
      }
    },
  };
  } catch (err) {
    // Startup failed — clean up any containers that did start
    try { await wordpress?.stop(); } catch { /* ignore */ }
    try { await mysql?.stop(); } catch { /* ignore */ }
    try { await network?.stop(); } catch { /* ignore */ }
    throw err;
  }
}

/** Local delay — acceptable in test infrastructure; no shared utility needed for this. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

### Step 4a — Shared `drainProductSyncJobs` helper

**File:** `apps/api/test/integration/helpers/woocommerce-sync.helper.ts`

```ts
/**
 * WooCommerce Integration Test Sync Helpers (#878)
 *
 * Direct service invocation helpers for driving WC sync flows in int-specs,
 * following the drainBulkBatch pattern (harness.getApp().get(TOKEN)).
 *
 * IMPORTANT — architecture contract:
 * Identifier mappings MUST be populated via syncFromMasterByExternalId(), which
 * calls WooCommerceProductMasterAdapter.getProduct() + getProductVariants() →
 * IdentifierMappingService.getOrCreateInternalId(). Direct insertion into
 * identifier_mappings table bypasses the adapter layer and is an architecture
 * violation forbidden by the hexagonal boundary rules.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  IMasterProductSyncService,
} from '@openlinker/core/products';
import {
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
  IMasterInventorySyncService,
} from '@openlinker/core/inventory';
import type { IntegrationTestHarness } from '../setup';

/**
 * Syncs each product by its WC external ID through the full application service path.
 * Call this as the MANDATORY FIRST STEP in all three WC int-specs before running
 * any scenario — it is the only architecture-correct way to populate WC product
 * identifier mappings in integration tests.
 *
 * After this runs:
 * - Simple product (WC-SHIRT-001) → internal product + synthetic variant mapping
 * - Variable product (WC-JEANS)   → internal product + S-variant + M-variant mappings
 *
 * @param externalIds  WC product external IDs from WooCommerceTestContainer
 *                     (simpleProductExternalId + variableProductExternalId)
 */
export async function drainProductSyncJobs(
  harness: IntegrationTestHarness,
  connectionId: string,
  externalIds: string[],
): Promise<void> {
  const syncService = harness
    .getApp()
    .get<IMasterProductSyncService>(MASTER_PRODUCT_SYNC_SERVICE_TOKEN);

  for (const externalId of externalIds) {
    await syncService.syncFromMasterByExternalId(connectionId, externalId);
  }
}

/**
 * Syncs inventory for each product by its WC external ID.
 * Call after drainProductSyncJobs() — requires identifier mappings to exist.
 *
 * @param externalIds  WC product external IDs to sync inventory for
 */
export async function drainInventorySyncJobs(
  harness: IntegrationTestHarness,
  connectionId: string,
  externalIds: string[],
): Promise<void> {
  const syncService = harness
    .getApp()
    .get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);

  for (const externalId of externalIds) {
    await syncService.syncFromMasterByExternalId(connectionId, externalId);
  }
}
```

---

### Step 5 — Stock-change propagation int-spec

**File:** `apps/api/test/integration/woocommerce/woocommerce-inventory-propagation.int-spec.ts`

Setup per suite (`beforeAll`):
```
1. getTestHarness()                                    // Postgres + Redis
2. startWooCommerceContainer()                         // real WC
3. register stub Allegro OfferManager                 // allegro-test-offer-manager-stub.helper.ts
4. createTestConnection(harness, {                    // OL credential storage (hexagonal boundary)
     platformType: 'woocommerce',
     config: { siteUrl: wc.baseUrl },
     credentials: { consumerKey: wc.consumerKey, consumerSecret: wc.consumerSecret },
     enabledCapabilities: ['InventoryMaster'],
   })
5. drainProductSyncJobs(harness, wcConnectionId,      // populates identifier mappings via adapter path
     [wc.simpleProductExternalId, wc.variableProductExternalId])
6. create Allegro offer mapping for shirt synthetic variant → stub OfferManager receives update
```

```
S-1 — simple product stock update (initial 50 from seed):
  drainInventorySyncJobs(harness, wcConnectionId, [wc.simpleProductExternalId])
  assert Allegro stub OfferManager received updateOfferQuantity({ quantity: 50 })

S-2 — out-of-stock (master authoritative including 0):
  PUT ${wc.baseUrl}/wp-json/wc/v3/products/${wc.simpleProductExternalId}
    Authorization: Basic ${consumerKey}:${consumerSecret}
    body: { stock_quantity: 0, manage_stock: true }
  verify WC returns 200 before re-syncing
  drainInventorySyncJobs(harness, wcConnectionId, [wc.simpleProductExternalId])
  assert Allegro stub received updateOfferQuantity({ quantity: 0 })
```

---

### Step 6 — Order ingest int-spec

**File:** `apps/api/test/integration/woocommerce/woocommerce-order-ingest.int-spec.ts`

Setup per suite (`beforeAll`):
```
1. getTestHarness()
2. startWooCommerceContainer()
3. register stub Allegro OrderSource (allegro-test-source-stub.helper.ts)
4. createTestConnection(harness, {
     platformType: 'woocommerce',
     config: { siteUrl: wc.baseUrl },
     credentials: { consumerKey: wc.consumerKey, consumerSecret: wc.consumerSecret },
     enabledCapabilities: ['OrderProcessorManager'],
   })
5. drainProductSyncJobs(harness, wcConnectionId,
     [wc.simpleProductExternalId, wc.variableProductExternalId])
   // REQUIRED: createOrder() resolves product_id via identifierMapping.getExternalIds(Product, ...)
   // Without this step, WooCommerceResourceNotFoundException is thrown.
```

**Scheduler bypass — direct service invocation:**
`OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED` gates only the cron task. The int-spec calls
`IOrderIngestionService.syncOrderFromSource()` directly — identical pattern to
`allegro-prestashop-carrier-mapping.int-spec.ts`. Token and interface confirmed in codebase:

```ts
// In beforeAll, after getTestHarness():
import { IOrderIngestionService, ORDER_INGESTION_SERVICE_TOKEN } from '@openlinker/core/orders';
const ingestService = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
// Actual signature (confirmed from order-ingestion.service.interface.ts):
//   syncOrderFromSource(connectionId: string, externalOrderId: string, sourceEventId?: string)
// Takes the SOURCE connection id only. Destination is auto-resolved from all active
// OrderProcessorManager connections — no destConnectionId parameter.
```

```
S-1 — Allegro order → WC customer order:
  Stub Allegro source yields: 1 order, 2× WC-SHIRT-001, total 99.98 PLN
  await ingestService.syncOrderFromSource(allegroConnectionId, 'allegro-order-1')
  // WC destination is auto-resolved from the wcConnection created in setup step 4
  GET ${wc.baseUrl}/wp-json/wc/v3/orders
    Authorization: Basic ${wc.consumerKey}:${wc.consumerSecret}
  assert:
    • exactly 1 order exists
    • order.status == 'processing'
    • order.line_items[0].product_id == Number(wc.simpleProductExternalId)
    • order.line_items[0].quantity == 2

S-2 — idempotency (same metadata.internalOrderId):
  await ingestService.syncOrderFromSource(allegroConnectionId, 'allegro-order-1')
  GET ${wc.baseUrl}/wp-json/wc/v3/orders Authorization: ...
  assert: total_count == 1 (second call returned early via identifier mapping hit on Order entity)
```

---

### Step 7 — Bulk-listing wizard smoke int-spec

**File:** `apps/api/test/integration/woocommerce/woocommerce-bulk-wizard-smoke.int-spec.ts`

Setup per suite (`beforeAll`):
```
1. getTestHarness()
2. startWooCommerceContainer()
3. register stub Allegro OfferManager + OfferCreator sub-capability
4. createTestConnection(harness, { ..., enabledCapabilities: ['ProductMaster', 'InventoryMaster'] })
5. createTestConnection(harness, { platformType: 'allegro', ... })
6. drainProductSyncJobs(harness, wcConnectionId,
     [wc.simpleProductExternalId, wc.variableProductExternalId])
   // After this:
   //   WC-SHIRT-001 → internal product + synthetic variant in OL catalog
   //   WC-JEANS     → internal product + S-variant + M-variant in OL catalog
   // Both product AND variant identifier mappings are populated because
   // syncFromMasterByExternalId calls getProductVariants() for each product,
   // which registers the variant mappings. The S-2 fan-out depends on this.
   // Verify: assert variant mappings for both variationIds exist (sanity check)

7. Resolve internal variant IDs for use in S-1 and S-2 (acquired via DataSource query
   after drainProductSyncJobs has populated identifier_mappings table):
   ```ts
   // IdentifierMappingOrmEntity is the correct TypeORM entity class — NOT the string
   // 'identifier_mappings'. Confirmed from order-destination-retry.int-spec.ts:67:
   //   dataSource.getRepository(IdentifierMappingOrmEntity)
   // Import via the orm-entities sub-barrel (test-only path, never production code).
   import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

   const dataSource = harness.getDataSource();
   const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);

   const findVariantInternalId = async (externalId: string): Promise<string> => {
     const row = await mappingRepo.findOneOrFail({
       where: {
         entityType: CORE_ENTITY_TYPE.ProductVariant,
         externalId,
         connectionId: wcConnectionId,
       },
     });
     return row.internalId;
   };

   // Simple product synthetic variant: externalId = "product:{wcProductId}" (established convention)
   const shirtVariantInternalId = await findVariantInternalId(
     `product:${wc.simpleProductExternalId}`
   );

   // S-variation WC external id = wc.variationIds[0]
   const jeansSVariantInternalId = await findVariantInternalId(wc.variationIds[0]);
   ```
```

```
S-1 — simple product offer creation:
  POST /api/bulk/offer-creation/submit
    { sourceConnectionId: wcConnectionId,
      destConnectionId: allegroConnectionId,
      variantIds: [shirtVariantInternalId] }  // obtained in setup step 7 above
  drainBulkBatch(harness, batchId)     // reuse existing helper
  assert:
    • Allegro stub OfferCreator received createOffer for WC-SHIRT-001
    • batch status == 'completed', failedCount == 0

S-2 — variable product multi-variant fan-out (#824):
  POST /api/bulk/offer-creation/submit
    { sourceConnectionId: wcConnectionId,
      destConnectionId: allegroConnectionId,
      variantIds: [jeansSVariantInternalId] }       // primary variant triggers fan-out (step 7)
  drainBulkBatch(harness, batchId)
  assert:
    • batch.totalCount == 2  (S + M both expanded)
    • Allegro stub received 2× createOffer
    • batch status == 'completed'
  // Fan-out works because drainProductSyncJobs registered both S and M variant
  // mappings via getProductVariants() during setup step 6.
```

---

### Step 8 — README update

**File:** `README.md`

Add to the dev stack section:

```markdown
### WooCommerce (port 8082)

> **Note:** PrestaShop uses port 8080. WooCommerce uses **8082** to avoid collision.

| Field | Value |
|---|---|
| URL | http://localhost:8082 |
| Admin panel | http://localhost:8082/wp-admin (admin / admin123) |
| WC REST API | http://localhost:8082/wp-json/wc/v3/ |
| HPOS | Enabled (v1 requirement) |
| First boot | ~2–3 min (WordPress auto-install + WC activation) |

**Consumer credentials** — generated by the seed script on first boot:
```bash
pnpm dev:stack:wc-credentials
# → { "consumer_key": "ck_...", "consumer_secret": "cs_...", ... }
```

**Re-run seed** (idempotent — safe to run multiple times, skips if already seeded):
```bash
pnpm dev:stack:seed-woocommerce
```

**Seed data:** 1 simple product (`WC-SHIRT-001`, stock 50) + 1 variable product (`WC-JEANS`, S/M, stock 30+20).
```

---

### Step 9 — package.json scripts

Add to root `package.json`:

```json
"dev:stack:seed-woocommerce": "docker exec openlinker-woocommerce bash /docker-entrypoint-initdb.d/01-seed-wc-data.sh",
"dev:stack:wc-credentials": "docker exec openlinker-woocommerce cat /bitnami/wordpress/.dev-secrets/woocommerce-credentials.json | jq ."
```

`dev:stack:wc-credentials` prints the WC consumer key and secret in formatted JSON — no need to remember the full `docker exec ... cat ...` path. Developers run this once after `pnpm dev:stack:up` to get credentials for `curl` testing or Postman.

---

### Step 10 — .env.example additions

```env
# ── WooCommerce dev stack ──────────────────────────────────────────────────────
# Services bind to 127.0.0.1. Override ports if defaults conflict locally.
# WOOCOMMERCE_MYSQL_HOST_PORT=3307   # host port for woocommerce-mysql
# WOOCOMMERCE_HOST_PORT=8082         # host port for WordPress/WC

# ── WooCommerce worker ─────────────────────────────────────────────────────────
# Enable WC order polling cron (*/5 * * * *). False by default.
# Set to true when a WC connection is active in the worker.
OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED=false
```

---

### Step 11 — WooCommerce operator setup guide (new doc)

**File:** `docs/integrations/woocommerce/setup-guide.md`

Mirrors `docs/integrations/allegro/setup-guide.md` in structure. Content:

```markdown
# WooCommerce Integration Setup Guide

Step-by-step: from a fresh WooCommerce store to a working OpenLinker connection
with catalog sync, inventory propagation, order ingest, and offer creation.

## Prerequisites

- WooCommerce 8.x or later, HPOS enabled (Settings → Advanced → Features → Order Storage)
- WooCommerce REST API v3 accessible over **HTTPS** (HTTP is blocked for security)
- Consumer key + secret with **read_write** scope (WooCommerce → Settings → Advanced → REST API)
- OpenLinker API server running

## 1. Generate WC REST API credentials

1. Log in to WP Admin → WooCommerce → Settings → Advanced → REST API
2. Click **Add Key**
3. Description: `OpenLinker`
4. User: select your admin user
5. Permissions: **Read/Write**
6. Click **Generate API Key**
7. Copy the **Consumer Key** (`ck_...`) and **Consumer Secret** (`cs_...`) — shown only once

> **HTTPS required.** OpenLinker enforces HTTPS for WooCommerce connections to protect
> Basic Auth credentials in transit. Self-signed certificates are accepted in development
> by disabling TLS verification in the connection config.

## 2. Create a WooCommerce connection in OpenLinker

1. Open OL Admin → Integrations → Connections → **New Connection**
2. Platform: **WooCommerce**
3. Site URL: `https://your-shop.com` (must be HTTPS in production)
4. Consumer Key / Consumer Secret: paste from Step 1
5. Click **Test Connection** — expects `{ success: true, latencyMs: ... }`
6. Click **Save**

## 3. Enable capabilities

After the connection is created, enable the capabilities you need:

| Capability | What it does |
|---|---|
| `ProductMaster` | Reads WC catalog into OL (products, variants, categories) |
| `InventoryMaster` | Syncs WC stock → Allegro offer quantities |
| `OrderSource` | Ingests WC orders into OL (watermark polling, `*/5 * * * *`) |
| `OrderProcessorManager` | Creates WC orders from Allegro order events |

## 4. Environment variables

| Variable | Default | Description |
|---|---|---|
| `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED` | `false` | Enable the `woocommerce-orders-poll` cron task. Set to `true` in the worker when using `OrderSource`. |

## 5. Local development

The dev stack includes a pre-configured WC instance at **http://localhost:8082**:

```bash
pnpm dev:stack:up                  # starts WC alongside PrestaShop, Postgres, Redis
pnpm dev:stack:wc-credentials      # prints consumer key + secret
pnpm dev:stack:seed-woocommerce    # re-seeds products if needed (idempotent)
```

Admin panel: http://localhost:8082/wp-admin (admin / admin123)

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connection test fails with "SSRF blocked" | Site URL resolves to RFC-1918 address (e.g. 10.x, 192.168.x) | Use a public URL or disable SSRF check for local dev |
| Connection test fails with "HTTPS required" | HTTP URL provided | Change site URL to `https://` |
| Orders not appearing in OL | `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED=false` | Set to `true` in worker env |
| Stock not propagating to Allegro | `InventoryMaster` capability not enabled | Enable in connection settings |
```

---

### Step 12 — `docs/dev-environment.md` additions

Add WooCommerce row to the **Service URLs and Ports** table:

```markdown
| WooCommerce MySQL | `localhost:3307` | Dedicated MySQL for WooCommerce (separate from PrestaShop) |
| WooCommerce | http://localhost:8082 | WooCommerce store (HPOS enabled) |
```

> **Port note:** PrestaShop uses 8080. WooCommerce uses **8082** to avoid collision.

Add a **WooCommerce** section to **Default Credentials**:

```markdown
### WooCommerce

- **URL:** http://localhost:8082
- **Admin:** http://localhost:8082/wp-admin (admin / admin123)
- **REST API credentials:**
  ```bash
  pnpm dev:stack:wc-credentials
  ```
- **Re-seed:** `pnpm dev:stack:seed-woocommerce` (idempotent)
```

Add to the **Troubleshooting → Port conflicts** section:

```markdown
If port 3307 or 8082 is in use:
   lsof -i :3307    # find what's using WC MySQL port
   lsof -i :8082    # find what's using WC WordPress port
```

---

### Step 13 — `README.md` integration table + dev-stack description

**Integration table** — move WooCommerce from "Planned" to its own "Live" row:

```markdown
| **[WooCommerce](./libs/integrations/woocommerce/)** | Shop *(source + destination + inventory)* | ✅ Live |
```

Remove `WooCommerce` from the Planned row (leave Shopify, BigCommerce, Magento).

**`pnpm dev:stack:up` description** — update to mention WooCommerce:

```markdown
pnpm dev:stack:up   # PostgreSQL · Redis · MySQL · PrestaShop · WooCommerce in Docker
```

---

### Step 14 — `docs/architecture-overview.md` — WC as current implementation

Update each "Future Implementations" list that includes WooCommerce adapters to show them as shipped:

**InventoryMasterPort section:**
```markdown
**Current Implementations**: `PrestashopInventoryMasterAdapter`, `WooCommerceInventoryMasterAdapter`
```

**ProductMasterPort section:**
```markdown
**Current Implementations**: `PrestashopProductMasterAdapter`, `WooCommerceProductMasterAdapter`
```

**OrderSourcePort section:**
```markdown
**Current Implementations**: `AllegroOrderSourceAdapter`, `PrestashopOrderSourceAdapter`, `WooCommerceOrderSourceAdapter`
```

**OrderProcessorManagerPort section:**
```markdown
**Current Implementations**: `PrestashopOrderProcessorManagerAdapter`, `WooCommerceOrderProcessorAdapter`
```

---

### Step 15 — `docs/getting-started.md` — WC reference

Add a brief note after the PrestaShop quick-start section pointing to WooCommerce:

```markdown
## WooCommerce

Prefer WooCommerce as your shop? The WooCommerce adapter supports the same
capabilities as PrestaShop (catalog sync, inventory, orders, offer creation).
See **[WooCommerce Setup Guide](./docs/integrations/woocommerce/setup-guide.md)**
for a step-by-step walkthrough.

The dev stack includes a pre-configured WC instance — run `pnpm dev:stack:up`
and open http://localhost:8082 to access it.
```

---

## Files changed

```
docker-compose.yml
  +woocommerce-mysql   (127.0.0.1:3307, mysql:8.4.7, healthcheck -proot)
  +woocommerce         (127.0.0.1:8082→container:8080, bitnami/wordpress:6.7.2-debian-12-r0,
                        NOTE: 8082 avoids collision with PrestaShop on 8080
                        healthcheck /wp-json/wc/v3/ no-auth)
  +woocommerce_mysql_data volume
  +woocommerce_data volume

docker/woocommerce/
  01-seed-wc-data.sh                ← new (WP-CLI: HPOS + API key; REST: products)

apps/api/test/integration/helpers/
  woocommerce-container.helper.ts   ← new (two-container Network, /wp-json/wc/v3/ probe,
                                           WP-CLI key gen, try/finally cleanup,
                                           REST seed with error guards)
  woocommerce-sync.helper.ts        ← new (drainProductSyncJobs + drainInventorySyncJobs
                                           via harness.getApp().get(TOKEN))

apps/api/test/integration/woocommerce/
  woocommerce-inventory-propagation.int-spec.ts  ← new
  woocommerce-order-ingest.int-spec.ts           ← new
  woocommerce-bulk-wizard-smoke.int-spec.ts      ← new

.env.example                        ← OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED + port overrides
README.md                           ← WC moved Planned→Live, dev:stack:up desc updated (Step 13)
package.json                        ← dev:stack:seed-woocommerce + dev:stack:wc-credentials
docs/integrations/woocommerce/
  setup-guide.md                    ← new (Step 11: operator onboarding guide)
docs/dev-environment.md             ← WC service rows, ports 3307+8082, credentials section (Step 12)
docs/architecture-overview.md       ← WC from Future→Current in all 4 capability sections (Step 14)
docs/getting-started.md             ← WC reference + link to setup guide (Step 15)
```

**Total new files: 8. Total files changed: 7.**
No migrations. No core changes. No new adapters.

---

## Architecture compliance

- **Hexagonal:** Identifier mappings populated via `IMasterProductSyncService.syncFromMasterByExternalId()` → adapter path. Direct DB insertion forbidden.
- **Hexagonal:** WC credentials stored via `createTestConnection()` → `CredentialStorageService`. Direct `integration_credentials` insertion forbidden.
- **Hexagonal:** Int-specs call services via `harness.getApp().get(TOKEN)` — same pattern as `drainBulkBatch`. Raw DB access only for variant internal-ID lookup in test setup (acceptable in tests, not production logic).
- **`IOrderIngestionService` / `ORDER_INGESTION_SERVICE_TOKEN`** from `@openlinker/core/orders` — confirmed in codebase, used in Step 6.
- **SOLID SRP:** `woocommerce-sync.helper.ts` has one responsibility (sync drain utilities). `woocommerce-container.helper.ts` has one responsibility (container lifecycle). `01-seed-wc-data.sh` has one responsibility (seed data).
- **DRY:** `drainProductSyncJobs` and `drainInventorySyncJobs` are shared across all three int-specs. `seedPost` private helper deduplicates REST calls in the Testcontainer helper.
- **Security:** Docker services bind to `127.0.0.1`. Consumer keys generated via WP-CLI, not env vars. `wp eval` uses `--no-debug 2>/dev/null`. REST seed calls guarded with `if (!res.ok) throw`.
- **Readiness probe:** `/wp-json/wc/v3/` (WC namespace index, public). Not `system_status` (auth required, chicken-and-egg). Not `/wp-json/` (WordPress only).
- **`cleanup()` safety:** `try/finally` chains ensure all three resources (WordPress container, MySQL container, Network) are released even on partial failure.
- **TypeScript strict:** `consumerKey` and `consumerSecret` initialized to `''`; `!` non-null assertion removed; `if (!consumerKey || !consumerSecret)` is valid strict-mode.
- **bitnami image pinned** to `6.7.2-debian-12-r0` — no `latest` drift.
- **HPOS** activated in both dev stack (seed script) and Testcontainer helper.
- **Port 8082** for WC WordPress — avoids collision with PrestaShop on 8080. Documented in docker-compose, dev-environment.md, README, and setup-guide.
- **Docs complete:** setup-guide.md (operator onboarding), dev-environment.md (service table + credentials), README.md (WC Live row), architecture-overview.md (WC as current implementation), getting-started.md (WC reference). No operator is left without a path to connect WooCommerce.
- **`OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED`** documented in env var table and `.env.example`.
- **`pnpm dev:stack:seed-woocommerce`** script specified.
- **MySQL healthcheck** uses `-proot` matching `MYSQL_ROOT_PASSWORD: root`.
- **`MySqlContainer`** imported from `@testcontainers/mysql` (`apps/api/package.json:10.28.0`). `StartedMySqlContainer`/`StartedTestContainer` typed variables (`| undefined`) make `cleanup()` and the catch block safe via `?.stop()`.
- **`withStartupTimeout(10 * 60 * 1000)`** — milliseconds; no `Duration` class; matches `prestashop-container.helper.ts` pattern (`.withStartupTimeout(240_000)`).
- **Seed script uses `jq`** (bitnami/wordpress includes it) — no `python3` dependency. `wc_post()` shell function deduplicates all REST calls (DRY).
- **Step 6** acquires `ingestService` via `harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN)`. Actual signature: `syncOrderFromSource(connectionId: string, externalOrderId: string)` — positional args, destination auto-resolved.
- **Step 7** resolves internal variant IDs via `dataSource.getRepository(IdentifierMappingOrmEntity)` — confirmed pattern from `order-destination-retry.int-spec.ts:67`. Import from `@openlinker/core/identifier-mapping/orm-entities` (test sub-barrel, never production).
- **Seed script idempotent** — checks for existing `WC-SHIRT-001` via REST before creating anything. `pnpm dev:stack:seed-woocommerce` safe to run multiple times.
- **DRY — seed script** — all REST calls (including variations) go through `wc_post()` helper.
- **DX — progress logging** — Testcontainer helper logs at every key milestone so cold-boot progress is visible to developers.
- **DX — `pnpm dev:stack:wc-credentials`** — convenience script for credentials retrieval.

## Known constraints

1. **Cold boot:** bitnami/wordpress + MySQL companion ~5 min cold. CI timeout: 10 min (milliseconds, not `Duration`).
2. **`WC_Auth` retry:** up to 5 × 10s. Throws `Error` with clear message on exhaustion.
3. **`fetch()` in helper:** requires Node 18+ (available in this monorepo's LTS baseline).
4. **Fan-out S-2 precondition:** depends on both S and M variant mappings from `drainProductSyncJobs`. Documented inline and in architecture notes.
