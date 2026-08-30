<?php
/**
 * Module upgrade 1.3.0 - move outbox coalescing off the event id (#2603).
 *
 * The outbox used to dedup on `event_id`, which embedded a rounded time window
 * and stayed unique for the life of the row. Because delivered rows were part
 * of that collision and were never removed, a second change to the same product
 * inside the window was silently dropped once the first had been sent - so a
 * one-minute cron with a five-minute window lost roughly four fifths of its
 * stock events.
 *
 * Coalescing now lives on a nullable `dedup_key` that the repository clears when
 * a row leaves the queue. This upgrade adds the column and its unique index,
 * and drops the retired operator-facing dedup-window setting.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_3_0($module)
{
    $table = _DB_PREFIX_ . 'openlinker_webhook_outbox';
    $db = Db::getInstance();

    $columns = $db->executeS('SHOW COLUMNS FROM `' . bqSQL($table) . '` LIKE \'dedup_key\'');
    if (empty($columns)) {
        if (!$db->execute('ALTER TABLE `' . bqSQL($table) . '` ADD `dedup_key` VARCHAR(255) NULL AFTER `event_id`')) {
            return false;
        }
    }

    $indexes = $db->executeS('SHOW INDEX FROM `' . bqSQL($table) . '` WHERE Key_name = \'dedup_key\'');
    if (empty($indexes)) {
        // Existing rows keep dedup_key NULL. MySQL treats NULLs as distinct in a
        // unique index, so history never blocks a new event and no backfill is
        // needed: the next hook fire for a subject claims the key.
        if (!$db->execute('ALTER TABLE `' . bqSQL($table) . '` ADD UNIQUE KEY `dedup_key` (`dedup_key`)')) {
            return false;
        }
    }

    Configuration::deleteByName('DEDUPLICATION_WINDOW_MINUTES');

    return true;
}
