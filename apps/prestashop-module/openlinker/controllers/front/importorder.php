<?php
/**
 * Import Order Front Controller
 *
 * HMAC-authed POST endpoint the OpenLinker backend calls to create a PrestaShop
 * order through PrestaShop's canonical `PaymentModule::validateOrder` flow —
 * instead of the raw webservice `POST /api/orders` insert, which bypasses
 * validateOrder and so loses the carrier, recomputes shipping, and mis-sets the
 * payment state (see ADR-016 / #905, root of #503/#467/#513/#898).
 *
 * The OL backend builds the cart over the webservice first (customer, addresses,
 * products, cart-scoped specific_prices for line pricing #895, the cart-shipping
 * sidecar #516, and the cart `delivery_option` locking the resolved carrier),
 * then calls this endpoint. validateOrder reads the cart's delivery_option to
 * assign the carrier, prices module carriers via getOrderShippingCostExternal,
 * computes totals, and creates order/order_detail/order_carrier/state/stock the
 * way PrestaShop intends — correct by construction, no post-create patching.
 *
 * The OL module extends CarrierModule (not PaymentModule), so it cannot call
 * validateOrder on itself; it delegates to the `ps_checkpayment` payment module
 * — already the payment module OL records on its orders — keeping payment
 * provenance unchanged.
 *
 * URL: .../index.php?fc=module&module=openlinker&controller=importorder
 *
 * Headers:
 *   X-OpenLinker-Timestamp:  unix milliseconds, numeric string
 *   X-OpenLinker-Signature:  "sha256=<64-char hex>" — HMAC-SHA256 of
 *                            timestamp + "." + rawBody, signed with
 *                            OPENLINKER_WEBHOOK_SECRET (constant-time verified)
 *
 * Body (JSON):
 *   { id_cart: int, id_order_state: int, amount_paid: number,
 *     payment_method?: string, order_reference?: string }
 *
 * Responses:
 *   200 {ok: true, id_order: <int>, reference: <string>, already_existed: <bool>}
 *   400 {ok: false, error: 'invalid-body' | 'invalid-fields' | 'cart-not-found' | 'cart-empty'}
 *   401 {ok: false, error: <HmacRequestVerifier reason>}
 *   405 {ok: false, error: 'method-not-allowed'}
 *   422 {ok: false, error: 'payment-module-unavailable' | 'payment-module-inactive'}
 *   502 {ok: false, error: 'validate-order-failed' | 'validate-order-aborted', detail: <string>}
 *
 * Idempotent: if an order already exists for `id_cart`, the existing order is
 * returned (`already_existed: true`) rather than validated a second time — so a
 * backend retry after a partial failure is safe.
 *
 * @module prestashop-module/controllers
 * @see {@link HmacRequestVerifier} for signature verification
 * @author OpenLinker Team
 * @version 1.2.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class OpenLinkerImportOrderModuleFrontController extends ModuleFrontController
{
    /** @var bool Skip the PS theme/Smarty pipeline — JSON only. */
    public $ajax = true;

    /** @var string Payment module OL delegates validateOrder to. */
    const PAYMENT_MODULE = 'ps_checkpayment';

    /** @var bool True once a JSON response has been emitted. */
    private $responded = false;

    /** @var bool True while the validateOrder output buffer is open. */
    private $bufferOpen = false;

    public function postProcess()
    {
        if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->jsonError(405, 'method-not-allowed');
            return;
        }

        require_once $this->module->getLocalPath() . 'classes/HmacRequestVerifier.php';
        require_once $this->module->getLocalPath() . 'classes/PaymentModuleGate.php';

        $rawBody         = (string) @file_get_contents('php://input');
        $timestampHeader = $this->headerValue('HTTP_X_OPENLINKER_TIMESTAMP');
        $signatureHeader = $this->headerValue('HTTP_X_OPENLINKER_SIGNATURE');
        $secret          = (string) Configuration::get('OPENLINKER_WEBHOOK_SECRET');

        try {
            HmacRequestVerifier::verify($rawBody, $timestampHeader, $signatureHeader, $secret);
        } catch (Exception $e) {
            $this->jsonError(401, $e->getMessage());
            return;
        }

        $data = json_decode($rawBody, true);
        if (
            !is_array($data)
            || !isset($data['id_cart'])
            || !isset($data['id_order_state'])
            || !array_key_exists('amount_paid', $data)
        ) {
            $this->jsonError(400, 'invalid-body');
            return;
        }

        $idCart        = (int) $data['id_cart'];
        $idOrderState  = (int) $data['id_order_state'];
        $amountPaid    = $data['amount_paid'];
        $paymentMethod = isset($data['payment_method']) ? (string) $data['payment_method'] : 'OpenLinker';
        $orderReference = isset($data['order_reference']) ? (string) $data['order_reference'] : null;

        if ($idCart <= 0 || $idOrderState <= 0 || !is_numeric($amountPaid)) {
            $this->jsonError(400, 'invalid-fields');
            return;
        }

        $cart = new Cart($idCart);
        if (!Validate::isLoadedObject($cart)) {
            $this->jsonError(400, 'cart-not-found');
            return;
        }
        if (!count($cart->getProducts())) {
            $this->jsonError(400, 'cart-empty');
            return;
        }

        // Idempotency: a retry after a partial failure must not double-create.
        $existingOrderId = (int) Order::getIdByCartId($idCart);
        if ($existingOrderId > 0) {
            $existing = new Order($existingOrderId);
            $this->jsonOk([
                'ok' => true,
                'id_order' => $existingOrderId,
                'reference' => $existing->reference,
                'already_existed' => true,
            ]);
            return;
        }

        // Reject an unknown target order-state up front (it flows straight into
        // validateOrder, which would otherwise create the order then fail).
        if (!Validate::isLoadedObject(new OrderState($idOrderState))) {
            $this->jsonError(400, 'invalid-order-state');
            return;
        }

        // Lock the carrier server-side. PS 9 `Cart::getDeliveryOption` parses
        // `delivery_option` with json_decode; `setDeliveryOption` writes the
        // correct JSON shape so OL never hand-formats it. The carrier + address
        // come from the cart the adapter already built — without this,
        // validateOrder auto-selects the cheapest (free) carrier (#905).
        $idAddressDelivery = (int) $cart->id_address_delivery;
        $idCarrier = (int) $cart->id_carrier;
        if ($idAddressDelivery <= 0 || $idCarrier <= 0) {
            $this->jsonError(400, 'cart-missing-carrier-or-address');
            return;
        }
        $cart->setDeliveryOption([$idAddressDelivery => $idCarrier . ',']);
        $cart->update();

        // Align the request context with the cart so validateOrder resolves the
        // right shop / customer / currency / carrier (from delivery_option) and
        // prices the OL Dynamic carrier via the sidecar.
        $this->context->cart = $cart;
        $this->context->customer = new Customer((int) $cart->id_customer);
        $this->context->currency = new Currency((int) $cart->id_currency);
        $this->context->language = new Language((int) $cart->id_lang);

        $payment = Module::getInstanceByName(self::PAYMENT_MODULE);
        $paymentProblem = PaymentModuleGate::reasonUnusable($payment);
        if ($paymentProblem !== null) {
            PrestaShopLogger::addLog(
                'OpenLinker: payment module "' . self::PAYMENT_MODULE . '" not usable for order import ('
                    . $paymentProblem . ', id_cart=' . $idCart . ')',
                3, null, 'Cart', $idCart
            );
            $this->jsonError(422, $paymentProblem);
            return;
        }

        // Suppress the buyer order-confirmation/state emails validateOrder would
        // otherwise fire — the marketplace already notified the buyer. Opt back
        // in per-shop via OPENLINKER_IMPORT_SEND_MAIL=1 (#905). The flag is
        // consumed by OpenLinker::hookActionEmailSendBefore for this request.
        OpenLinker::$suppressImportMail =
            (string) Configuration::get(OpenLinker::IMPORT_SEND_MAIL_CONFIG_KEY) !== '1';

        // validateOrder and the code it calls can end the request with die(),
        // which PHP sends as HTML with status 200 - a failure the caller reads
        // as a success (#2601). Buffer the output so no such body escapes, and
        // register a guard that turns a silent exit into an explicit 502.
        ob_start();
        $this->bufferOpen = true;
        register_shutdown_function([$this, 'guardAgainstSilentExit'], $idCart);

        try {
            $payment->validateOrder(
                $idCart,
                $idOrderState,
                (float) $amountPaid,
                $paymentMethod,
                null,
                [],
                null,
                true, // $dont_touch_amount — OL's amount_paid is authoritative; no PS re-round (ADR-016)
                $cart->secure_key,
                null,
                $orderReference
            );
        } catch (Throwable $e) {
            $this->discardStrayOutput();
            OpenLinker::$suppressImportMail = false;
            PrestaShopLogger::addLog(
                'OpenLinker: validateOrder failed for id_cart=' . $idCart . ': ' . $e->getMessage(),
                3, null, 'Cart', $idCart
            );
            $this->jsonError(502, 'validate-order-failed', $e->getMessage());
            return;
        }
        $this->discardStrayOutput();
        OpenLinker::$suppressImportMail = false;

        $idOrder = (int) Order::getIdByCartId($idCart);
        if ($idOrder <= 0) {
            $this->jsonError(502, 'validate-order-failed', 'no order produced for cart');
            return;
        }

        $order = new Order($idOrder);
        $this->jsonOk([
            'ok' => true,
            'id_order' => $idOrder,
            'reference' => $order->reference,
            'already_existed' => false,
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
     * Defense-in-depth: postProcess() exits on every code path. Override so a
     * future fall-through can't invoke Smarty against a missing template.
     *
     * @return void
     */
    public function displayAjax()
    {
        // No-op. JSON responses are emitted from postProcess() via exit().
    }

    /**
     * Drop anything PrestaShop printed while the order was being created.
     *
     * The JSON response is written after this, so a stray notice or a die()
     * body must not be left in front of it.
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
     * Shutdown guard for the validateOrder call.
     *
     * Runs on every request end once registered. If no JSON response was
     * emitted the request died inside PrestaShop, so replace whatever was
     * buffered with an explicit 502 - a failure must never leave here as an
     * HTML 200 (#2601). Public because PHP calls it as a shutdown callback.
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
            'OpenLinker: order import ended without a response for id_cart=' . $idCart
                . ' (' . $strayLength . ' bytes of unexpected output discarded)',
            3, null, 'Cart', $idCart
        );

        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode([
            'ok' => false,
            'error' => 'validate-order-aborted',
            'detail' => 'the shop ended the request without a response',
        ]);
    }

    /**
     * Emit a 200 JSON response and terminate.
     *
     * @param array $body
     * @return void
     */
    private function jsonOk(array $body)
    {
        $this->responded = true;
        http_response_code(200);
        header('Content-Type: application/json');
        echo json_encode($body);
        exit;
    }

    /**
     * Emit an error JSON response with the given status and reason (+ optional
     * detail), and terminate. The reason string is part of the documented
     * endpoint contract — the OL backend reads it programmatically.
     *
     * @param int         $status
     * @param string      $reason
     * @param string|null $detail
     * @return void
     */
    private function jsonError($status, $reason, $detail = null)
    {
        $this->responded = true;
        http_response_code($status);
        header('Content-Type: application/json');
        $body = ['ok' => false, 'error' => $reason];
        if ($detail !== null) {
            $body['detail'] = $detail;
        }
        echo json_encode($body);
        exit;
    }
}
