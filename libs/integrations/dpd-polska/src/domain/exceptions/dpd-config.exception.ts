/**
 * DPD Config Exception
 *
 * Thrown when a connection's config or credentials are invalid or missing
 * required fields (no `login`/`password`, non-numeric `payerFid`, …). Distinct
 * from the shared `ShippingProviderRejectionException` (#885), which covers
 * per-shipment/command validation surfaced by DPD.
 *
 * @module libs/integrations/dpd-polska/src/domain/exceptions
 */
export class DpdConfigException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'DpdConfigException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DpdConfigException);
    }
  }
}
