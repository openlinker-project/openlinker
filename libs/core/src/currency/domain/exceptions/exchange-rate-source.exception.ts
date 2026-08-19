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

/**
 * The registry is EMPTY at the end of boot, i.e. no host module ever registered
 * a provider (#2135 review, finding 9).
 *
 * Raised at `onApplicationBootstrap` rather than left to the first stamp, because
 * an empty registry degrades two ways at once and both are silent: every stamp
 * classifies `no-rate-source` and durably marks the order answered without a
 * figure, while `listSelectableCurrencies` returns `[]` so every settings PUT
 * 422s with nothing to select. Failing the boot converts a data-loss default into
 * a startup error naming the missing module.
 */
export class NoExchangeRateProvidersRegisteredError extends Error {
  constructor() {
    super(
      'No exchange-rate providers are registered at the end of boot. ' +
        'The host must import FxIntegrationModule (@openlinker/integrations-fx) - ' +
        'without it every order FX stamp fails as no-rate-source and the ' +
        'reporting-currency setting has no selectable currencies.'
    );
    this.name = 'NoExchangeRateProvidersRegisteredError';
    Error.captureStackTrace(this, this.constructor);
  }
}
