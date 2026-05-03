<?php
/**
 * Set PLN as the dev shop's default currency (#521).
 *
 * Idempotent: re-runs after first invocation early-exit when PS_CURRENCY_DEFAULT
 * already resolves to PLN.
 *
 * Implementation note: legacy bootstrap is intentional — same path bin/console
 * uses internally for ObjectModel ops. We deliberately do NOT boot the Symfony
 * kernel: this script only needs Currency + Configuration, both pre-DI
 * ObjectModel classes. Using the legacy bootstrap keeps the script <100 LoC and
 * avoids carrying a DI container + service-id stability assumptions across PS
 * minor versions. Future maintainer: do not "modernise" without a reason.
 */

// PrestaShop bootstrap.
define('_PS_ADMIN_DIR_', __DIR__);
require_once '/var/www/html/config/config.inc.php';

$existingPlnId = (int) Currency::getIdByIsoCode('PLN', 0, true);
$existingDefaultId = (int) Configuration::get('PS_CURRENCY_DEFAULT');

if ($existingPlnId > 0 && $existingDefaultId === $existingPlnId) {
    echo "* PLN is already the default currency (id={$existingPlnId}); nothing to do\n";
    exit(0);
}

if ($existingPlnId > 0) {
    $plnId = $existingPlnId;
    echo "* PLN already exists (id={$plnId}); promoting to default\n";
} else {
    $pln = new Currency();
    $pln->iso_code = 'PLN';
    $pln->numeric_iso_code = '985';
    $pln->precision = 2;
    $pln->conversion_rate = 4.30;
    $pln->active = true;
    $pln->deleted = false;

    // PS 9.x Currency keys lang-fields by id_lang; we set both English and the
    // installer's default lang to keep dropdowns readable across locales.
    $defaultLangId = (int) Configuration::get('PS_LANG_DEFAULT');
    $pln->name = [$defaultLangId => 'Polish złoty'];

    if (!$pln->add()) {
        fwrite(STDERR, "FATAL: Currency::add() failed for PLN\n");
        exit(1);
    }
    $plnId = (int) $pln->id;
    echo "* PLN added (id={$plnId})\n";
}

if (!Configuration::updateValue('PS_CURRENCY_DEFAULT', $plnId)) {
    fwrite(STDERR, "FATAL: Configuration::updateValue(PS_CURRENCY_DEFAULT) failed\n");
    exit(1);
}

echo "* PS_CURRENCY_DEFAULT set to PLN (id={$plnId})\n";
echo "* EUR/USD remain active (operators can still pick them); only the default flipped\n";
