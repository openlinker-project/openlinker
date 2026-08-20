/**
 * FX Integration DI Tokens
 *
 * @module libs/integrations/fx
 */

/**
 * The `FetchLike` both provider adapters call.
 *
 * Injected rather than reached for globally so every adapter spec can fake HTTP
 * without `jest.spyOn(globalThis)` - and so the whole package has exactly ONE
 * place where the global transport is referenced.
 *
 * ADR-038's `HttpTransportFactoryPort.forConnection` is structurally unusable
 * here: it keys its cached transport and its rate-limit bucket on
 * `connection.id`, and a public reference-rate read has no connection. Passing
 * a synthetic one would create a bucket that means nothing.
 */
export const FX_FETCH_TOKEN = Symbol('FxFetchLike');

/** Per-adapter request timeout, in milliseconds. */
export const FX_TIMEOUT_MS_TOKEN = Symbol('FxTimeoutMs');

export const NBP_EXCHANGE_RATE_ADAPTER_TOKEN = Symbol('NbpExchangeRateAdapter');
export const ECB_EXCHANGE_RATE_ADAPTER_TOKEN = Symbol('EcbExchangeRateAdapter');
