<?php
/**
 * Module upgrade 1.2.0 — rework the OL Dynamic carrier for the validateOrder
 * order-create path (ADR-016 / #905).
 *
 * Existing installs ship the carrier as need_range=0 with no customer groups
 * and no price ranges, so PrestaShop's checkout/validateOrder carrier
 * resolution never surfaces it (`Carrier::getCarriersForOrder` gathers via
 * `(is_module=0 OR need_range=1)`). This upgrade reconfigures the EXISTING
 * carrier row in place — need_range=1 + price shipping method + catch-all
 * range + per-zone delivery rows + all customer groups — without changing the
 * carrier's id (so OPENLINKER_DYNAMIC_CARRIER_ID and historical orders stay
 * valid).
 *
 * @see OpenLinker::upgradeDynamicCarrierForValidateOrder()
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_2_0($module)
{
    return $module->upgradeDynamicCarrierForValidateOrder();
}
