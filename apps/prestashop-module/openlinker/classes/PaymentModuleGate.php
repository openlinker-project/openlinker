<?php
/**
 * Payment Module Gate
 *
 * Decides whether the payment module the order-import controller delegates to
 * can safely be handed to `PaymentModule::validateOrder`.
 *
 * The `active` test is the point of this class. `validateOrder` starts with a
 * `die()` that prints an HTML notice when the payment module is disabled, and
 * PHP sends that with HTTP 200 - so the caller reads a failure as a success and
 * no order is ever created (#2601). `ps_checkpayment` is a demo module and is
 * routinely switched off, so this is a normal state, not an edge case.
 *
 * @module prestashop-module/classes
 * @see apps/prestashop-module/openlinker/controllers/front/importorder.php
 */

class PaymentModuleGate
{
    /**
     * Reason the given module cannot be used, or null when it can.
     *
     * @param mixed $module Result of Module::getInstanceByName(), so possibly false.
     * @return string|null 'payment-module-unavailable' | 'payment-module-inactive' | null
     */
    public static function reasonUnusable($module)
    {
        if (!is_object($module) || !($module instanceof PaymentModule)) {
            return 'payment-module-unavailable';
        }

        if (empty($module->active)) {
            return 'payment-module-inactive';
        }

        return null;
    }

    /**
     * A requested payment module name, or null when it is absent or not a
     * plausible module technical name (#3988).
     *
     * PrestaShop module names are lowercase `[a-z0-9_]` identifiers. Anything
     * else - a free-text label from an older mapping, or an attempt to pass a
     * path - is treated as "no module requested" rather than looked up.
     *
     * @param mixed $requested Raw `payment_module` request field.
     * @return string|null
     */
    public static function normalizeRequestedModule($requested)
    {
        if (!is_string($requested)) {
            return null;
        }
        $requested = trim($requested);
        if ($requested === '' || preg_match('/^[a-z0-9_]{1,64}$/', $requested) !== 1) {
            return null;
        }

        return $requested;
    }

    /**
     * The order's readable payment label for a module the order was imported
     * with: its display name, or the supplied fallback when it has none.
     *
     * @param object $module A usable PaymentModule.
     * @param string $fallback Label to use when the module exposes no display name.
     * @return string
     */
    public static function displayLabel($module, $fallback)
    {
        $name = isset($module->displayName) ? trim((string) $module->displayName) : '';

        return $name !== '' ? $name : $fallback;
    }
}
