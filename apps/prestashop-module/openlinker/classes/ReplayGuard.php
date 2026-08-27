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
 * Uniqueness is claimed with one INSERT whose duplicate arm changes nothing, so
 * two concurrent copies of the same request cannot both pass. A select followed
 * by an insert would let them.
 *
 * @module prestashop-module/classes
 * @see {@link HmacRequestVerifier} for the signature this keys on
 */

class ReplayGuard
{
    /** Table holding one row per accepted request, pruned by age. */
    const TABLE = 'openlinker_request_nonce';

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

        // The duplicate arm rewrites the row with its own value, so MySQL
        // reports zero affected rows and that is what identifies the replay.
        $sql = 'INSERT INTO `' . _DB_PREFIX_ . self::TABLE . '` (`nonce`, `created_at`)'
            . " VALUES ('" . pSQL($key) . "', NOW())"
            . ' ON DUPLICATE KEY UPDATE `nonce` = `nonce`';

        if ($db->execute($sql) === false) {
            // The guard cannot answer, and refusing a real order because a
            // housekeeping table is unreachable would be worse than the replay
            // window it protects. Recorded so the failure is not silent.
            PrestaShopLogger::addLog(
                'OpenLinker: replay guard could not record a request: ' . $db->getMsgError(),
                2,
                null,
                'Module',
                null
            );

            return true;
        }

        if ((int) $db->Affected_Rows() === 0) {
            return false;
        }

        self::prune();

        return true;
    }

    /**
     * Delete keys older than the retention window.
     *
     * Runs on the accepted path only, which is the path that added a row.
     *
     * @return void
     */
    private static function prune()
    {
        Db::getInstance()->execute(
            'DELETE FROM `' . _DB_PREFIX_ . self::TABLE . '`'
            . ' WHERE `created_at` < DATE_SUB(NOW(), INTERVAL '
            . (int) self::RETENTION_SECONDS . ' SECOND)'
        );
    }
}
