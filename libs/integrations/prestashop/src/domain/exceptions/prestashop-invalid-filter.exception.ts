/**
 * PrestaShop Invalid Filter Exception
 *
 * Thrown when a caller passes a custom filter key the WebService cannot express.
 * PrestaShop silently ignores an unknown filter parameter and answers with an
 * unfiltered page, so a malformed key reads as success while returning the wrong
 * rows - it has to fail loudly instead (#2616).
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopInvalidFilterException extends Error {
  constructor(
    message: string,
    public readonly filterKey: string,
  ) {
    super(message);
    this.name = 'PrestashopInvalidFilterException';
    Error.captureStackTrace(this, this.constructor);
  }
}
