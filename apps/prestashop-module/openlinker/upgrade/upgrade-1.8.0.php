<?php
/**
 * Module upgrade 1.8.0 - re-run the settings scope migration, corrected (#2602 review).
 *
 * The 1.5.0 migration decided which rows were shop-scoped with
 * `id_shop IS NOT NULL`. PrestaShop core treats `id_shop = 0` as global, so on
 * a database holding its global rows that way - legacy dumps, SQL imports,
 * third-party writes - the migration promoted the value into that same row and
 * then deleted it, leaving the signing secret in no row at all.
 *
 * The predicate is fixed in `ModuleSettings`, and the migration is repeated
 * here for two reasons. A shop that already ran 1.5.0 correctly gets a no-op,
 * because the corrected predicate matches nothing. A shop that reached a later
 * version by copying files over 1.4.x never ran 1.5.0 at all, and would
 * otherwise stay broken on multistore while looking fully upgraded - the same
 * argument `upgrade-1.7.0.php` makes for repeating its table create.
 *
 * It cannot recover a value the old predicate already destroyed. Nothing can:
 * the row was deleted. Such a shop re-enters the secret on the configuration
 * page, and this upgrade stops it happening again.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_8_0($module)
{
    require_once $module->getLocalPath() . 'classes/ModuleSettings.php';

    ModuleSettings::migrateToGlobal();

    return true;
}
