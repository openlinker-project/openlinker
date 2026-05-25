/**
 * Incompatible Processor Exception
 *
 * Thrown by `FulfillmentRoutingService` when a routing rule names a processor
 * connection that isn't compatible with its declared `processorKind` —
 * capability + topology validated at save time (see ADR-012). Method-granular
 * compatibility is a #833 concern and not checked here.
 *
 * @module libs/core/src/mappings/domain/exceptions
 */

export class IncompatibleProcessorException extends Error {
  constructor(
    public readonly processorConnectionId: string,
    public readonly processorKind: string,
    public readonly reason: string,
  ) {
    super(
      `Connection ${processorConnectionId} is not a compatible '${processorKind}' processor: ${reason}`,
    );
    this.name = 'IncompatibleProcessorException';
    Error.captureStackTrace(this, this.constructor);
  }
}
