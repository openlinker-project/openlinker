/**
 * PrestaShop Provisioning Exception
 *
 * Thrown when provisioning a PrestaShop resource fails - customers and addresses,
 * and since #2616 also catalogue nodes (a category or feature level that cannot be
 * scanned to the end, where reporting a miss would create a duplicate).
 * Used for provisioning-specific errors like lock acquisition failures,
 * concurrent provisioning conflicts, or missing required data.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopProvisioningException extends Error {
  constructor(
    message: string,
    public readonly internalCustomerId?: string,
    public readonly connectionId?: string,
    public readonly emailHash?: string,
    public readonly normalizedEmail?: string,
  ) {
    super(message);
    this.name = 'PrestashopProvisioningException';
    Error.captureStackTrace(this, this.constructor);
  }
}
