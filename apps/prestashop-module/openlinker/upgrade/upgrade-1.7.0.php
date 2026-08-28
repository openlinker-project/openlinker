<?php
/**
 * Module upgrade 1.7.0 - replay guard hardening (#2619).
 *
 * The claim statement no longer depends on a MySQL client flag, and the guard
 * now reports on the configuration page when it cannot answer.
 *
 * The table create is repeated here on purpose. It is a CREATE TABLE IF NOT
 * EXISTS, and a shop that reached this version by copying files over 1.5.x
 * never ran the 1.6.0 script, so without this the guard would keep failing
 * open on a shop that looks fully upgraded.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_7_0($module)
{
    return $module->createRequestNonceTable();
}
