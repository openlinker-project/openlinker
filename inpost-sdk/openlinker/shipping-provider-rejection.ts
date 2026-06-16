/**
 * Shipping Provider Rejection — mirror copy.
 *
 * Trimmed mirror of core's `ShippingProviderRejectionException` (#885): a typed
 * rejection carrying a stable, cross-provider `providerCode` discriminator so
 * callers can branch (e.g. `target_point` → "pick another locker") without
 * parsing messages.
 */

export type ProviderRejectionCode =
  | 'preflight.unsupported-method'
  | 'preflight.missing-recipient-address'
  | 'preflight.missing-dimensions-or-weight'
  | 'preflight.missing-parcel-template'
  | 'preflight.missing-paczkomat-id'
  | 'target_point'
  | 'command.success-without-shipment-id'
  | (string & {});

export class ShippingProviderRejectionException extends Error {
  readonly providerName: string;
  readonly providerCode: ProviderRejectionCode;
  readonly providerDetails: Record<string, unknown> | undefined;

  constructor(
    providerName: string,
    providerCode: ProviderRejectionCode,
    message: string,
    providerDetails?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ShippingProviderRejectionException';
    this.providerName = providerName;
    this.providerCode = providerCode;
    this.providerDetails = providerDetails;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
