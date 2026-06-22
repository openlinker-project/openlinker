<?php
/**
 * OpenLinker Ping Front Controller
 *
 * HMAC-authenticated front controller (#168) that synchronously fires a
 * `test_ping` webhook back to OpenLinker. Triggered by OL after the install
 * flow finishes pushing the module's configuration via PS WS, so the operator
 * sees the round-trip succeed within a couple of seconds.
 *
 * Contract:
 *   - URL:           POST /module/openlinker/ping
 *   - Auth:          HMAC-SHA256 over `timestamp + "." + rawBody`, signed with
 *                    the just-written `OPENLINKER_WEBHOOK_SECRET`.
 *   - Headers:       X-OpenLinker-Timestamp, X-OpenLinker-Signature
 *   - Body:          `{ "event": "test_ping", "connectionId": "<uuid>" }`
 *   - Success:       200 with `{ ok: true }` after the synchronous webhook
 *                    delivery returns 2xx.
 *   - Auth failure:  401 with `{ error: "<reason>" }`.
 *   - Send failure:  502 with `{ error: "<sanitized message>" }`.
 *
 * The endpoint deliberately bypasses the outbox (skips the cron tick latency)
 * because the install UX expects sub-2-second confirmation. Real PS-hook
 * events still flow through the outbox via WebhookSender.
 *
 * @module prestashop-module/controllers/front
 * @see {@link HmacRequestVerifier} for the inbound auth contract
 * @see {@link WebhookSender} for the outbound webhook delivery used here
 */

class OpenLinkerPingModuleFrontController extends ModuleFrontController
{
    /** Front controllers default to requiring auth; override to false because we use HMAC. */
    public $auth = false;

    /** Skip the standard PS template rendering — this is a JSON-only endpoint. */
    public $display_header = false;
    public $display_footer = false;
    public $ssl = true;

    public function postProcess()
    {
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/HmacRequestVerifier.php';
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/WebhookSender.php';
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/OutboxEvent.php';
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/EventIdGenerator.php';

        // Read raw body BEFORE any framework parsing happens.
        $rawBody = Tools::file_get_contents('php://input');
        if ($rawBody === false) {
            $rawBody = '';
        }

        $secret = (string) Configuration::get('OPENLINKER_WEBHOOK_SECRET');
        $timestampHeader = isset($_SERVER['HTTP_X_OPENLINKER_TIMESTAMP'])
            ? $_SERVER['HTTP_X_OPENLINKER_TIMESTAMP']
            : null;
        $signatureHeader = isset($_SERVER['HTTP_X_OPENLINKER_SIGNATURE'])
            ? $_SERVER['HTTP_X_OPENLINKER_SIGNATURE']
            : null;

        try {
            HmacRequestVerifier::verify($rawBody, $timestampHeader, $signatureHeader, $secret);
        } catch (Exception $e) {
            $this->respond(401, ['error' => $e->getMessage()]);
            return;
        }

        // Build a synthetic test_ping event. Fields mirror what an actionProductSave
        // event looks like so the OL intake's normal validation passes.
        $connectionId = (string) Configuration::get('OPENLINKER_CONNECTION_ID');
        $occurredAt = date('Y-m-d H:i:s');

        $event = new OutboxEvent();
        $event->event_id = EventIdGenerator::generateEventId(
            'prestashop',
            $connectionId,
            'test.ping',
            'connection',
            $connectionId,
            $occurredAt
        );
        $event->schema_version = 1;
        $event->provider = 'prestashop';
        $event->connection_id = $connectionId;
        // `test.` prefix is recognized by OL's webhook intake (`WebhookToJobHandler`)
        // as a verification event — skips job enqueue while still recording the
        // delivery, so the FE can show "last test ping at <ts>".
        $event->event_type = 'test.ping';
        $event->object_type = 'connection';
        $event->external_id = $connectionId;
        $event->occurred_at = $occurredAt;
        $event->payload_json = json_encode(['source' => 'install-verification']);

        try {
            (new WebhookSender())->sendEvent($event);
            $this->respond(200, ['ok' => true]);
        } catch (Exception $e) {
            $this->respond(502, ['error' => WebhookSender::getErrorMessage($e)]);
        }
    }

    /**
     * Emit a JSON response and terminate.
     *
     * @param int   $status HTTP status code
     * @param array $body   Response body (will be JSON-encoded)
     * @return void
     */
    private function respond($status, array $body)
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($body);
        exit;
    }
}
