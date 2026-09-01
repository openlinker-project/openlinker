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
}
