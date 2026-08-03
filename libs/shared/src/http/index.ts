/**
 * Http Module Exports
 *
 * Public API for the shared connection-bound transport (#1810).
 *
 * @module libs/shared/src/http
 */
export type {
  FetchLike,
  HttpTransportFactoryPort,
  RateLimitedConnection,
} from './http-transport-factory.port';
export { HttpTransportFactory } from './http-transport-factory';
export type { HttpTransportFactoryDeps } from './http-transport-factory';
