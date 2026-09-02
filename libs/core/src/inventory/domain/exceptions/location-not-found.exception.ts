/**
 * Location Not Found Exception
 *
 * Raised by the application service when an update or delete targets a location
 * id that does not exist. Kept distinct from a repository `null` return so a
 * caller cannot conflate "no such location" with "found, but empty".
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class LocationNotFoundException extends Error {
  constructor(public readonly locationId: string) {
    super(`Inventory location not found: ${locationId}`);
    this.name = 'LocationNotFoundException';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LocationNotFoundException);
    }
  }
}
