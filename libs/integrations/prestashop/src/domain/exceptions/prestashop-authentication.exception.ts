/**
 * PrestaShop Authentication Exception
 *
 * Thrown when PrestaShop WebService API authentication fails (401 Unauthorized).
 * Typically indicates invalid API key or missing authentication credentials.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopAuthenticationException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
    public readonly baseUrl?: string,
  ) {
    super(message);
    this.name = 'PrestashopAuthenticationException';
    Error.captureStackTrace(this, this.constructor);
  }
}






