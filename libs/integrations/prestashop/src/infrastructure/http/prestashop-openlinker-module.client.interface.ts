/**
 * PrestaShop OpenLinker Module Client Interface
 *
 * Defines the contract for HMAC-signed write operations against the
 * OpenLinker PrestaShop module's front-controller endpoints (#515 / PR #524).
 * Used by the order processor adapter (#516) to write per-cart shipping
 * costs into the module's sidecar table BEFORE order create, so PS can
 * read the authoritative amount via getOrderShippingCostExternal() at
 * order-total time.
 *
 * Scope: write-only. Read operations against the OL module's PS-side data
 * (e.g. discovering the OL Dynamic carrier id) go through the regular
 * IPrestashopWebserviceClient since they use PS WS Basic auth, not HMAC.
 * Keeping this interface focused on HMAC writes avoids mixing transport /
 * auth concerns on a single client.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 * @see {@link PrestashopOpenLinkerModuleClient} for the implementation
 */

/**
 * Input shape for `writeCartShipping` — per-cart shipping cost row written
 * into the OL module's sidecar table.
 *
 * The OL backend's `amount_tax_incl` is treated as authoritative on the
 * wire; the PS module installs the OL Dynamic carrier with
 * `id_tax_rules_group=0` so PS does NOT add tax on top.
 */
export interface WriteCartShippingInput {
  /** PrestaShop cart id (integer; the cart row must already exist in PS). */
  idCart: number;
  /** Tax-exclusive shipping amount. Stored alongside tax-incl for future use. */
  amountTaxExcl: number;
  /** Tax-inclusive shipping amount — what PS actually returns at order-total. */
  amountTaxIncl: number;
  /**
   * Free-text diagnostic label for the source of this row, e.g.
   * `allegro:order:abc123`. Optional; persisted as-is for debugging.
   */
  source?: string;
}

/**
 * Input shape for `importOrder` — create a PrestaShop order from an existing
 * cart through `PaymentModule::validateOrder` (ADR-016 / #905), instead of the
 * raw webservice `POST /api/orders` insert that bypasses the order flow.
 *
 * The cart must already exist with `id_carrier` + `id_address_delivery` set
 * (the controller derives `delivery_option` from them) and its sidecar row +
 * `specific_prices` already written.
 */
export interface ImportOrderInput {
  /** PrestaShop cart id the order is created from. */
  idCart: number;
  /** Target PrestaShop order-state id (e.g. payment-accepted). */
  idOrderState: number;
  /** Buyer-paid total (authoritative; PS uses it verbatim via dont_touch_amount). */
  amountPaid: number;
  /**
   * Payment-method label recorded on the order's `payment` field. The adapter
   * sends `'Check payment'` to match the actual payment module the endpoint
   * delegates to (`ps_checkpayment`), keeping provenance consistent with the
   * pre-ADR-016 WS path. The controller falls back to `'OpenLinker'` if absent.
   */
  paymentMethod: string;
  /** OL order reference, used as the PS order `reference` + retry dedup key. */
  orderReference: string;
}

/**
 * Result of a successful `importOrder` call.
 */
export interface ImportOrderResult {
  /** Created (or pre-existing) PrestaShop order id. */
  idOrder: number;
  /** PrestaShop order reference. */
  reference: string;
  /** True when an order already existed for the cart (idempotent re-entry). */
  alreadyExisted: boolean;
}

/**
 * Client contract for HMAC-signed writes to the OpenLinker PS module.
 */
export interface IPrestashopOpenLinkerModuleClient {
  /**
   * Write a per-cart shipping cost into the OL module's sidecar table via
   * its HMAC-authed front controller. Idempotent: re-writing the same
   * (idCart, amounts) tuple is a no-op modulo `updated_at`.
   *
   * @param input — cart id + tax-incl/tax-excl amounts + optional source
   * @throws PrestashopOlModuleException on non-2xx response. NOT best-effort —
   *         order creation must abort so we don't ship at zero.
   */
  writeCartShipping(input: WriteCartShippingInput): Promise<void>;

  /**
   * Create a PrestaShop order from an existing cart via the module's
   * HMAC-authed `importorder` controller, which calls
   * `PaymentModule::validateOrder` (ADR-016 / #905). Idempotent: if an order
   * already exists for the cart the existing one is returned.
   *
   * @param input — cart id + target state + authoritative paid total + payment label + reference
   * @returns the created (or pre-existing) order id + reference
   * @throws PrestashopOlModuleException on non-2xx response.
   */
  importOrder(input: ImportOrderInput): Promise<ImportOrderResult>;
}
