/**
 * Erli Capability Not Implemented Exception
 *
 * Thrown by the Erli plugin's `createCapabilityAdapter` while the integration
 * is a registration-only skeleton: the manifest declares `OfferManager` and
 * `OrderSource`, but the adapters ship in follow-up issues (#984 / #993).
 * Distinct from the SDK's unsupported-capability error — the capability IS
 * supported by the platform, just not built yet.
 *
 * @module domain/exceptions
 */
export class ErliCapabilityNotImplementedException extends Error {
  constructor(capability: string) {
    super(
      `Erli capability "${capability}" is not implemented yet — the Erli plugin is registration-only.`,
    );
    this.name = 'ErliCapabilityNotImplementedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
