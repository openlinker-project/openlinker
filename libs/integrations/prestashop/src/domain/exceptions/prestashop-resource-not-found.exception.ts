/**
 * PrestaShop Resource Not Found Exception
 *
 * Thrown when a requested resource is not found in PrestaShop (404 Not Found).
 * Used for products, orders, inventory, or other resources that don't exist.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopResourceNotFoundException extends Error {
  constructor(
    message: string,
    public readonly resourceType?: string,
    public readonly resourceId?: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'PrestashopResourceNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}




