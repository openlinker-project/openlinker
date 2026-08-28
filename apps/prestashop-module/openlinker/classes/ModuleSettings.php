<?php
/**
 * Module Settings
 *
 * Owns the list of configuration keys this module writes, and the one-off
 * migration that lifts values already stored per-shop up to global scope.
 *
 * `Configuration::updateValue` writes into the shop currently in context. On a
 * multistore installation a secret saved while shop A was selected is invisible
 * from shop B, so inbound signature verification answers `misconfigured` and
 * every webhook fails (#2602). All of these settings describe one link to one
 * OpenLinker backend, so global is the only scope that can be correct.
 *
 * @module prestashop-module/classes
 */

class ModuleSettings
{
    /**
     * Every configuration key the module owns.
     *
     * Keep this in step with install(), uninstall() and the configuration form.
     * A key missing here keeps its per-shop rows and stays broken on multistore.
     *
     * @var string[]
     */
    const KEYS = [
        'OPENLINKER_BASE_URL',
        'OPENLINKER_CONNECTION_ID',
        'OPENLINKER_WEBHOOK_SECRET',
        'OPENLINKER_WEBHOOK_SECRET_SET_AT',
        'OPENLINKER_CRON_TOKEN',
        'OPENLINKER_CRON_TOKEN_SET_AT',
        'ENABLE_PRODUCT_EVENTS',
        'ENABLE_STOCK_EVENTS',
        'ENABLE_ORDER_EVENTS',
        'BATCH_SIZE',
        'MAX_RETRY_ATTEMPTS',
        'RETRY_BACKOFF_MULTIPLIER',
        'OPENLINKER_OUTBOX_RETENTION_DAYS',
        'OPENLINKER_OUTBOX_RETENTION_LAST_RUN',
        'OPENLINKER_OUTBOX_RUN_BUDGET_SECONDS',
        'OPENLINKER_OUTBOX_STALE_MINUTES',
        'OPENLINKER_OUTBOX_FAILURE_STREAK',
        'OPENLINKER_CRON_LAST_RUN_AT',
        'OPENLINKER_CRON_LAST_RUN_SOURCE',
        'OPENLINKER_IMPORT_SEND_MAIL',
        'OPENLINKER_DYNAMIC_CARRIER_ID',
        'OPENLINKER_REPLAY_GUARD_DEGRADED_AT',
    ];

    /**
     * Rows PrestaShop core treats as global.
     *
     * Core's own `Configuration::sqlRestriction` is
     * `(id_shop_group IS NULL OR id_shop_group = 0) AND (id_shop IS NULL OR
     * id_shop = 0)`, and `loadConfiguration` buckets a row as global on a
     * falsy `id_shop`. So `id_shop = 0` is global, not shop 0. Legacy dumps,
     * SQL imports and third-party writes all produce such rows, which is why
     * core defends against the zero in two places.
     *
     * Getting this wrong is destructive rather than merely ineffective: a
     * global row read as shop-scoped is UPDATEd by the promote and then
     * removed by the delete, so the signing secret ends up in no row at all
     * and webhooks stop authenticating with nothing left to recover.
     */
    const SHOP_SCOPED_PREDICATE = '(COALESCE(`id_shop`, 0) <> 0 OR COALESCE(`id_shop_group`, 0) <> 0)';

