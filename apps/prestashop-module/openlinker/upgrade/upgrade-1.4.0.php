<?php
/**
 * Module upgrade 1.4.0 - give the outbox a retention policy (#2604).
 *
 * The outbox had no DELETE anywhere, so every installation carrying this module
 * grew a table that only ever got bigger. Retention now runs from the cron
 * controller and prunes terminal rows: delivered rows past an operator-set
 * horizon, failed rows past a fixed longer one, plus a hard row cap.
 *
 * This upgrade adds the index those deletes read and seeds the new setting. An
 * operator whose outbox is in the millions should add the index by hand first -
 * see docs/prestashop-module-testing-guide.md.
 * Existing rows need no backfill - a delivered row's `updated_at` is already
 * the moment it was delivered, so the first pass prunes history correctly on an
 * install that has been running for months.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_4_0($module)
{
    $table = _DB_PREFIX_ . 'openlinker_webhook_outbox';
    $db = Db::getInstance();

    // This upgrade exists for installs whose outbox is already enormous, which
    // is exactly where an ADD INDEX inside a web request hits
    // max_execution_time. A timeout leaves the ALTER running server-side, so
    // the SHOW INDEX guard below still reports no index and a re-run of the
    // upgrade would issue a second ALTER that blocks on the first.
    if (function_exists('set_time_limit')) {
        @set_time_limit(0);
    }

    // One named lock, taken without waiting, is what makes the re-run safe: a
    // second run cannot queue behind the first, it reports and moves on. The
    // index is a performance aid, never a correctness requirement - retention
    // deletes the same rows without it - so failing the whole module upgrade
    // over it would be the worse outcome.
    $lockName = 'openlinker_outbox_status_updated';
    $lock = $db->getValue('SELECT GET_LOCK("' . pSQL($lockName) . '", 0)');
    if ((int)$lock !== 1) {
        PrestaShopLogger::addLog(
            'OpenLinker: another process is already adding the outbox `status_updated`'
            . ' index. Retention works without it, but confirm the index exists once'
            . ' that finishes.',
            2,
            null,
            'Module',
            null
        );

        return true;
    }

    try {
        $indexes = $db->executeS('SHOW INDEX FROM `' . bqSQL($table) . '` WHERE Key_name = \'status_updated\'');
        if (empty($indexes)) {
            // Without this, the hourly "is there anything to prune" probe is a
            // full table scan on exactly the tables that are already too big.
            // INPLACE with LOCK=NONE keeps the shop writing to the outbox while
            // the index builds; a server that cannot do that says so, and the
            // plain ALTER is the fallback.
            $added = $db->execute(
                'ALTER TABLE `' . bqSQL($table) . '` ADD KEY `status_updated` (`status`, `updated_at`),'
                . ' ALGORITHM=INPLACE, LOCK=NONE'
            );

            if (!$added) {
                $added = $db->execute(
                    'ALTER TABLE `' . bqSQL($table) . '` ADD KEY `status_updated` (`status`, `updated_at`)'
                );
            }

            if (!$added) {
                return false;
            }
        }
    } finally {
        $db->execute('DO RELEASE_LOCK("' . pSQL($lockName) . '")');
    }

    // updateValue, not a conditional insert: this key cannot exist yet.
    Configuration::updateValue(
        'OPENLINKER_OUTBOX_RETENTION_DAYS',
        OpenLinker::DEFAULT_OUTBOX_RETENTION_DAYS
    );

    return true;
}
