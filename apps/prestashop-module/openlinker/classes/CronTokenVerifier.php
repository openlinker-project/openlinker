<?php
/**
 * Cron Token Verifier
 *
 * Authenticates a call to the delivery endpoint (#2619).
 *
 * The token used to be read from the query string and compared with `!==`. A
 * query string is written to the web server's access log, kept in browser
 * history and forwarded in a Referer header, so the credential leaked to places
 * nobody audits, and a plain comparison leaks its prefix through timing.
 *
 * The token is now read from a request header or a POST field, and compared
 * with `hash_equals`. A token still arriving in the query string is refused
 * with a message naming the fix, rather than being quietly accepted.
 *
 * Pure by design so both rules are testable without a PrestaShop runtime.
 *
 * @module prestashop-module/classes
 */

class CronTokenVerifier
{
    /** Header the shipped cron entry file sends the token in. */
    const HEADER = 'HTTP_X_OPENLINKER_CRON_TOKEN';

    /**
     * Read the presented token out of a request.
     *
     * The query string is deliberately not a source.
     *
     * @param array $server $_SERVER
     * @param array $post   $_POST
     * @return string Empty when no token was presented.
     */
    public static function presentedToken(array $server, array $post)
    {
        if (isset($server[self::HEADER]) && is_string($server[self::HEADER])) {
            return trim($server[self::HEADER]);
        }

        if (isset($post['token']) && is_string($post['token'])) {
            return trim($post['token']);
        }

        return '';
    }

    /**
     * Whether the request carries a token in the query string.
     *
     * Used only to explain the refusal: an operator upgrading from the old
     * install instructions has a working-looking cron that now returns 403, and
     * needs to be told why.
     *
     * @param array $get $_GET
     * @return bool
     */
    public static function hasQueryStringToken(array $get)
    {
        return isset($get['token']) && $get['token'] !== '';
    }

    /**
     * Compare a presented token with the configured one.
     *
     * An unconfigured token never matches, so a shop that has not set one is
     * not wide open.
     *
     * @param string $presented
     * @param string $expected
     * @return bool
     */
    public static function matches($presented, $expected)
    {
        $presented = (string) $presented;
        $expected = (string) $expected;

        if ($presented === '' || $expected === '') {
            return false;
        }

        return hash_equals($expected, $presented);
    }
}
