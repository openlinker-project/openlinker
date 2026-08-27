<?php
/**
 * Module upgrade 1.4.0 - give the outbox a retention policy (#2604).
 *
 * The outbox had no DELETE anywhere, so every installation carrying this module
 * grew a table that only ever got bigger. Retention now runs from the cron
 * controller and prunes terminal rows: delivered rows past an operator-set
 * horizon, failed rows past a fixed longer one, plus a hard row cap.
 *
 * This upgrade adds the index those deletes read and seeds the new setting.
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

    $indexes = $db->executeS('SHOW INDEX FROM `' . bqSQL($table) . '` WHERE Key_name = "status_updated"');
    if (empty($indexes)) {
        // Without this, the hourly "is there anything to prune" probe is a full
        // table scan on exactly the tables that are already too big.
        if (!$db->execute('ALTER TABLE `' . bqSQL($table) . '` ADD KEY `status_updated` (`status`, `updated_at`)')) {
            return false;
        }
    }

    // updateValue, not a conditional insert: this key cannot exist yet.
    Configuration::updateValue(
        'OPENLINKER_OUTBOX_RETENTION_DAYS',
        OpenLinker::DEFAULT_OUTBOX_RETENTION_DAYS
    );

    return true;
}
