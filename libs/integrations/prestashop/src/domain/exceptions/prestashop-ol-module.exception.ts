/**
 * PrestaShop OpenLinker Module Exceptions
 *
 * Domain exceptions for the OpenLinker PrestaShop module integration path
 * (#516, building on #515). Two distinct failure modes:
 *
 *   - PrestashopOlCarrierMissingException — the OL Dynamic carrier row
 *     cannot be located on the connection's PrestaShop instance. Operator
 *     hasn't installed or activated the openlinker module, or all matching
 *     rows are soft-deleted. Order create must abort.
 *
 *   - PrestashopOlModuleException — an HMAC-authed call to the OL module's
 *     front-controller endpoint (e.g. cartshipping) returned a non-2xx
 *     response. NOT best-effort: order creation must abort rather than
 *     proceed with potentially-wrong shipping totals.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 * @see {@link PrestashopOpenLinkerModuleClient} for the call site that throws PrestashopOlModuleException
 */

/**
 * Thrown when no live OpenLinker Dynamic carrier exists on the PrestaShop
 * instance. PrestaShop returns no row matching
 * `external_module_name='openlinker' AND active=1 AND deleted=0`.
 *
 * Recovery: operator must install + activate the OL PrestaShop module
 * (#515 / PR #524). After install, retry the sync.
 */
export class PrestashopOlCarrierMissingException extends Error {
  constructor(public readonly connectionId: string) {
    super(
      `OpenLinker Dynamic carrier not found on connection ${connectionId} ` +
        `(no row matching external_module_name='openlinker', active=1, deleted=0). ` +
        `Install + activate the OL PrestaShop module on the dev shop, then retry.`,
    );
    this.name = 'PrestashopOlCarrierMissingException';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when an HMAC-authed POST to the OL PrestaShop module's front
 * controller (e.g. `?fc=module&module=openlinker&controller=cartshipping`)
 * returns a non-2xx response. The reason string from the module's JSON
 * error body is surfaced via the `reason` property when present.
 *
 * Recovery depends on the reason:
 *   - 'invalid-signature' / 'misconfigured': operator must reconcile the
 *     OPENLINKER_WEBHOOK_SECRET between PS module config and OL connection
 *     credentials.
 *   - 'invalid-body' / 'invalid-fields': bug in the OL adapter — the wire
 *     contract drifted; surface to engineering.
 *   - 'persist-failed': PS-side DB write failed; check PS log for SQL error.
 */
export class PrestashopOlModuleException extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly idCart: number,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(
      `OpenLinker module call failed for connection=${connectionId} idCart=${idCart}: ` +
        `HTTP ${status}` +
        (reason ? ` (reason: ${reason})` : ''),
    );
    this.name = 'PrestashopOlModuleException';
    Error.captureStackTrace(this, this.constructor);
  }
}
