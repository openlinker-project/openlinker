/**
 * WooCommerce Testcontainer Helper (#878)
 *
 * Boots a real WordPress + WooCommerce instance (bitnami/wordpress:6.7.2-debian-12-r0
 * + MySQL 8.4.7) on a shared Testcontainers Network. Follows the two-container
 * pattern established in prestashop-container.helper.ts.
 *
 * Readiness probe: GET /wp-json/wc/v3/ (WC namespace index, public endpoint —
 * returns 200 without auth once WooCommerce has registered its REST routes).
 * NOT /wp-json/wc/v3/system_status (requires consumer key auth — chicken-and-egg
 * before keys are generated) and NOT /wp-json/ (WordPress only, not WC).
 *
 * Consumer key generation via WP-CLI after readiness:
 *   wp eval 'echo json_encode((new WC_Auth)->create_keys(...));' --no-debug 2>/dev/null
 * Parses LAST non-empty stdout line as JSON (PHP notices may precede it).
 * Retries up to 5 × 10 s: WC class init may lag behind WordPress REST readiness.
 * Shape: { key_id, user_id, consumer_key: "ck_...", consumer_secret: "cs_...", key_permissions }
 *
 * Boot-time budget:
 *   Warm Docker image cache (dev laptop, CI re-runs): ~90-120 s
 *   Cold cache (CI first run, image pull + WP auto-install): ~5 min
 *   withStartupTimeout: 10 * 60 * 1000 ms (matches prestashop-container.helper.ts)
 *
 * @module apps/api/test/integration/helpers
 */
// MySqlContainer is in @testcontainers/mysql (apps/api/package.json@10.28.0)
// matching the import pattern in prestashop-container.helper.ts
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';

export interface WooCommerceTestContainer {
  /** http://localhost:{random-port} */
  baseUrl: string;
  /** WC REST API consumer_key (ck_ prefix) — generated via WP-CLI */
  consumerKey: string;
  /** WC REST API consumer_secret (cs_ prefix) — generated via WP-CLI */
  consumerSecret: string;
  /** WC integer id of the simple shirt product (WC-SHIRT-001), as string */
  simpleProductExternalId: string;
  /** WC integer id of the variable jeans product (WC-JEANS), as string */
  variableProductExternalId: string;
  /** WC integer ids of the [S, M] variations, as strings */
  variationIds: [string, string];
  /** Stop containers and network. Safe to call even if startup failed mid-way. */
  cleanup(): Promise<void>;
}

export async function startWooCommerceContainer(): Promise<WooCommerceTestContainer> {
  // Typed as undefined so cleanup() guards are safe on partial startup failure
  let network: StartedNetwork | undefined;
  let mysql: StartedMySqlContainer | undefined;
  let wordpress: StartedTestContainer | undefined;

  try {
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

    // 3. WordPress+WooCommerce — wait for WC namespace index (public, no auth required)
    //    withStartupTimeout takes milliseconds — same as .withStartupTimeout(240_000) in PS helper
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
          .withStartupTimeout(10 * 60 * 1000),
      )
      .start();

    const baseUrl = `http://localhost:${wordpress.getMappedPort(8080)}`;
    console.log(`[WC] WordPress+WooCommerce ready at ${baseUrl}. Activating HPOS + generating keys...`);

    // 4. Activate HPOS (v1 requirement per spec §6)
    await wordpress.exec([
      'wp', 'option', 'update', 'woocommerce_feature_hpos_enabled', 'yes',
      '--allow-root', '--no-debug',
    ]);

    // 5. Generate WC REST API credentials via WP-CLI.
    //    Retry 5 × 10 s: WC_Auth class may not be available immediately after WC REST readiness.
    //    --no-debug 2>/dev/null: suppress PHP notices from stdout.
    //    Parse LAST non-empty line: WP-CLI may emit progress before the JSON.
    let consumerKey = '';
    let consumerSecret = '';

    for (let attempt = 0; attempt < 5; attempt++) {
      const { output, exitCode } = await wordpress.exec([
        'sh', '-c',
        `wp eval 'echo json_encode((new WC_Auth)->create_keys("ol-test", 1, "read_write"));' \
          --allow-root --no-debug 2>/dev/null`,
      ]);
      if (exitCode !== 0) { await delay(10_000); continue; }
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
        // JSON parse failed — WC not fully ready yet
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

    // 6. Seed products via WC REST API (validates data through WC model layer)
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

    console.log(
      `[WC] Seed complete. baseUrl=${baseUrl} shirt=${shirtId} jeans=${jeansId} vars=[${varSId},${varMId}]`,
    );

    return {
      baseUrl,
      consumerKey,
      consumerSecret,
      simpleProductExternalId: String(shirtId),
      variableProductExternalId: String(jeansId),
      variationIds: [String(varSId), String(varMId)],

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
    // Partial startup: clean up any containers that did start
    try { await wordpress?.stop(); } catch { /* ignore */ }
    try { await mysql?.stop(); } catch { /* ignore */ }
    try { await network?.stop(); } catch { /* ignore */ }
    throw err;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
