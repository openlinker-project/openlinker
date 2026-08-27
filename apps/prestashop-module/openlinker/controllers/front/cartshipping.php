<?php
/**
 * Cart Shipping Front Controller
 *
 * HMAC-authed POST endpoint that the OpenLinker backend calls to write per-cart
 * shipping costs into the sidecar table. The OL Dynamic carrier reads from the
 * sidecar at order-create time via OpenLinker::getOrderShippingCostExternal().
 *
 * URL: .../index.php?fc=module&module=openlinker&controller=cartshipping
 *
 * Headers:
 *   X-OpenLinker-Timestamp:  unix milliseconds, numeric string
 *   X-OpenLinker-Signature:  "sha256=<64-char hex>" — HMAC-SHA256 of
 *                            timestamp + "." + rawBody, signed with
 *                            OPENLINKER_WEBHOOK_SECRET (constant-time verified)
 *
 * Body (JSON):
 *   { id_cart: int, amount_tax_excl: number, amount_tax_incl: number, source?: string }
 *
 * Responses:
 *   200 {ok: true,  id_cart: <int>}
 *   400 {ok: false, error: 'invalid-body' | 'invalid-fields'}
 *   401 {ok: false, error: 'missing-headers' | 'bad-signature-format'
 *                      | 'timestamp-out-of-window' | 'invalid-signature'
 *                      | 'misconfigured'}
 *   405 {ok: false, error: 'method-not-allowed'}
 *   500 {ok: false, error: 'persist-failed'}
 *   502 {ok: false, error: 'cart-shipping-aborted'} - the shop ended the
 *       request without a response (a PHP fatal during the write)
 *
 * Idempotent: the same payload sent twice rewrites the same row (the only
 * change between calls is updated_at).
 *
 * @module prestashop-module/controllers
 * @see {@link HmacRequestVerifier} for signature verification
 * @see {@link CartShippingRepository} for sidecar I/O
 *
 * @author OpenLinker Team
 * @version 1.0.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class OpenLinkerCartShippingModuleFrontController extends ModuleFrontController
{
    /** @var bool Skip the PS theme/Smarty pipeline — JSON only. */
    public $ajax = true;

    /** @var bool True once a JSON response was emitted. */
    private $responded = false;

    /** @var bool True while the sidecar-write output buffer is open. */
    private $bufferOpen = false;

    public function postProcess()
    {
        // 1. Method check — only POST is meaningful.
        if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->jsonError(405, 'method-not-allowed');
            return;
        }

        // 2. Load helpers (PS does not autoload module classes).
        require_once $this->module->getLocalPath() . 'classes/HmacRequestVerifier.php';
        require_once $this->module->getLocalPath() . 'classes/CartShippingRepository.php';
        require_once $this->module->getLocalPath() . 'classes/ReplayGuard.php';

        // 3. HMAC verify against the raw body — must read php://input before
        //    any decode pass so the signed bytes match exactly.
        $rawBody         = (string) @file_get_contents('php://input');
        $timestampHeader = $this->headerValue('HTTP_X_OPENLINKER_TIMESTAMP');
        $signatureHeader = $this->headerValue('HTTP_X_OPENLINKER_SIGNATURE');
        $secret          = (string) Configuration::get('OPENLINKER_WEBHOOK_SECRET');

        try {
            HmacRequestVerifier::verify($rawBody, $timestampHeader, $signatureHeader, $secret);
        } catch (Exception $e) {
            // Reason string from the verifier is part of the documented contract.
            $this->jsonError(401, $e->getMessage());
            return;
        }

        // 3b. A captured request must not be usable twice. Claimed after
        //     verification so an unsigned caller cannot fill the table (#2619).
        //     Scoped to this endpoint, so the same key on importorder is a
        //     separate row.
        if (!ReplayGuard::claim('cartshipping', $signatureHeader)) {
            $this->jsonError(409, 'replayed-request');
            return;
        }

        // 4. Validate body shape and required fields.
        $data = json_decode($rawBody, true);
        if (
            !is_array($data)
            || !isset($data['id_cart'])
            || !array_key_exists('amount_tax_excl', $data)
            || !array_key_exists('amount_tax_incl', $data)
        ) {
            $this->jsonError(400, 'invalid-body');
            return;
        }

        $idCart        = (int) $data['id_cart'];
        $amountTaxExcl = $data['amount_tax_excl'];
        $amountTaxIncl = $data['amount_tax_incl'];
        $source        = isset($data['source']) ? (string) $data['source'] : null;

        if ($idCart <= 0 || !is_numeric($amountTaxExcl) || !is_numeric($amountTaxIncl)) {
            $this->jsonError(400, 'invalid-fields');
            return;
        }

        // 5. Upsert the sidecar row. Repository handles numeric casts + pSQL.
        //
        // Buffered, and guarded, for the same reason `importorder` is (#2601
        // review): a PHP notice or a fatal during the write would otherwise
        // print in front of the JSON envelope, and the backend - which now
        // requires the envelope - would abort the order create over a sidecar
        // row that had in fact been written. A silent exit leaves an explicit
        // 502 naming the cause instead of the shop's HTML error page at 200.
        register_shutdown_function([$this, 'guardAgainstSilentExit'], $idCart);
        ob_start();
        $this->bufferOpen = true;

        $repo = new CartShippingRepository();
        $ok = $repo->upsert($idCart, (float) $amountTaxExcl, (float) $amountTaxIncl, $source);
        if (!$ok) {
            PrestaShopLogger::addLog(
                'OpenLinker: cart-shipping upsert failed for id_cart=' . $idCart,
                3, null, 'Cart', $idCart
            );
            $this->jsonError(500, 'persist-failed');
            return;
        }

        $this->jsonOk(['ok' => true, 'id_cart' => $idCart]);
    }

    /**
     * Drop whatever the output buffer holds, if one is open.
     *
     * @return void
     */
    private function discardStrayOutput()
    {
        if ($this->bufferOpen) {
            $this->bufferOpen = false;
            ob_end_clean();
        }
    }

    /**
     * Shutdown guard for the sidecar write.
     *
     * Runs on every request end once registered. No response emitted means the
     * request died inside PrestaShop, so an explicit 502 replaces whatever was
     * buffered - a failure must never leave here as an HTML 200. Public because
     * PHP calls it as a shutdown callback.
     *
     * @param int $idCart
     * @return void
     */
    public function guardAgainstSilentExit($idCart)
    {
        if ($this->responded) {
            return;
        }

        $strayLength = $this->bufferOpen ? (int) ob_get_length() : 0;
        $this->discardStrayOutput();

        if (headers_sent()) {
            return;
        }

        PrestaShopLogger::addLog(
            'OpenLinker: cart-shipping write ended without a response for id_cart=' . $idCart
                . ' (' . $strayLength . ' bytes of unexpected output discarded)',
            3, null, 'Cart', $idCart
        );

        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode([
            'ok' => false,
            'error' => 'cart-shipping-aborted',
            'detail' => 'the shop ended the request without a response',
        ]);
    }

    /**
     * Read a header value from $_SERVER, returning null if absent.
     *
     * @param string $serverKey  e.g. 'HTTP_X_OPENLINKER_TIMESTAMP'
     * @return string|null
     */
    private function headerValue($serverKey)
    {
        return isset($_SERVER[$serverKey]) ? (string) $_SERVER[$serverKey] : null;
    }

    /**
     * Defense-in-depth: postProcess() exits on every code path, so this
     * should never be reached. Override anyway as a hedge against future
     * edits to postProcess() that might let a path fall through — without
     * this override PS would invoke Smarty rendering against a missing
     * template.
     *
     * @return void
     */
    public function displayAjax()
    {
        // No-op. JSON responses are emitted from postProcess() via exit().
    }

    /**
     * Emit a 200 JSON response and terminate.
     *
     * @param array $body
     * @return void
     */
    private function jsonOk(array $body)
    {
        // Discarded before anything is echoed: whatever the buffer holds is by
        // definition output we did not mean to send, and flushing it would put
        // that in front of the envelope.
        $this->discardStrayOutput();
        $this->responded = true;
        http_response_code(200);
        header('Content-Type: application/json');
        echo json_encode($body);
        exit;
    }

    /**
     * Emit an error JSON response with the given status and reason, and
     * terminate. The reason string is part of the documented endpoint
     * contract — the OL backend reads it programmatically.
     *
     * @param int    $status
     * @param string $reason
     * @return void
     */
    private function jsonError($status, $reason)
    {
        $this->discardStrayOutput();
        $this->responded = true;
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'error' => $reason]);
        exit;
    }
}