    /**
     * Pick the value to promote to global scope out of the per-shop rows.
     *
     * A non-empty value always wins over an empty one, because the broken case
     * is a shop that was never configured sitting next to the shop that was.
     * Between two non-empty values the first row wins - they should not differ,
     * and guessing between two real secrets would be worse than being
     * predictable about it. That case is logged by the caller, because a
     * merchant whose second shop genuinely held a different secret is losing
     * it and needs a trace of that.
     *
     * `null` when EVERY row is empty. An earlier revision documented that and
     * did not do it: `$fallback` was initialised `null` and then immediately
     * assigned `''` by the first empty-valued row, so the caller's
     * `if ($value !== null)` guard was dead and an empty string was written
     * globally over whatever was there - after which `HmacRequestVerifier::verify`
     * answers `misconfigured` on every inbound request (#2627 review).
     *
     * @param array $rows Rows of ['value' => string|null], in id order.
     * @return string|null null when there is nothing worth promoting.
     */
    public static function pickValueToPromote(array $rows)
    {
        foreach ($rows as $row) {
            $value = isset($row['value']) ? (string) $row['value'] : '';
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    /**
     * Move every module setting from per-shop scope to global scope.
     *
     * Promoting is not enough on its own: `Configuration::get` prefers a
     * shop-scoped row over the global one, so a leftover row would keep
     * shadowing the value we just wrote. The shop-scoped rows are therefore
     * deleted after the global one is in place.
     *
     * @return void
     */
    public static function migrateToGlobal()
    {
        $db = Db::getInstance();
        $table = _DB_PREFIX_ . 'configuration';

        foreach (self::KEYS as $key) {
            $rows = $db->executeS(
                'SELECT `value` FROM `' . bqSQL($table) . '`'
                . ' WHERE `name` = "' . pSQL($key) . '"'
                . ' AND ' . self::SHOP_SCOPED_PREDICATE
                . ' ORDER BY `id_configuration` ASC'
            );

            if (empty($rows)) {
                continue;
            }

            $value = self::pickValueToPromote($rows);
            self::logConflictingValues($key, $rows);

            // A global row that already holds a value is NOT overwritten
            // (#2627 review). The shape this protects is ordinary: a merchant
            // configured the module under one shop, later re-configured it
            // under "All shops", and now holds an OLD secret shop-scoped and
            // the CURRENT one globally. Promoting the shop-scoped row over it
            // and then deleting the source replaced the working secret with a
            // stale one and left nothing to recover it from - every inbound
            // request answering 401, with `logConflictingValues` silent because
            // there was only one distinct shop-scoped value. The shop-scoped
            // rows are still deleted below, which is the part that has to
            // happen either way: `Configuration::get` prefers them over the
            // global row, so leaving them would keep shadowing the value in use.
            $existingGlobal = self::readGlobalValue($key);
            if ($existingGlobal !== '' && $value !== null && $existingGlobal !== $value) {
                self::log(
                    'OpenLinker upgrade: keeping the existing global value for "' . $key . '"'
                    . ' and discarding a different shop-scoped one. If webhooks were working'
                    . ' before this upgrade they still are; if they were not, the shop-scoped'
                    . ' value may have been the live one.'
                );
            } elseif ($existingGlobal === '' && $value !== null) {
                Configuration::updateGlobalValue($key, $value);
            }

            $db->execute(
                'DELETE FROM `' . bqSQL($table) . '`'
                . ' WHERE `name` = "' . pSQL($key) . '"'
                . ' AND ' . self::SHOP_SCOPED_PREDICATE
            );
        }

        // The in-process cache still holds the shop-scoped values we just
        // deleted, so anything reading a setting later in this request would
        // read a row that no longer exists.
        Configuration::loadConfiguration();
    }

    /**
     * Record that shops disagreed on a setting, before the losing rows go.
     *
     * The winner is predictable, but a merchant whose second shop held a real
     * and different secret has no other way to find out it was discarded: the
     * rows are deleted and the docblock explaining the tie-break is not
     * something an operator reads. Value contents are never logged - the keys
     * include a signing secret - only how many distinct values there were.
     *
     * @param string $key
     * @param array $rows
     * @return void
     */
    private static function logConflictingValues($key, array $rows)
    {
        $distinct = [];
        foreach ($rows as $row) {
            $value = isset($row['value']) ? (string) $row['value'] : '';
            if ($value !== '') {
                $distinct[$value] = true;
            }
        }

        if (count($distinct) < 2) {
            return;
        }

        self::log(
            'OpenLinker: ' . $key . ' had ' . count($distinct) . ' different per-shop values while'
            . ' being promoted to global scope. The value from the lowest id_configuration was kept'
            . ' and the others were deleted. Re-enter this setting if the wrong shop won.'
        );
    }

    /**
     * The current global value for a key, as a string.
     *
     * Read straight off the table rather than through `Configuration::get`,
     * which prefers a shop-scoped row - the very rows this migration is about
     * to delete - and would therefore answer about the wrong scope.
     *
     * @param string $key
     * @return string '' when there is no global row, or it is empty.
     */
    private static function readGlobalValue($key)
    {
        $table = _DB_PREFIX_ . 'configuration';
        $row = Db::getInstance()->getRow(
            'SELECT `value` FROM `' . bqSQL($table) . '`'
            . ' WHERE `name` = "' . pSQL($key) . '"'
            . ' AND NOT ' . self::SHOP_SCOPED_PREDICATE
            . ' ORDER BY `id_configuration` ASC'
        );

        return (!is_array($row) || !isset($row['value'])) ? '' : (string) $row['value'];
    }

    /**
     * One place the upgrade writes its notes, at warning severity.
     *
     * @param string $message
     * @return void
     */
    private static function log($message)
    {
        PrestaShopLogger::addLog($message, 2);
    }
}
