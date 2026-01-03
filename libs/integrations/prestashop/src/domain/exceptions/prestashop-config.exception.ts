/**
 * PrestaShop Configuration Exception
 *
 * Thrown when PrestaShop connection configuration is invalid or missing
 * required fields. Used by adapter factory during configuration validation.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopConfigException extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
  ) {
    super(message);
    this.name = 'PrestashopConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}



