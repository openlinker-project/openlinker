/**
 * Mirakl Not Supported Exception
 *
 * A catalogue or stock operation the Mirakl master does not perform: creating,
 * editing or deleting a product on the marketplace, or holding stock for an
 * order (#4284). Thrown instead of a silent no-op, because a write that quietly
 * does nothing reads as done.
 *
 * The name carries `NotSupported` on purpose: core reads an error named that
 * way from `adjustInventory` as a refusal made before anything was written,
 * never as an unknown outcome. Deterministic, so the retry classifier treats it
 * as non-retryable.
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklNotSupportedException extends Error {
  constructor(
    public readonly operation: string,
    brand: string
  ) {
    super(`${brand} does not support ${operation} from OpenLinker`);
    this.name = 'MiraklNotSupportedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklNotSupportedException);
    }
  }
}
