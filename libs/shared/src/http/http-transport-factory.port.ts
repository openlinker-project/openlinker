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
   * reference on every call for a given `connection.id` + `hostKey`, not a
   * new closure per call. Every call through it acquires a rate-limit slot
   * (per the connection's live `config.rateLimit`, falling back to the
   * caller-supplied `defaultRateLimit` when unset, or unlimited if neither
   * is present) before delegating to the underlying transport, and releases
   * it in a `finally`.
   *
   * `defaultRateLimit` is the plugin's own `AdapterMetadata.defaultRateLimit`
   * — the caller (each plugin's `createCapabilityAdapter`) passes its own
   * manifest value; this package never imports `AdapterMetadata` itself
   * (no CORE dependency). Re-read on every call alongside `config.rateLimit`
   * — never cached — so it stays correct even though the returned
   * `FetchLike` reference is stable.
   *
   * `hostKey` distinguishes independent rate-limit buckets for a plugin that
   * talks to more than one physical host per connection (e.g. Allegro's
   * `api.allegro.pl` vs `upload.allegro.pl`, which carry independent quotas
   * on Allegro's side). Omit it when a plugin has exactly one host per
   * connection (e.g. PrestaShop) — the bucket is then keyed on `connection.id`
   * alone, matching pre-#1810-Phase-5 single-host callers byte-for-byte.
   */
  for(
    connection: RateLimitedConnection,
    defaultRateLimit?: ConnectionRateLimit,
    hostKey?: string
  ): FetchLike;
}
