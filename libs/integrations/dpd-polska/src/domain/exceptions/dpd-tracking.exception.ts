/**
 * DPD Tracking Exception
 *
 * Thrown for DPD InfoServices SOAP failures that aren't auth (`401`/SOAP
 * `DeniedAccessWSException` → `DpdUnauthorizedException`) or transient transport
 * (`DpdNetworkException`): a SOAP `<Fault>` business error, or a structurally
 * unparseable / unexpected response body. Keeps tracking failures distinct from
 * the shipment-side rejection vocabulary.
 *
 * @module libs/integrations/dpd-polska/src/domain/exceptions
 */
export class DpdTrackingException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DpdTrackingException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DpdTrackingException);
    }
  }
}
