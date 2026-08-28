<?php
/**
 * The two PrestaShop escaping functions, for unit tests that build SQL.
 *
 * Kept separate from tests/Integration/prestashop-stubs.php so the default
 * suite pulls in no database surface at all.
 */

if (!function_exists('pSQL')) {
    function pSQL($value, $htmlOk = false)
    {
        return str_replace(['\\', '"', "'"], ['\\\\', '\\"', "\\'"], (string)$value);
    }
}

if (!function_exists('bqSQL')) {
    function bqSQL($value)
    {
        return str_replace('`', '', (string)$value);
    }
}
