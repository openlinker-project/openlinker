/**
 * Adapter Capability Not Supported Exception (#742)
 *
 * Thrown by core application services when a resolved adapter doesn't
 * implement a required sub-capability (e.g. `OfferCreator` for offer-creation
 * flows). Lets core stay NestJS-free — the controller / global filter maps
 * the domain exception to HTTP 422.
 *
 * Today this is thrown by `BulkOfferCreationRetryService`. Other services
 * (`OfferCreationEnqueueService`, `BulkOfferCreationSubmitService`) still
 * throw the NestJS `UnprocessableEntityException` directly from core —
 * pre-existing violation tracked as a cross-cutting cleanup follow-up.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class AdapterCapabilityNotSupportedException extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly capability: string,
  ) {
    super(
      `Adapter for connection ${connectionId} does not support capability: ${capability}`,
    );
    this.name = 'AdapterCapabilityNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
