<?php
/**
 * HMAC Request Verifier
 *
 * Receiver-side HMAC verification for inbound POSTs from the OpenLinker backend.
 * Mirrors the TypeScript WebhookAuthService contract bit-for-bit so the OL
 * backend's existing outbound signer (apps/api/src/webhooks/.../webhook-auth)
 * works without any contract change.
 *
 * Contract:
 *   - Header X-OpenLinker-Timestamp:  unix milliseconds, numeric string
 *   - Header X-OpenLinker-Signature:  "sha256=<64-char hex>"
 *   - Signed payload:                 timestamp + "." + rawBody
 *   - HMAC algorithm:                 SHA-256
 *   - Constant-time comparison:       hash_equals
 *   - Skew window:                    +/- 5 minutes
 *
 * @module prestashop-module/classes
 * @see {@link WebhookSender} for the outbound counterpart in this module
 * @see apps/api/src/webhooks/application/services/webhook-auth.service.ts (TS receiver)
 */

class HmacRequestVerifier
{
    // 5 minutes — matches WebhookAuthService.DEFAULT_SKEW_WINDOW_MS in the TS receiver.
    const SKEW_WINDOW_MS = 300000;

    /**
     * Verify an inbound HMAC-signed request.
     *
     * @param string      $rawBody          Raw request body (read via php://input before any parsing)
     * @param string|null $timestampHeader  Value of X-OpenLinker-Timestamp header (unix ms as string)
     * @param string|null $signatureHeader  Value of X-OpenLinker-Signature header ("sha256=<hex>")
     * @param string      $secret           Shared secret (Configuration::get('OPENLINKER_WEBHOOK_SECRET'))
     * @return bool                         true on success
     * @throws Exception                    with one of the documented reason strings
     */
    public static function verify($rawBody, $timestampHeader, $signatureHeader, $secret)
    {
        if ($timestampHeader === null || $signatureHeader === null) {
            throw new Exception('missing-headers');
        }
        if (empty($secret)) {
            // Misconfigured server: OPENLINKER_WEBHOOK_SECRET not set in module config.
            throw new Exception('misconfigured');
        }
        if (strpos($signatureHeader, 'sha256=') !== 0) {
            throw new Exception('bad-signature-format');
        }

        $providedHex = substr($signatureHeader, 7);
        if (!preg_match('/^[0-9a-f]{64}$/i', $providedHex)) {
            throw new Exception('bad-signature-format');
        }

        $ts = (int) $timestampHeader;
        if ($ts <= 0) {
            throw new Exception('timestamp-out-of-window');
        }
        $nowMs = (int) (microtime(true) * 1000);
        if (abs($nowMs - $ts) > self::SKEW_WINDOW_MS) {
            throw new Exception('timestamp-out-of-window');
        }

        $signedPayload = $timestampHeader . '.' . $rawBody;
        $expectedHex = hash_hmac('sha256', $signedPayload, $secret);

        // Constant-time comparison — protects against timing-based signature forgery.
        if (!hash_equals($expectedHex, $providedHex)) {
            throw new Exception('invalid-signature');
        }

        return true;
    }
}
