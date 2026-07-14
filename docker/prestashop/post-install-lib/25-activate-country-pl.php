<?php
/**
 * Activate the Poland (PL) country in the dev shop (#1446).
 *
 * PrestaShop ships the PL country row in the default country set but leaves it
 * inactive. OpenLinker's PrestashopCountryResolver rejects inactive countries,
 * so a marketplace order for a PL buyer address fails to sync with
 * "country exists but is not active". Flipping PL active out of the box (the
 * dev shop already defaults to PLN, #521) makes the demo locale self-consistent
 * and removes the manual admin step.
 *
 * Idempotent: re-runs early-exit when PL is already active.
 *
 * Implementation note: legacy bootstrap is intentional — same path bin/console
 * uses internally for ObjectModel ops. We deliberately do NOT boot the Symfony
 * kernel: this script only needs Country, a pre-DI ObjectModel class. Mirrors
 * 20-set-default-currency.php; do not "modernise" without a reason.
 */

// PrestaShop bootstrap. _PS_ADMIN_DIR_ points at the renamed admin folder
// from `10-rename-admin.sh` (lexical-order guaranteed to run before us).
define('_PS_ADMIN_DIR_', '/var/www/html/admin-dev');
require_once '/var/www/html/config/config.inc.php';

$countryId = (int) Country::getByIso('PL', false);

if ($countryId <= 0) {
    // The PL row ships with every default install; its absence is unexpected.
    fwrite(STDERR, "FATAL: PL country row not found in PrestaShop\n");
    exit(1);
}

$country = new Country($countryId);

if ((int) $country->active === 1) {
    echo "* PL country is already active (id={$countryId}); nothing to do\n";
    exit(0);
}

$country->active = true;

if (!$country->save()) {
    fwrite(STDERR, "FATAL: Country::save() failed activating PL (id={$countryId})\n");
    exit(1);
}

echo "* PL country activated (id={$countryId})\n";
