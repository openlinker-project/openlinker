/**
 * PrestaShop Not Supported Exception
 *
 * Thrown when a requested operation is not supported in the MVP scope.
 * Used for write operations (create, update, delete) that are out of scope
 * for the read-only MVP adapter.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopNotSupportedException extends Error {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly alternative?: string,
  ) {
    super(message);
    this.name = 'PrestashopNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}



