<?php
/**
 * Module upgrade 1.5.0 - store module settings globally, not per-shop (#2602).
 *
 * Every setting used to be written with `Configuration::updateValue`, which
 * stores it against the shop in context. On a multistore installation the
 * shared secret saved from one shop was invisible from another, so inbound
 * signature verification answered `misconfigured` and webhooks failed.
 *
 * New writes are global. This upgrade fixes installs that already exist: it
 * promotes the value it finds to global scope and deletes the shop-scoped rows
 * that would otherwise keep shadowing it.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_5_0($module)
{
    require_once $module->getLocalPath() . 'classes/ModuleSettings.php';

    ModuleSettings::migrateToGlobal();

    return true;
}
