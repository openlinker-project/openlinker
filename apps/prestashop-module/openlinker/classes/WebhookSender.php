<?php
/**
 * Webhook Sender
 *
 * Sends webhook events to OpenLinker with HMAC signature.
 * Handles HTTP communication and signature generation compatible with OpenLinker.
 *
 * Implements the OpenLinker webhook signature protocol:
 * - X-OpenLinker-Timestamp: Unix timestamp in milliseconds
 * - X-OpenLinker-Signature: HMAC-SHA256 signature of timestamp + payload
 * - Signature format: sha256=<hex_signature>
 *
 * @module prestashop-module/classes
 * @see {@link OutboxEvent} for the event model
 */

class WebhookSender
{
    // HTTP timeout constants (the cron path's defaults)
    const HTTP_TIMEOUT_SECONDS = 10;
    const HTTP_CONNECT_TIMEOUT_SECONDS = 5;

    // Response-flush fast path's shorter timeout (#2624): this send happens
    // after the buyer's connection is already closed, inside a PHP-FPM
    // worker the web server thinks is idle — a slow OpenLinker host must not
    // be able to pin that worker for the cron path's full 10s.
    const FAST_PATH_TIMEOUT_SECONDS = 3;
    const FAST_PATH_CONNECT_TIMEOUT_SECONDS = 2;

    // Error message truncation
    const ERROR_MESSAGE_MAX_LENGTH = 200;

    /** @var int */
    private $timeoutSeconds;

    /** @var int */
    private $connectTimeoutSeconds;

    /**
     * @param int|null $timeoutSeconds Override the total curl timeout (defaults to HTTP_TIMEOUT_SECONDS)
     * @param int|null $connectTimeoutSeconds Override the connect timeout (defaults to HTTP_CONNECT_TIMEOUT_SECONDS)
     */
    public function __construct($timeoutSeconds = null, $connectTimeoutSeconds = null)
    {
        $this->timeoutSeconds = $timeoutSeconds !== null ? $timeoutSeconds : self::HTTP_TIMEOUT_SECONDS;
        $this->connectTimeoutSeconds = $connectTimeoutSeconds !== null ? $connectTimeoutSeconds : self::HTTP_CONNECT_TIMEOUT_SECONDS;
    }

    /**
     * Whether this host can run the response-flush fast path (#2624).
     *
     * Both functions are required: `fastcgi_finish_request` actually flushes
     * and closes the buyer's connection while PHP keeps running under
     * PHP-FPM (a no-op / unavailable everywhere else — CLI, mod_php); without
     * it there is nothing to flush and the "fast path" would just be normal
     * synchronous work stacked onto the buyer's request. `ignore_user_abort`
     * keeps the script running once the client is gone. No Polish host
     * publishes its disabled-function list, so this probes rather than
     * assumes — mirroring `OutboxRepository::hasDedupKeyColumn()`'s
     * probe-and-degrade shape: never throws, just answers false.
     *
     * Both capability flags are optional, injectable params (mirroring
     * `OutboxRepository::shouldRunRetention()`'s `$now`/`$lastRunAt`) so this
     * can be unit-tested for both hosts without depending on which SAPI ran
     * the test — `null` (the production call shape) probes the real
     * functions.
     *
     * @param bool|null $fastcgiFinishRequestExists
     * @param bool|null $ignoreUserAbortExists
     * @return bool
     */
    public static function fastPathAvailable($fastcgiFinishRequestExists = null, $ignoreUserAbortExists = null)
    {
        if ($fastcgiFinishRequestExists === null) {
            $fastcgiFinishRequestExists = function_exists('fastcgi_finish_request');
        }
        if ($ignoreUserAbortExists === null) {
            $ignoreUserAbortExists = function_exists('ignore_user_abort');
        }

        return $fastcgiFinishRequestExists && $ignoreUserAbortExists;
    }

    /**
     * Send webhook event to OpenLinker
     *
     * Builds payload, generates HMAC signature, and sends HTTP POST.
     * Returns true on success (2xx response), false on failure.
     *
     * @param OutboxEvent $event Event to send
     * @return bool Success
     * @throws Exception On HTTP error or configuration error
     */
    public function sendEvent($event)
    {
        // Get configuration
        $baseUrl = Configuration::get('OPENLINKER_BASE_URL');
        $connectionId = Configuration::get('OPENLINKER_CONNECTION_ID');
        $webhookSecret = Configuration::get('OPENLINKER_WEBHOOK_SECRET');

        if (empty($baseUrl) || empty($connectionId) || empty($webhookSecret)) {
            throw new Exception('OpenLinker configuration is incomplete. Please configure Base URL, Connection ID, and Webhook Secret.');
        }

        // Build webhook URL
        $webhookUrl = rtrim($baseUrl, '/') . '/webhooks/prestashop/' . $connectionId;

        // Build payload
        $payload = [
            'schemaVersion' => $event->schema_version,
            'eventId' => $event->event_id,
            'eventType' => $event->event_type,
            'occurredAt' => date('c', strtotime($event->occurred_at)), // ISO 8601 format
            'object' => [
                'type' => $event->object_type,
                'externalId' => $event->external_id,
            ],
        ];

        // Add payload if available
        if (!empty($event->payload_json)) {
            $payloadData = json_decode($event->payload_json, true);
            if ($payloadData !== null) {
                $payload['payload'] = $payloadData;
            }
        }

        // Generate timestamp (unix milliseconds as string)
        $timestamp = (string)((int)(microtime(true) * 1000));

        // Generate signature
        $rawBody = json_encode($payload);
        $signedPayload = $timestamp . '.' . $rawBody;
        $signatureHex = hash_hmac('sha256', $signedPayload, $webhookSecret); // Returns hex string directly
        $signatureHeader = 'sha256=' . $signatureHex;

        // Prepare headers
        $headers = [
            'Content-Type: application/json',
            'X-OpenLinker-Timestamp: ' . $timestamp,
            'X-OpenLinker-Signature: ' . $signatureHeader,
        ];

        // Send HTTP POST using curl
        $ch = curl_init($webhookUrl);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeoutSeconds);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $this->connectTimeoutSeconds);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        // Check for curl errors
        if ($response === false || !empty($curlError)) {
            throw new Exception('HTTP request failed: ' . ($curlError ?: 'Unknown error'));
        }

        // Check HTTP status code (2xx = success)
        if ($httpCode >= 200 && $httpCode < 300) {
            return true;
        }

        // Non-2xx response = failure
        $errorMessage = 'HTTP ' . $httpCode;
        if (!empty($response)) {
            // Truncate response body for error message (no secrets)
            $responseSnippet = mb_substr($response, 0, self::ERROR_MESSAGE_MAX_LENGTH, 'UTF-8');
            $errorMessage .= ': ' . $responseSnippet;
        }

        throw new Exception($errorMessage);
    }

    /**
     * Get error message from exception (sanitized, no secrets)
     *
     * @param Exception|Throwable $e Exception
     * @return string Sanitized error message
     */
    public static function getErrorMessage($e)
    {
        $message = $e->getMessage();
        
        // Remove any potential secrets from error message
        $message = preg_replace('/secret[=:]\s*[^\s,]+/i', 'secret=***', $message);
        $message = preg_replace('/token[=:]\s*[^\s,]+/i', 'token=***', $message);
        $message = preg_replace('/key[=:]\s*[^\s,]+/i', 'key=***', $message);
        
        return $message;
    }
}
