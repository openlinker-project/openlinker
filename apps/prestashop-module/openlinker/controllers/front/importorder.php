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
 *     payment_method?: string, order_reference?: string,
 *     line_prices?: [{ id_product: int, id_product_attribute?: int, price: string }] }
 *
 * `line_prices` carries the buyer-paid tax-EXCLUSIVE unit price of every line
 * (#2597). When present the module pins them as cart-scoped `specific_prices`
 * itself and deletes them again in the same request, which replaces two
 * Webservice calls per line - sixteen of twenty-seven on an eight-line order.
 * The prices are already converted and rounded by the backend, which owns the
 * tax-rate resolution; the module never computes one.
 *
 * Responses:
 *   200 {ok: true, id_order: <int>, reference: <string>, already_existed: <bool>,
 *        features: ['line_prices']}
 *   400 {ok: false, error: 'invalid-body' | 'invalid-fields' | 'invalid-line-prices'
 *        | 'line-prices-do-not-match-cart' | 'cart-not-found' | 'cart-empty'}
 *   401 {ok: false, error: <HmacRequestVerifier reason>}
 *   405 {ok: false, error: 'method-not-allowed'}
 *   409 {ok: false, error: 'replayed-request'}
 *   422 {ok: false, error: 'payment-module-unavailable' | 'payment-module-inactive'}
 *   502 {ok: false, error: 'validate-order-failed' | 'validate-order-aborted'
 *        | 'line-price-pin-failed', detail: <string>}
 *
 * `features` is how the backend learns this build accepts `line_prices`, and it
 * is on every envelope, failures included, so the backend can learn it without
 * an order having to be created. An older module answers without it, so the
 * backend keeps pinning over the Webservice until it has seen the field.
 *
 * Idempotent for a SEQUENTIAL retry, not for a concurrent one. If an order
 * already exists for `id_cart` the existing order is returned
 * (`already_existed: true`) rather than validated a second time, so a retry
 * issued after the first request finished is safe.
 *
 * It is NOT safe against two requests for one cart that overlap (#2627 review).
 * The check is `Order::getIdByCartId($idCart)` followed, ~100 lines later, by
 * `validateOrder`, with nothing serialising the two — no `GET_LOCK`, no
 * `SELECT ... FOR UPDATE`, no transaction anywhere in this request path. A
 * client that times out at 30 s while `validateOrder` is still running and then
 * retries passes the replay guard (the retry is freshly signed and carries
 * its own nonce), reads 0 from `getIdByCartId` because the first request has
 * not committed, and validates the cart a second time: two orders, two stock
 * decrements, one cart. PrestaShop's own `OrderExists()` check inside
 * `validateOrder` narrows the window; it is the same read-then-act shape, and
 * the shutdown guard turns its `die()` into a 502 rather than an idempotent
 * reply.
 *
 * Closing it properly needs a per-cart lock held across both statements — a
 * named `GET_LOCK('openlinker:cart:<id>')` acquired before the existence check
 * and released after the response is composed. That is deliberately not done in
 * the review round that found it: this module ships no `vendor/`, so its
 * PHPUnit suite cannot execute here, and adding untested locking to the live
 * order-creation path would trade a documented narrow race for an unbounded
 * one. What is fixed here is the claim: the docblock said the retry was safe.
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

    /** @var int[] `specific_price` ids this request created, for its own cleanup. */
    private $pinnedPriceIds = [];

    /** @var int Cart the pinned rows belong to. Guards the cleanup delete. */
    private $pinnedCartId = 0;

    /**
     * `from` stamped on every pinned row.
     *
     * Far enough in the past to always apply, and distinctive enough to
     * identify the rows this module wrote.
     */
    const PIN_FROM = '2000-01-01 00:00:01';

    public function postProcess()
    {
        if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->jsonError(405, 'method-not-allowed');
            return;
        }

        require_once $this->module->getLocalPath() . 'classes/HmacRequestVerifier.php';
        require_once $this->module->getLocalPath() . 'classes/PaymentModuleGate.php';
        require_once $this->module->getLocalPath() . 'classes/LinePriceRequest.php';
        require_once $this->module->getLocalPath() . 'classes/ReplayGuard.php';
        // For `WebhookSender::getErrorMessage`, the module's one redaction pass.
        // Every error detail this controller puts in a response body goes
        // through it (#2627 review).
        require_once $this->module->getLocalPath() . 'classes/WebhookSender.php';

        $rawBody         = (string) @file_get_contents('php://input');
        $timestampHeader = $this->headerValue('HTTP_X_OPENLINKER_TIMESTAMP');
        $signatureHeader = $this->headerValue('HTTP_X_OPENLINKER_SIGNATURE');
        $secret          = (string) Configuration::get('OPENLINKER_WEBHOOK_SECRET');

        try {
            HmacRequestVerifier::verify($rawBody, $timestampHeader, $signatureHeader, $secret);
        } catch (Exception $e) {
            $this->jsonError(401, $this->redact($e->getMessage()));
            return;
        }

        // This is the money path, so a captured request must not be usable
        // twice. Claimed after verification so an unsigned caller cannot fill
        // the table (#2619).
        if (!ReplayGuard::claim('importorder', $signatureHeader)) {
            $this->jsonError(409, 'replayed-request');
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

        $linePrices = [];
        if (array_key_exists('line_prices', $data) && $data['line_prices'] !== null) {
            $linePrices = LinePriceRequest::normalize($data['line_prices']);
            if ($linePrices === null) {
                $this->jsonError(400, 'invalid-line-prices');
                return;
            }
        }

        $cart = new Cart($idCart);
        if (!Validate::isLoadedObject($cart)) {
            $this->jsonError(400, 'cart-not-found');
            return;
        }
        $cartProducts = $cart->getProducts();
        if (!count($cartProducts)) {
            $this->jsonError(400, 'cart-empty');
            return;
        }

        // A price set that does not match the cart line for line is refused. An
        // omitted line would otherwise be ordered at the catalogue price and
        // nothing anywhere would say so (#2597).
        if ($linePrices !== [] && !LinePriceRequest::coversCart($linePrices, $cartProducts)) {
            $this->jsonError(400, 'line-prices-do-not-match-cart');
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

        // Registered before the first pin write, so a fatal inside the pin loop
        // - the one stretch of this request doing repeated writes - is covered
        // too. The guard returns early once a response was emitted.
        //
        // The buffer opens at the same point rather than later, because a fatal
        // between the two used to print unbuffered: the guard then reported
        // "0 bytes discarded" and, if PHP had already flushed, `headers_sent()`
        // made it give up silently and leave an HTML 200 (#2601 review).
        register_shutdown_function([$this, 'guardAgainstSilentExit'], $idCart);
        ob_start();
        $this->bufferOpen = true;

        // Pin the buyer-paid line prices, if the backend sent them (#2597).
        // Done here rather than over the Webservice so eight lines cost no
        // extra requests at all. Failing loudly is the point: an unpinned line
        // would be ordered at the catalogue price (ADR-014).
        if ($linePrices !== []) {
            $pinError = $this->pinLinePrices($cart, $linePrices);
            if ($pinError !== null) {
                $this->cleanupPinnedPrices();
                OpenLinker::$suppressImportMail = false;
                $this->jsonError(502, 'line-price-pin-failed', $this->redact($pinError));
                return;
            }
        }

        // validateOrder and the code it calls can end the request with die(),
        // which PHP sends as HTML with status 200 - a failure the caller reads
        // as a success (#2601). The buffer opened above is what stops such a
        // body escaping, and the shutdown guard turns a silent exit into an
        // explicit 502.
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
            $this->cleanupPinnedPrices();
            OpenLinker::$suppressImportMail = false;
            PrestaShopLogger::addLog(
                'OpenLinker: validateOrder failed for id_cart=' . $idCart . ': ' . $e->getMessage(),
                3, null, 'Cart', $idCart
            );
            $this->jsonError(502, 'validate-order-failed', $this->redact($e->getMessage()));
            return;
        }
        $this->discardStrayOutput();
        // The prices are materialised into order_detail now, so the pins have
        // served their purpose.
        $this->cleanupPinnedPrices();
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
     * Create one cart-scoped `specific_price` row per supplied line.
     *
     * Written through the SpecificPrice object model rather than raw SQL so
     * PrestaShop flushes its own price cache - the cart totals validateOrder
     * computes below are read through that cache.
     *
     * The rows are scoped to this cart and this customer, so they cannot price
     * anything else even in the window before they are deleted.
     *
     * @param Cart  $cart
     * @param array $linePrices Normalised rows from LinePriceRequest.
     * @return string|null null on success, else the reason for a 502.
     */
    private function pinLinePrices(Cart $cart, array $linePrices)
    {
        $this->pinnedCartId = (int) $cart->id;

        // Backstop expiry, in case the process dies before any cleanup path
        // runs. The row prices only this cart, which by then has its order.
        $expiry = date('Y-m-d H:i:s', time() + 86400);

        foreach ($linePrices as $line) {
            $specificPrice = new SpecificPrice();
            $specificPrice->id_product = $line['id_product'];
            $specificPrice->id_product_attribute = $line['id_product_attribute'];
            $specificPrice->id_shop = 0;
            $specificPrice->id_shop_group = 0;
            $specificPrice->id_cart = (int) $cart->id;
            $specificPrice->id_currency = (int) $cart->id_currency;
            $specificPrice->id_country = 0;
            $specificPrice->id_group = 0;
            $specificPrice->id_customer = (int) $cart->id_customer;
            $specificPrice->from_quantity = 1;
            $specificPrice->price = $line['price'];
            $specificPrice->reduction = 0;
            $specificPrice->reduction_tax = 0;
            $specificPrice->reduction_type = 'amount';
            // A fixed past date rather than the zero date: it works under
            // NO_ZERO_DATE, and it marks the row as ours, so a row leaked by a
            // killed process can be swept later without guessing.
            $specificPrice->from = self::PIN_FROM;
            $specificPrice->to = $expiry;

            try {
                if (!$specificPrice->add()) {
                    return 'could not pin the price of product ' . $line['id_product'];
                }
            } catch (Exception $e) {
                return 'could not pin the price of product ' . $line['id_product']
                    . ': ' . $e->getMessage();
            }

            $this->pinnedPriceIds[] = (int) $specificPrice->id;
        }

        return null;
    }

    /**
     * Delete the `specific_price` rows this request created.
     *
     * Only the ids collected above are touched, and each is re-checked against
     * the cart it was created for. Deleting by `id_cart` alone would be wrong:
     * several PrestaShop modules write cart-scoped promotions and some use
     * `id_cart = 0`, so a cart-wide delete could remove a row we never made.
     *
     * Best-effort. A row left behind expires within a day and is scoped to a
     * cart that now has an order, so it can price nothing.
     *
     * @return void
     */
    private function cleanupPinnedPrices()
    {
        $ids = $this->pinnedPriceIds;
        $this->pinnedPriceIds = [];

        foreach ($ids as $id) {
            try {
                $specificPrice = new SpecificPrice($id);
                if (
                    Validate::isLoadedObject($specificPrice)
                    && (int) $specificPrice->id_cart === $this->pinnedCartId
                ) {
                    $specificPrice->delete();
                }
            } catch (Exception $e) {
                PrestaShopLogger::addLog(
                    'OpenLinker: could not delete pinned specific_price ' . $id
                        . ' (it expires on its own): ' . $e->getMessage(),
                    2, null, 'Cart', $this->pinnedCartId
                );
            }
        }
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
        // The request died inside PrestaShop, so no other path will run. A pin
        // left behind prices nothing - it is scoped to this one cart - but it
        // stays in specific_price for good, so it is removed here.
        $this->cleanupPinnedPrices();

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
        // Capability advertisement, not decoration. The backend cannot ask an
        // older module what it accepts, so a build that understands
        // `line_prices` says so on every success (#2597).
        $body['features'] = ['line_prices'];
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
     * Emit an error JSON response with the given status and reason (+ optional
     * detail), and terminate. The reason string is part of the documented
     * endpoint contract — the OL backend reads it programmatically.
     *
     * @param int         $status
     * @param string      $reason
     * @param string|null $detail
     * @return void
     */
    /**
     * Strip credential-shaped fragments out of anything derived from an
     * exception before it leaves the process.
     *
     * Every other error path in this module already routes through
     * `WebhookSender::getErrorMessage`; four in this controller did not, and
     * this is the controller whose body OpenLinker stores verbatim in
     * `sync_jobs.lastError` — visible to any operator, `viewer` included. A
     * `PrestaShopDatabaseException` embeds the failing SQL, so an unredacted
     * 502 carried table names, the DB prefix and order column values out with it
     * (#2627 review).
     *
     * Redaction is not the same thing as safety: this narrows a known leak
     * shape, it does not make arbitrary driver text fit for publication. That is
     * why the detail is also truncated.
     *
     * @param string $message
     * @return string
     */
    private function redact($message)
    {
        $message = (string) $message;

        if (class_exists('WebhookSender') && method_exists('WebhookSender', 'getErrorMessage')) {
            $message = WebhookSender::getErrorMessage(new Exception($message));
        }

        return substr($message, 0, 500);
    }

    private function jsonError($status, $reason, $detail = null)
    {
        $this->discardStrayOutput();
        $this->responded = true;
        http_response_code($status);
        header('Content-Type: application/json');
        // Advertised on failures too, so the backend can learn what this build
        // accepts without an order having to be created first (#2597).
        $body = ['ok' => false, 'error' => $reason, 'features' => ['line_prices']];
        if ($detail !== null) {
            $body['detail'] = $detail;
        }
        echo json_encode($body);
        exit;
    }
}
