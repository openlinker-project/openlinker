/**
 * Subiekt Not Supported Exception
 *
 * Thrown when a requested `InventoryMasterPort` operation has no Sfera GT
 * primitive behind it. Mirrors `PrestashopNotSupportedException` — used today
 * for `reserveInventory` / `releaseInventory`, both `@deprecated` in place by
 * ADR-061 (no shipped master exposes a hold primitive; OL's own advisory
 * reservation ledger owns holds now).
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektNotSupportedException extends Error {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly alternative?: string,
  ) {
    super(message);
    this.name = 'SubiektNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
