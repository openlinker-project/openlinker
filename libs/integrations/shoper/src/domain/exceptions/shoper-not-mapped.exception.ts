/**
 * ShoperNotMappedException
 *
 * Thrown when an OpenLinker internal product id has no Shoper external id on
 * this connection: a mapping gap, not a statement about the shop. It stays
 * platform-native (and therefore retryable) on purpose - the neutral
 * `MasterProductNotFoundError` is reserved for a platform-REPORTED absence, so
 * that an inferred one can never stale a catalogue.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperNotMappedException extends Error {
  constructor(
    readonly productId: string,
    readonly connectionId: string,
  ) {
    super(`Product ${productId} has no Shoper id on connection ${connectionId}`);
    this.name = 'ShoperNotMappedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
