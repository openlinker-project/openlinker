<?php
/**
 * Module upgrade 1.9.0 - register the product-deletion hook (#2647).
 *
 * A product deleted in PrestaShop had no webhook at all, so it reached
 * OpenLinker only through the hourly deletion-audit pass. That pass walks the
 * catalogue a page at a time, so on a large shop the deleted product kept
 * selling on every marketplace it was published to until the walk reached it.
 *
 * install() registers the hook for a fresh install; this upgrade adds it to a
 * shop that is already running the module, which is otherwise the only way an
 * existing shop would never get it.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_9_0($module)
{
    // Re-registering an already-registered hook is harmless, but the check
    // keeps the upgrade a no-op on a shop that somehow already has it.
    if ($module->isRegisteredInHook('actionProductDelete')) {
        return true;
    }

    return (bool) $module->registerHook('actionProductDelete');
}
