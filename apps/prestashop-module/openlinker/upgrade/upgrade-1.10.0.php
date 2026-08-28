<?php
/**
 * Module upgrade 1.10.0 - seed the outbox run budget and stale threshold (#2652).
 *
 * Both values are read through resolvers that fall back to a safe default, so
 * an un-seeded shop already behaves correctly. Seeding them anyway is what puts
 * a real number in the configuration screen: an empty field reads as "off" to
 * an operator, and these two settings only help if the operator can see and
 * change them.
 *
 * Guarded so a re-run is harmless, and - more importantly - so it never
 * overwrites a value an operator already chose. The guard tests for an absent
 * or empty stored value rather than using empty(), which is true for a stored
 * "0" and would silently reset a deliberate choice on every upgrade re-run.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * @param OpenLinker $module
 * @return bool
 */
function upgrade_module_1_10_0($module)
{
    require_once $module->getLocalPath() . 'classes/OutboxRepository.php';

    $defaults = [
        OutboxRepository::RUN_BUDGET_CONFIG_KEY => OutboxRepository::DEFAULT_RUN_BUDGET_SECONDS,
        OutboxRepository::STALE_PROCESSING_THRESHOLD_CONFIG_KEY =>
            OutboxRepository::DEFAULT_STALE_PROCESSING_THRESHOLD_MINUTES,
    ];

    foreach ($defaults as $key => $default) {
        $stored = Configuration::getGlobalValue($key);
        if ($stored === false || $stored === null || $stored === '') {
            Configuration::updateGlobalValue($key, $default);
        }
    }

    return true;
}
