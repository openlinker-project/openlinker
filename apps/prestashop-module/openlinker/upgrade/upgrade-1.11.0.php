<?php
/**
 * Module upgrade 1.11.0 - register the two generic stock ObjectModel hooks
 * that close the webservice stock-write coverage gap (#2924).
 *
 * actionUpdateQuantity - the module's only stock hook before this - is fired
 * exactly once in PrestaShop core, from inside the static
 * StockAvailable::setQuantity() helper. A webservice PUT to
 * /api/stock_availables/{id} reaches that helper only INDIRECTLY, and only
 * when the row being written belongs to a product WITH combinations: for
 * such a row, StockAvailableCore::postSave() recomputes the aggregate
 * (id_product_attribute = 0) and rewrites it through setQuantity(), which is
 * what fires the hook. For a SIMPLE product's own row (no combinations,
 * id_product_attribute already 0), postSave() returns immediately and
 * setQuantity() - and therefore actionUpdateQuantity - never runs at all.
 * That is the mechanism on BOTH PrestaShop 8.x and 9.x; it is not a
 * version-specific regression, it was simply never observed on a catalogue
 * without combination products before now.
 *
 * actionObjectStockAvailableUpdateAfter / actionObjectStockAvailableAddAfter
 * are the generic ObjectModel hooks core dispatches on EVERY
 * StockAvailable::add()/update() call, unconditionally - including the
 * webservice's own updateWs(). Registering them closes the gap for every
 * product shape, on a shop that is already running the module.
 *
 * install() registers both hooks for a fresh install; this upgrade adds them
 * to a shop that is already running the module, which is otherwise the only
 * way an existing shop would never get them.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_11_0($module)
{
    $ok = true;

    foreach (['actionObjectStockAvailableUpdateAfter', 'actionObjectStockAvailableAddAfter'] as $hook) {
        // Re-registering an already-registered hook is harmless, but the
        // check keeps the upgrade a no-op on a shop that somehow already
        // has it.
        if ($module->isRegisteredInHook($hook)) {
            continue;
        }

        $ok = $ok && (bool) $module->registerHook($hook);
    }

    return $ok;
}
