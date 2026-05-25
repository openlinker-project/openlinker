/**
 * Undispatchable Resolution Exception
 *
 * Thrown by `ShipmentDispatchService` when a fulfillment-routing resolution
 * cannot be dispatched — an invariant violation that #832's compatibility gate
 * should already prevent (a label-generating kind with no processor connection,
 * or an unknown processor kind). Surfaces loud rather than silently skipping
 * dispatch. Mirrors #832's exhaustiveness-guard discipline with a typed domain
 * error instead of a bare `Error`.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */

export class UndispatchableResolutionException extends Error {
  constructor(public readonly reason: string) {
    super(`Fulfillment routing resolution cannot be dispatched: ${reason}`);
    this.name = 'UndispatchableResolutionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
