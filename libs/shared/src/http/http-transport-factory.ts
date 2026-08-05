/**
 * Http Transport Factory
 *
 * Resolves a connection's live `config.rateLimit`, divides it across
 * `OL_WORKER_REPLICAS` (static division, #1810), and wraps the underlying
 * transport so every call acquires a rate-limit slot first and releases it
 * in a `finally`. A `429`/`503` response's `Retry-After` header feeds back
 * into the limiter's pacing — this is a pass-through wrapper, not a retry
 * engine, so the response itself is returned to the caller unmodified.
 *
 * @module libs/shared/src/http
 */
import type { RateLimiterRegistry } from '../rate-limit';
import { getCurrentPriority, getCurrentRateLimitSignal } from '../rate-limit';
import type { ConnectionRateLimit } from '../rate-limit';
import type {
  FetchLike,
  HttpTransportFactoryPort,
  RateLimitedConnection,
} from './http-transport-factory.port';

export interface HttpTransportFactoryDeps {
  registry: RateLimiterRegistry;
  /** Divides every connection's configured cap. Defaults to 1 (no division). */
  replicas?: number;
  /** Underlying transport. Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
}

function dividePolicy(policy: ConnectionRateLimit, replicas: number): ConnectionRateLimit {
  if (replicas <= 1) {
    return policy;
  }
  return {
    requestsPerMinute:
      policy.requestsPerMinute !== undefined
        ? Math.max(1, Math.floor(policy.requestsPerMinute / replicas))
        : undefined,
    maxConcurrent:
      policy.maxConcurrent !== undefined
        ? Math.max(1, Math.floor(policy.maxConcurrent / replicas))
        : undefined,
  };
}

/** Seconds (`Retry-After: 5`) or an HTTP-date. Returns null if unparseable. */
function parseRetryAfterMs(header: string | null): number | null {
  const trimmed = header?.trim();
  if (!trimmed) return null;

  const asSeconds = Number(trimmed);
  if (!Number.isNaN(asSeconds)) {
    return Math.max(0, asSeconds * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return null;
}

/**
 * Mutable holder so a cached closure always reads the latest connection
 * object (and the caller's latest `defaultRateLimit` argument) for its id.
 */
interface ConnectionRef {
  current: RateLimitedConnection;
  defaultRateLimit: ConnectionRateLimit | undefined;
}

/**
 * Note on `evict()` and connection updates (tech-review finding on #1957):
 * the host only calls `evict()` from `ConnectionService.disable()`, never
 * from `.update()`. This is deliberate, not an oversight — `forConnection()`
 * refreshes `ConnectionRef.current` on every call, and the returned
 * `FetchLike` reads `connectionRef.current.config?.rateLimit` fresh on every
 * invocation (never cached policy). So an operator's `config.rateLimit` edit
 * takes effect on the very next outbound call through the same cached
 * `FetchLike`, without needing eviction. Evicting on every `update()` would
 * only add churn (throwing away in-flight/queued limiter state for an edit
 * that didn't even touch `rateLimit`). If a future change makes
 * `forConnection()` cache the resolved connection/policy instead of
 * re-reading it live, this note stops being true and `update()` needs its
 * own `evict()` call to match.
 */
export class HttpTransportFactory implements HttpTransportFactoryPort {
  private readonly cache = new Map<string, FetchLike>();
  private readonly connectionRefs = new Map<string, ConnectionRef>();
  /** Every `hostKey`-scoped cache key (`connectionId:hostKey` or bare `connectionId`) built for a connection id, so `evict` can drop them all. */
  private readonly cacheKeysByConnection = new Map<string, Set<string>>();
  private readonly replicas: number;
  private readonly baseFetch: FetchLike;
  private readonly registry: RateLimiterRegistry;

  constructor(deps: HttpTransportFactoryDeps) {
    this.registry = deps.registry;
    this.replicas = deps.replicas && deps.replicas > 0 ? deps.replicas : 1;
    // Bound: an unbound `globalThis.fetch` reference throws "Illegal
    // invocation" when later invoked without its `globalThis` receiver in a
    // browser realm. Node/undici tolerate the unbound form, but this package
    // is nominally environment-neutral (tech-review finding on #1957).
    this.baseFetch = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  forConnection(
    connection: RateLimitedConnection,
    defaultRateLimit?: ConnectionRateLimit,
    hostKey?: string
  ): FetchLike {
    // `hostKey` separates independent rate-limit buckets for a plugin that
    // talks to more than one physical host per connection (#1810 Phase 5 —
    // Allegro's api.allegro.pl vs upload.allegro.pl). Omitted, the cache key
    // is `connection.id` alone — byte-identical to every pre-existing
    // single-host caller (PrestaShop).
    const cacheKey = hostKey ? `${connection.id}:${hostKey}` : connection.id;

    let keysForConnection = this.cacheKeysByConnection.get(connection.id);
    if (!keysForConnection) {
      keysForConnection = new Set();
      this.cacheKeysByConnection.set(connection.id, keysForConnection);
    }
    keysForConnection.add(cacheKey);

    // Keep the ref fresh on every forConnection() call so a cached closure (below)
    // never reads a stale `config.rateLimit` from the connection object it
    // happened to be built with — an operator's config edit must take effect
    // on the very next call through the same cached FetchLike. `defaultRateLimit`
    // is per-cache-key, not per-call: a caller that omits it (e.g. a second
    // call site resolving the same connection/host) must never clobber the value a
    // prior caller established, since every caller shares one cached FetchLike.
    const ref = this.connectionRefs.get(cacheKey);
    if (ref) {
      ref.current = connection;
      ref.defaultRateLimit = defaultRateLimit ?? ref.defaultRateLimit;
    } else {
      this.connectionRefs.set(cacheKey, { current: connection, defaultRateLimit });
    }

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const connectionRef = this.connectionRefs.get(cacheKey)!;
    const fetchImpl: FetchLike = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const rawPolicy: ConnectionRateLimit =
        connectionRef.current.config?.rateLimit ?? connectionRef.defaultRateLimit ?? {};
      const policy = dividePolicy(rawPolicy, this.replicas);
      const limiter = this.registry.get(cacheKey, policy);
      const priority = getCurrentPriority();
      const signal = getCurrentRateLimitSignal();

      const release = await limiter.acquire(policy, priority, signal);
      try {
        const response = await this.baseFetch(input, init);
        if (response.status === 429 || response.status === 503) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
          if (retryAfterMs !== null) {
            limiter.noteRetryAfter(retryAfterMs);
          }
        }
        return response;
      } finally {
        release();
      }
    }) as FetchLike;

    this.cache.set(cacheKey, fetchImpl);
    return fetchImpl;
  }

  evict(connectionId: string): void {
    const cacheKeys = this.cacheKeysByConnection.get(connectionId) ?? new Set([connectionId]);
    for (const cacheKey of cacheKeys) {
      this.cache.delete(cacheKey);
      this.connectionRefs.delete(cacheKey);
      this.registry.evict(cacheKey);
    }
    this.cacheKeysByConnection.delete(connectionId);
  }
}
