/**
 * PrestaShop Parse Exception
 *
 * Thrown when PrestaShop API response cannot be parsed (invalid JSON/XML).
 * Used when response format is unexpected or malformed.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopParseException extends Error {
  constructor(
    message: string,
    public readonly responseBody?: string,
    public readonly format?: 'auto' | 'json' | 'xml',
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'PrestashopParseException';
    Error.captureStackTrace(this, this.constructor);
  }
}

