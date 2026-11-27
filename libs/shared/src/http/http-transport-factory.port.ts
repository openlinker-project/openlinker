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

/**
 * Per-call options for {@link HttpTransportFactoryPort.forConnection}. A third,
 * optional argument rather than a widened second one: `defaultRateLimit` is a
 * `ConnectionRateLimit`, and folding an options bag into that slot would make
 * every existing call site ambiguous to read.
 */
export interface ForConnectionOptions {
  /**
   * Draw from a bucket SHARED with other connections instead of the
   * connection's own. Only for a remote whose quota is scoped wider than a
   * credential (per shop, per account) - see ADR-038 § Amendment. Absent
   * means the default: one bucket per connection id.
   *
   * Under a shared bucket `defaultRateLimit` is the remote's own ceiling and
   * the connection's `config.rateLimit` may only tighten it for this
   * connection (`tightenRateLimit`), never raise it.
   */
  bucketKey?: string;
}

export interface HttpTransportFactoryPort {
  /**
   * Returns a stable, connection-bound {@link FetchLike} — the same
   * reference on every call for a given `connection.id`, not a new closure
   * per call. Every call through it acquires a rate-limit slot (per the
   * connection's live `config.rateLimit`, falling back to the caller-supplied
   * `defaultRateLimit` when unset, or unlimited if neither is present)
   * before delegating to the underlying transport, and releases it in a
   * `finally`.
   *
   * `defaultRateLimit` is the plugin's own `AdapterMetadata.defaultRateLimit`
   * — the caller (each plugin's `createCapabilityAdapter`) passes its own
   * manifest value; this package never imports `AdapterMetadata` itself
   * (no CORE dependency). Re-read on every call alongside `config.rateLimit`
   * — never cached — so it stays correct even though the returned
   * `FetchLike` reference is stable.
   *
   * **One bucket per connection, never per host.** A plugin that talks to
   * several physical hosts for one connection (Allegro serves REST from
   * `api.allegro.pl` and image uploads from `upload.allegro.pl`) still shares
   * a single bucket, because the quota it is pacing against is the remote's,
   * and remotes scope quotas by credential — not by hostname. Allegro
   * documents exactly one limit, "9000 requests per minute per Client ID",
   * plus optional lower *per-resource* sub-limits; nothing in its docs
   * suggests `upload.` draws from a second pool. Splitting per host would
   * quietly double a connection's real aggregate against one server-side
   * budget, and make `config.rateLimit` mean something different from what
   * the operator typed. See ADR-038 § "The cap is per connection".
   *
   * The one exception is `options.bucketKey`: a remote whose quota is scoped
   * WIDER than a credential (Shoper's is per shop, shared by every token on
   * it) lets the plugin name that wider scope, so two connections to one shop
   * pace against one bucket. The returned `FetchLike` is then stable per
   * `(connection.id, bucketKey)`, never handed back for a different bucket.
   * See ADR-038 § Amendment.
   */
  forConnection(
    connection: RateLimitedConnection,
    defaultRateLimit?: ConnectionRateLimit,
    options?: ForConnectionOptions
  ): FetchLike;

  /**
   * Drop the cached `FetchLike` + `ConnectionRef` for a connection id, and
   * evict its underlying rate limiter (see `RateLimiterRegistry.evict`).
   * Call this when a connection is disabled or deleted — otherwise both
   * this factory's caches and the registry grow unbounded for the life of
   * the process across every connection id ever resolved.
   *
   * A SHARED bucket (`ForConnectionOptions.bucketKey`) is evicted only once
   * no other connection in this process still uses it - evicting one of two
   * connections to a shop must not reset the bucket the other is pacing on.
   */
  evict(connectionId: string): void;
}
