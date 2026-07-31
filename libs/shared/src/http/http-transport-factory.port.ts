/**
 * Http Transport Factory Port
 *
 * The single seam every plugin HTTP client goes through for outbound
 * requests (#1810). `RateLimitedConnection` is a structural subset of
 * `Connection` — this package has zero dependency on any CORE domain
 * type, so the caller passes a connection in by shape, not by import.
 *
 * @module libs/shared/src/http
 */
import type { ConnectionRateLimit } from '../rate-limit';

/** Matches the global `fetch` signature — a plugin client's injectable transport. */
export type FetchLike = typeof fetch;

export interface RateLimitedConnection {
  id: string;
  config?: {
    rateLimit?: ConnectionRateLimit;
  } & Record<string, unknown>;
}

export interface HttpTransportFactoryPort {
  /**
   * Returns a stable, connection-bound {@link FetchLike} — the same
   * reference on every call for a given `connection.id`, not a new closure
   * per call. Every call through it acquires a rate-limit slot (per the
   * connection's live `config.rateLimit`, or unlimited if absent) before
   * delegating to the underlying transport, and releases it in a `finally`.
   */
  for(connection: RateLimitedConnection): FetchLike;
}
