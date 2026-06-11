/**
 * WooCommerce Testcontainer Helper (#878)
 *
 * Boots a real WordPress + WooCommerce instance (bitnamilegacy/wordpress:6.7.1
 * + MySQL 8.4.7) on a shared Testcontainers Network. Follows the two-container
 * pattern established in prestashop-container.helper.ts.
 *
 * Readiness probe: GET /wp-json/wc/v3/ (WC namespace index, public endpoint —
 * returns 200 without auth once WooCommerce has registered its REST routes).
 *
 * Key generation: direct wpdb INSERT with hash_hmac("sha256", $ck, "wc-api").
 * WC_Auth::create_keys() is unreliable from WP-CLI context in WC 9+.
 *
 * Product seeding: WC PHP API via `wp eval` (WC_Product_Simple, WC_Product_Variable,
 * WC_Product_Variation). Avoids HTTP auth entirely — WooCommerce REST API over plain
 * HTTP only supports OAuth 1.0a; Basic Auth and query-string auth require is_ssl()=true.
 *
 * Boot-time budget:
 *   Warm Docker image cache (dev laptop, CI re-runs): ~90-120 s
 *   Cold cache (CI first run, image pull + WP auto-install): ~5 min
 *   withStartupTimeout: 12 * 60 * 1000 ms (matches prestashop-container.helper.ts 12 min deadline)
 *
 * @module apps/api/test/integration/helpers
 */
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
  // Boot the network first so `startedNetwork` is a non-null const — avoids
  // undefined propagation into withNetwork() calls below (same pattern as
  // prestashop-container.helper.ts).
  const startedNetwork = await new Network().start();
  const network: StartedNetwork | undefined = startedNetwork;
  let mysql: StartedMySqlContainer | undefined;
  let wordpress: StartedTestContainer | undefined;

  try {
    console.log('[WC] Starting MySQL companion...');

    mysql = await new MySqlContainer('mysql:8.4.7')
      .withNetwork(startedNetwork)
      .withNetworkAliases('woocommerce-mysql-tc')
      .withDatabase('woocommerce')
      .withUsername('woocommerce')
      .withUserPassword('woocommerce')
      .start();

    console.log('[WC] MySQL ready. Starting WordPress+WooCommerce (warm: ~2min, cold: ~5min)...');

    wordpress = await new GenericContainer('bitnamilegacy/wordpress:6.7.1')
      .withNetwork(startedNetwork)
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
        // Pinned by URL: latest WC requires a newer WP than the frozen
        // bitnamilegacy 6.7.1 image ships (see docker-compose.yml).
        WORDPRESS_PLUGINS: 'https://downloads.wordpress.org/plugin/woocommerce.10.1.0.zip',
      })
      .withExposedPorts(8080)
      .withWaitStrategy(
        Wait.forHttp('/wp-json/wc/v3/', 8080)
          .withStartupTimeout(12 * 60 * 1000),
      )
      .start();

    // Use getHost() (NOT a hardcoded "localhost"): on self-hosted CI runners the
    // Docker daemon is not necessarily reachable at localhost, so the mapped port
    // is published on getHost(), not on "localhost". Hardcoding "localhost" works
    // on a dev laptop (getHost() === localhost there) but yields ECONNREFUSED in
    // CI — the root cause of the #878 "network error after 3 retries" failures.
    // Mirrors the prestashop-container.helper.ts pattern.
    const externalHost = wordpress.getHost();
    const externalPort = wordpress.getMappedPort(8080);
    const baseUrl = `http://${externalHost}:${externalPort}`;
    console.log(`[WC] WordPress+WooCommerce ready at ${baseUrl}. Activating HPOS + generating keys...`);

    // Pin WP's canonical URL to the reachable host:port so WordPress never
    // redirect_canonical()s a REST request to a URL the test runner can't reach
    // (e.g. the install-time "localhost" host, or — with the force-https shim
    // below making is_ssl() true — an https:// canonical that has no TLS
    // listener). Stored as http:// to match the scheme the client actually
    // connects on; the force-https mu-plugin keeps is_ssl() true for WC auth.
    await wordpress.exec([
      'wp', 'option', 'update', 'siteurl', baseUrl, '--allow-root', '--no-debug',
    ]);
    await wordpress.exec([
      'wp', 'option', 'update', 'home', baseUrl, '--allow-root', '--no-debug',
    ]);

    // Activate HPOS (v1 requirement per spec §6)
    await wordpress.exec([
      'wp', 'option', 'update', 'woocommerce_feature_hpos_enabled', 'yes',
      '--allow-root', '--no-debug',
    ]);

    // Generate consumer key via direct wpdb INSERT.
    // wc_api_hash() = hash_hmac('sha256', $key, 'wc-api') — must match so WC can
    // look up the hashed key from the query-string consumer_key parameter.
    // Retry: WC table may not be fully migrated immediately after REST readiness.
    let consumerKey = '';
    let consumerSecret = '';

    for (let attempt = 0; attempt < 5; attempt++) {
      const { output, exitCode } = await wordpress.exec([
        'sh', '-c',
        `wp eval '
          $ck = "ck_" . bin2hex(random_bytes(20));
          $cs = "cs_" . bin2hex(random_bytes(20));
          global $wpdb;
          $ok = $wpdb->insert(
            $wpdb->prefix . "woocommerce_api_keys",
            [
              "user_id"         => 1,
              "description"     => "OL Test Key",
              "permissions"     => "read_write",
              "consumer_key"    => hash_hmac("sha256", $ck, "wc-api"),
              "consumer_secret" => $cs,
              "truncated_key"   => substr($ck, -7),
            ]
          );
          if (!$ok) { fwrite(STDERR, $wpdb->last_error); exit(1); }
          echo json_encode(["consumer_key" => $ck, "consumer_secret" => $cs]);
        ' --allow-root --no-debug 2>/dev/null`,
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
        'WooCommerceTestContainer: failed to generate consumer keys after 5 attempts.',
      );
    }

    console.log('[WC] Consumer keys generated. Seeding products via WC PHP API...');

    // Seed products using WC PHP classes directly via wp eval.
    // Avoids WooCommerce REST API HTTP auth (over plain HTTP only OAuth 1.0a works;
    // Basic Auth and query-string auth both require is_ssl()=true in WC source).

    // Pass wp eval arguments directly to Docker exec — no shell intermediary,
    // so PHP variables ($p, $v, $existing …) are never subject to shell expansion.
    // JSON.stringify-then-double-quote (the sh -c approach) would silently strip
    // every $var because the shell expands them as empty env vars.
    const wpEval = async (code: string): Promise<string> => {
      const { output, exitCode } = await wordpress!.exec([
        'wp', 'eval', code, '--allow-root', '--no-debug',
      ]);
      if (exitCode !== 0) throw new Error(`wp eval failed (exit ${exitCode}): ${output}`);
      return output.trim().split('\n').filter(Boolean).at(-1) ?? '';
    };

    // Get-or-create Clothing category
    const categoryId = await wpEval(`
      $existing = term_exists("Clothing", "product_cat");
      if ($existing) {
        echo is_array($existing) ? $existing["term_id"] : $existing;
      } else {
        $term = wp_insert_term("Clothing", "product_cat");
        echo is_wp_error($term) ? "0" : $term["term_id"];
      }
    `);
    if (!categoryId || categoryId === '0') {
      throw new Error('WooCommerceTestContainer: failed to get or create Clothing category');
    }

    const shirtId = await wpEval(`
      $p = new WC_Product_Simple();
      $p->set_name("OL Test Shirt");
      $p->set_sku("WC-SHIRT-001");
      $p->set_regular_price("49.99");
      $p->set_manage_stock(true);
      $p->set_stock_quantity(50);
      $p->set_category_ids([${categoryId}]);
      $p->set_status("publish");
      echo $p->save();
    `);
    if (!shirtId || shirtId === '0') {
      throw new Error('WooCommerceTestContainer: failed to create WC-SHIRT-001');
    }

    const jeansId = await wpEval(`
      $attr = new WC_Product_Attribute();
      $attr->set_name("Size");
      $attr->set_options(["S", "M"]);
      $attr->set_variation(true);
      $attr->set_visible(true);
      $p = new WC_Product_Variable();
      $p->set_name("OL Test Jeans");
      $p->set_sku("WC-JEANS");
      $p->set_category_ids([${categoryId}]);
      $p->set_attributes([$attr]);
      $p->set_status("publish");
      echo $p->save();
    `);
    if (!jeansId || jeansId === '0') {
      throw new Error('WooCommerceTestContainer: failed to create WC-JEANS');
    }

    const varSId = await wpEval(`
      $v = new WC_Product_Variation();
      $v->set_parent_id(${jeansId});
      $v->set_sku("WC-JEANS-S");
      $v->set_regular_price("79.99");
      $v->set_manage_stock(true);
      $v->set_stock_quantity(30);
      $v->set_attributes(["size" => "S"]);
      $v->set_status("publish");
      $v->update_meta_data("_ean", "5901234123457");
      echo $v->save();
    `);
    if (!varSId || varSId === '0') {
      throw new Error('WooCommerceTestContainer: failed to create WC-JEANS-S variation');
    }

    const varMId = await wpEval(`
      $v = new WC_Product_Variation();
      $v->set_parent_id(${jeansId});
      $v->set_sku("WC-JEANS-M");
      $v->set_regular_price("79.99");
      $v->set_manage_stock(true);
      $v->set_stock_quantity(20);
      $v->set_attributes(["size" => "M"]);
      $v->set_status("publish");
      $v->update_meta_data("_ean", "5901234123464");
      echo $v->save();
    `);
    if (!varMId || varMId === '0') {
      throw new Error('WooCommerceTestContainer: failed to create WC-JEANS-M variation');
    }

    // WooCommerce REST API `perform_basic_authentication()` is gated on `is_ssl()`.
    // The Testcontainer runs on plain HTTP; install a must-use plugin that sets
    // $_SERVER['HTTPS'] = 'on' so is_ssl() returns true. Standard proxy workaround.
    //
    // Making is_ssl() true also makes WordPress derive an https:// canonical URL
    // for the request and redirect_canonical() it there — but the test runner
    // reaches the container only over plain http on the mapped port, so that
    // redirect lands on a dead TLS port and Node's fetch surfaces a connection
    // error (the #878 "network error after 3 retries"). Disable redirect_canonical
    // so the REST request is served in place on the reachable http:// host:port.
    //
    // Installed AFTER seeding so a syntax error here can't break the wp eval seed calls.
    // chr(36) produces '$' without PHP or shell expanding it in the string literal.
    await wordpress.exec([
      'wp', 'eval',
      `wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . '/force-https.php', '<?php ' . chr(36) . '_SERVER["HTTPS"] = "on"; add_filter("redirect_canonical", "__return_false");');`,
      '--allow-root', '--no-debug',
    ]);

    console.log(
      `[WC] Seed complete. baseUrl=${baseUrl} shirt=${shirtId} jeans=${jeansId} vars=[${varSId},${varMId}]`,
    );

    return {
      baseUrl,
      consumerKey,
      consumerSecret,
      simpleProductExternalId: shirtId,
      variableProductExternalId: jeansId,
      variationIds: [varSId, varMId],

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
    try { await wordpress?.stop(); } catch { /* ignore */ }
    try { await mysql?.stop(); } catch { /* ignore */ }
    try { await network?.stop(); } catch { /* ignore */ }
    throw err;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
