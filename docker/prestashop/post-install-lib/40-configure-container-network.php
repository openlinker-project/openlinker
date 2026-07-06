<?php
/**
 * Make the shop reachable from the app-tier containers on the compose network (#1368).
 *
 * From inside a container, `localhost:8080` is the container itself, not
 * PrestaShop — the app tier must reach the shop by its compose service name
 * (`prestashop`). Two things break that out of the box:
 *
 *   1. No ps_shop_url row matches the `prestashop` Host, so PrestaShop can't
 *      resolve a shop for the request.
 *   2. When the request Host doesn't match the main shop domain, PrestaShop
 *      301-redirects to its canonical domain — breaking webservice GET /api/...
 *
 * This script (idempotently):
 *   - registers a second, non-main ps_shop_url row with domain/domain_ssl =
 *     `prestashop` for the main shop, and
 *   - sets PS_CANONICAL_REDIRECT=0 so no canonical 301 is issued.
 *
 * Legacy bootstrap only — ShopUrl + Configuration are pre-DI ObjectModel
 * classes (mirrors 20-set-default-currency.php); no Symfony kernel needed.
 */

// _PS_ADMIN_DIR_ points at the renamed admin folder from `10-rename-admin.sh`
// (lexical-order guaranteed to run before us).
define('_PS_ADMIN_DIR_', '/var/www/html/admin-dev');
require_once '/var/www/html/config/config.inc.php';

const CONTAINER_DOMAIN = 'prestashop';

$mainShopId = (int) Configuration::get('PS_SHOP_DEFAULT');
if ($mainShopId <= 0) {
    $mainShopId = 1;
}

// 1. Disable canonical redirect (0 = no redirect, 1 = 302, 2 = 301).
if ((int) Configuration::get('PS_CANONICAL_REDIRECT') !== 0) {
    if (!Configuration::updateValue('PS_CANONICAL_REDIRECT', 0)) {
        fwrite(STDERR, "FATAL: Configuration::updateValue(PS_CANONICAL_REDIRECT) failed\n");
        exit(1);
    }
    echo "* PS_CANONICAL_REDIRECT set to 0 (no canonical redirect)\n";
} else {
    echo "* PS_CANONICAL_REDIRECT already 0; nothing to do\n";
}

// 2. Register a container-reachable shop_url row (idempotent).
$existing = ShopUrl::getShopUrls($mainShopId);
$alreadyPresent = false;
if ($existing) {
    foreach ($existing as $row) {
        if ($row['domain'] === CONTAINER_DOMAIN || $row['domain_ssl'] === CONTAINER_DOMAIN) {
            $alreadyPresent = true;
            break;
        }
    }
}

if ($alreadyPresent) {
    echo "* ShopUrl for domain '" . CONTAINER_DOMAIN . "' already exists; nothing to do\n";
    exit(0);
}

$shopUrl = new ShopUrl();
$shopUrl->id_shop = $mainShopId;
$shopUrl->domain = CONTAINER_DOMAIN;
$shopUrl->domain_ssl = CONTAINER_DOMAIN;
$shopUrl->physical_uri = '/';
$shopUrl->virtual_uri = '';
// Non-main: keep the operator's localhost URL as the shop's main URL so the
// storefront/admin the operator opens in their browser is unaffected.
$shopUrl->main = false;
$shopUrl->active = true;

if (!$shopUrl->add()) {
    fwrite(STDERR, "FATAL: ShopUrl::add() failed for domain '" . CONTAINER_DOMAIN . "'\n");
    exit(1);
}

echo "* ShopUrl added for domain '" . CONTAINER_DOMAIN . "' (id_shop={$mainShopId})\n";
echo "* App-tier containers can now reach the shop at http://prestashop\n";
