<?php
/**
 * Replay Guard
 *
 * Rejects a byte-identical resend of a signed request (#2619).
 *
 * The HMAC signature is a deterministic function of the timestamp, the body and
 * the shared secret, so two requests carry the same signature only if they are
 * byte-identical. That makes the signature itself the replay key, and no new
 * field has to be added to the wire contract - an attacker cannot vary it
 * without invalidating the signature, which a separate nonce header would allow.
 *
 * A genuine retry from the OpenLinker backend re-signs with a fresh timestamp,
 * so it gets a fresh key and is never mistaken for a replay.
 *
 * Uniqueness is claimed with one INSERT IGNORE, so two concurrent copies of the
 * same request cannot both pass. A select followed by an insert would let them.
 * INSERT IGNORE is used rather than ON DUPLICATE KEY UPDATE because the latter
 * reports one affected row on a duplicate when the client connects with
 * CLIENT_FOUND_ROWS, and the guard would then accept every replay silently.
 *
 * @module prestashop-module/classes
 * @see {@link HmacRequestVerifier} for the signature this keys on
 */

class ReplayGuard
{
    /** Table holding one row per accepted request, pruned by age. */
    const TABLE = 'openlinker_request_nonce';

    /**
     * Configuration key stamped when the guard could not answer.
     *
     * Read by the module configuration page. Without it the only trace of a
     * shop running with no replay protection is a log line nobody opens.
     */
    const DEGRADED_CONFIG_KEY = 'OPENLINKER_REPLAY_GUARD_DEGRADED_AT';

    /** One prune per this many accepted requests, to keep the money path short. */
    const PRUNE_EVERY = 20;

    /**
     * How long a key is remembered.
     *
     * One skew window is enough: past it the timestamp check rejects the
     * request before the guard is ever consulted, so a longer memory would only
     * hold rows that can no longer be used.
     */
    const RETENTION_SECONDS = 600;

    /**
     * Derive the stored key for a request.
     *
     * The signature is hashed rather than stored, so a database dump does not
     * hand out authentication material.
     *
     * @param string $scope           Endpoint name, so two endpoints cannot collide.
     * @param string $signatureHeader Raw X-OpenLinker-Signature value.
     * @return string 64 hex characters.
     */
    public static function keyFor($scope, $signatureHeader)
    {
        return hash('sha256', $scope . '.' . (string) $signatureHeader);
    }

    /**
     * Claim a request as first-seen.
     *
     * @param string $scope
     * @param string $signatureHeader
     * @return bool true when this request has not been seen, false on a replay.
     */
    public static function claim($scope, $signatureHeader)
    {
        $db = Db::getInstance();
        $key = self::keyFor($scope, $signatureHeader);

        // A duplicate is ignored and reports zero affected rows whatever the
        // client's CLIENT_FOUND_ROWS setting, so the guard does not depend on a
        // connection flag nothing here controls.
        $sql = 'INSERT IGNORE INTO `' . _DB_PREFIX_ . self::TABLE . '` (`nonce`, `created_at`)'
            . " VALUES ('" . pSQL($key) . "', NOW())";

        try {
            $written = $db->execute($sql);
        } catch (Throwable $e) {
            // With _PS_DEBUG_SQL_ on, Db::execute throws instead of returning
            // false. Without this catch the guard would fail closed on exactly
            // the shops most likely to be debugging.
            $written = false;
        }

        if ($written === false) {
            // The guard cannot answer, and refusing a real order because a
            // housekeeping table is unreachable would be worse than the replay
            // window it protects.
            self::recordDegraded($db);

            return true;
        }

        if ((int) $db->Affected_Rows() === 0) {
            return false;
        }

        self::clearDegraded();

        if (mt_rand(1, self::PRUNE_EVERY) === 1) {
            self::prune();
        }

        return true;
    }

    /**
     * Record that the guard is not protecting this shop.
     *
     * Both a log line and a configuration stamp: the log is for whoever reads
     * logs, the stamp is what the configuration page can show to everyone else.
     *
     * @param Db $db
     * @return void
     */
    private static function recordDegraded($db)
    {
        PrestaShopLogger::addLog(
            'OpenLinker: replay guard could not record a request: ' . $db->getMsgError(),
            2,
            null,
            'Module',
            null
        );

        try {
            Configuration::updateGlobalValue(self::DEGRADED_CONFIG_KEY, date('Y-m-d H:i:s'));
        } catch (Throwable $e) {
            // The request itself must survive a failed bookkeeping write.
        }
    }

    /**
     * Forget an earlier degraded state once the guard works again.
     *
     * Only written when something is there to clear, so a healthy shop pays no
     * extra write per order.
     *
     * @return void
     */
    private static function clearDegraded()
    {
        try {
            if ((string) Configuration::get(self::DEGRADED_CONFIG_KEY) !== '') {
                Configuration::updateGlobalValue(self::DEGRADED_CONFIG_KEY, '');
            }
        } catch (Throwable $e) {
            // Same reason as above.
        }
    }

    /**
     * Delete keys older than the retention window.
     *
     * Runs on a fraction of accepted requests. Order import is the money path,
     * so a ranged DELETE on every single one buys nothing: retention is an
     * age bound, not a row count.
     *
     * Public so the retention rule can be exercised without depending on the
     * sampling above firing.
     *
     * @return void
     */
    public static function prune()
    {
        Db::getInstance()->execute(
            'DELETE FROM `' . _DB_PREFIX_ . self::TABLE . '`'
            . ' WHERE `created_at` < DATE_SUB(NOW(), INTERVAL '
            . (int) self::RETENTION_SECONDS . ' SECOND)'
        );
    }
}
