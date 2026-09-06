<?php
/**
 * F2 driver (#2848, epic #2840) - fires the real, hook-triggering stock
 * write path inside the PrestaShop container.
 *
 * This is NOT reachable through the webservice REST API on PrestaShop 9.0.2:
 * the `stock_availables` resource is dispatched generically
 * (classes/webservice/WebserviceRequest.php:332, `'class' => 'StockAvailable'`,
 * only POST/DELETE forbidden) straight onto `ObjectModel::update()`. The
 * ONLY call site of `Hook::exec('actionUpdateQuantity', ...)` anywhere in
 * PrestaShop 9.0.2 core is inside the static helper
 * `StockAvailable::setQuantity()` (classes/stock/StockAvailable.php:454-455),
 * and the only in-core callers of that helper are the CSV product importer
 * (`src/Adapter/Import/Handler/ProductImportHandler.php`) and the
 * back-office "Quantities" tab flow (`ProductStockUpdater` /
 * `CombinationStockUpdater`). Verified live against this stand: a real
 * `PUT /api/stock_availables/{id}` with a genuinely changed quantity
 * produces HTTP 200 and zero `ps_openlinker_webhook_outbox` rows.
 *
 * So this driver calls `StockAvailable::setQuantity()` directly via CLI -
 * the same call the back-office "raise stock" action makes - which is the
 * closest reproducible stand-in for "an operator raises stock at the shop"
 * available on this PrestaShop version.
 *
 * A raw CLI invocation skips the module-class autoload warming a normal
 * HTTP request gets, so `WebhookSender` (and friends) are require'd here
 * up front; without it `OpenLinker::scheduleFastPathDrain()` throws
 * `Class "WebhookSender" not found` AFTER the outbox row has already been
 * inserted - a harness-invocation artifact, not a product defect, but one
 * that would otherwise corrupt every T1 measurement with a fatal-error
 * exit code.
 *
 * Usage: php ps-set-quantity.php <id_product> <id_product_attribute> <quantity>
 * Output: one line "T0_EPOCH_MS=<ms> T1_EPOCH_MS=<ms>" - both true UTC
 * epoch milliseconds (microtime() is timezone-independent), because
 * PHP's own date.timezone on this image is Europe/Paris while MySQL's
 * NOW() (and this stand's Postgres/OL) run UTC - the outbox table's own
 * `created_at`/`occurred_at` columns (written via PHP's date()) are
 * therefore ~2h AHEAD of `delivered_at` (written via MySQL NOW()) and of
 * every OL-side timestamp. Do not diff those two column families against
 * each other without correcting for that offset; this driver's own
 * epoch-ms anchors sidestep the problem entirely.
 */
chdir('/var/www/html');
require_once('/var/www/html/config/config.inc.php');
require_once('/var/www/html/init.php');
require_once('/var/www/html/modules/openlinker/classes/WebhookSender.php');
require_once('/var/www/html/modules/openlinker/classes/OutboxRepository.php');
require_once('/var/www/html/modules/openlinker/classes/OutboxDrainer.php');
require_once('/var/www/html/modules/openlinker/classes/EventIdGenerator.php');

if ($argc !== 4) {
    fwrite(STDERR, "usage: php ps-set-quantity.php <id_product> <id_product_attribute> <quantity>\n");
    exit(1);
}

$idProduct = (int) $argv[1];
$idAttr = (int) $argv[2];
$qty = (int) $argv[3];

$t0 = microtime(true);
StockAvailable::setQuantity($idProduct, $idAttr, $qty);
$t1 = microtime(true);
printf("T0_EPOCH_MS=%d T1_EPOCH_MS=%d\n", (int) round($t0 * 1000), (int) round($t1 * 1000));
