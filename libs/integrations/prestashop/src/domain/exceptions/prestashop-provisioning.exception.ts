/**
 * PrestaShop Provisioning Exception
 *
 * Thrown when customer or address provisioning fails in PrestaShop.
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
