/**
 * Invalid Parcel Profile Exception
 *
 * Thrown by `FulfillmentRoutingService.replaceRules` when a rule's parcel
 * profile sets only some of length/width/height. A partial box is meaningless
 * to every carrier, so it is refused at save time instead of failing later at
 * the carrier preflight (#3651).
 *
 * @module libs/core/src/mappings/domain/exceptions
 */

export class InvalidParcelProfileException extends Error {
  constructor(public readonly sourceDeliveryMethodId: string) {
    super(
      `Invalid parcel profile for delivery method '${sourceDeliveryMethodId}': ` +
        `length, width and height must be set together or not at all`,
    );
    this.name = 'InvalidParcelProfileException';
    Error.captureStackTrace(this, this.constructor);
  }
}
