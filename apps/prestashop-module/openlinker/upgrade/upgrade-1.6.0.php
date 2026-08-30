<?php
/**
 * Module upgrade 1.6.0 - replay guard for signed requests (#2619).
 *
 * Adds the table the replay guard claims request keys in. The order-import
 * endpoint had no replay protection at all, so a captured request could be
 * resent and would be accepted on its signature alone.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_6_0($module)
{
    return $module->createRequestNonceTable();
}
