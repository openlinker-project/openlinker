/**
 * Exchange Rate Source Registry Exceptions
 *
 * Raised by `ExchangeRateProviderRegistryService`. Both describe a WIRING
 * fault rather than a data fault, so neither is ever retryable.
 *
 * @module libs/core/src/currency/domain/exceptions
 */

/**
 * Two providers claimed the same source name. A boot-time wiring bug - two
 * modules registering, or one module registered twice - surfaced loudly
 * instead of letting the second silently shadow the first.
 */
export class DuplicateExchangeRateSourceError extends Error {
  constructor(public readonly source: string) {
    super(`An exchange-rate provider is already registered for source '${source}'`);
    this.name = 'DuplicateExchangeRateSourceError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * No provider is registered for the requested source. TERMINAL, never
 * transient: retrying cannot make a module appear in the DI graph, and a
 * retry would only delay the operator seeing that the host is missing
 * `FxIntegrationModule`.
 */
export class UnregisteredExchangeRateSourceError extends Error {
  constructor(
    public readonly source: string,
    public readonly registeredSources: readonly string[]
  ) {
    super(
      `No exchange-rate provider registered for source '${source}'. ` +
        `Registered: [${registeredSources.join(', ') || '<none>'}]`
    );
    this.name = 'UnregisteredExchangeRateSourceError';
    Error.captureStackTrace(this, this.constructor);
  }
}
