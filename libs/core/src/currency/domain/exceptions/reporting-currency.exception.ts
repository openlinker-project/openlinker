/**
 * Reporting Currency Validation Exceptions
 *
 * The two save-time validation failures. They are the only exceptions in this
 * context that escape to an HTTP boundary, where the settings controller maps
 * them to 400 (shape) and 422 (reachability) respectively - the same split
 * `AiProviderActivationError` already gets.
 *
 * @module libs/core/src/currency/domain/exceptions
 */

/**
 * The submitted value is not an ISO-4217-shaped code at all. Maps to 400 -
 * the request is malformed, not merely unsatisfiable.
 */
export class InvalidReportingCurrencyError extends Error {
  constructor(public readonly submitted: string) {
    super(
      `'${submitted}' is not a valid ISO-4217 currency code (expected three letters, e.g. 'EUR')`
    );
    this.name = 'InvalidReportingCurrencyError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * The code is well-formed but unreachable - either outside the supported set
 * or not quoted by any registered provider. Maps to 422; the message carries
 * the set that WOULD be accepted, so the operator is not left guessing.
 */
export class ReportingCurrencyUnsupportedError extends Error {
  constructor(
    public readonly submitted: string,
    public readonly supportedCurrencies: readonly string[]
  ) {
    super(
      `Reporting currency '${submitted}' is not supported. ` +
        `Supported: [${supportedCurrencies.join(', ') || '<none>'}]`
    );
    this.name = 'ReportingCurrencyUnsupportedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
