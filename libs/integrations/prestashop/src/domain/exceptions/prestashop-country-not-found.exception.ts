/**
 * PrestaShop Country Not Found Exception
 *
 * Thrown when a country cannot be found in PrestaShop for a given ISO2 code.
 * This is a non-retryable error unless PrestaShop configuration changes.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopCountryNotFoundException extends Error {
  constructor(
    public readonly iso2Code: string,
    public readonly connectionId: string,
  ) {
    super(
      `Country with ISO2 code '${iso2Code}' not found in PrestaShop (connection: ${connectionId}). ` +
        `Please ensure the country is configured in PrestaShop or update the connection configuration.`,
    );
    this.name = 'PrestashopCountryNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
