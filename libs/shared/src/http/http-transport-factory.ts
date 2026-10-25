/**
 * Http Transport Factory
 *
 * Resolves a connection's live `config.rateLimit` and wraps the underlying
 * transport so every call acquires a rate-limit slot first and releases it
 * in a `finally`. A `429`/`503` response's `Retry-After` header feeds back
 * into the limiter's pacing — this is a pass-through wrapper, not a retry
 * engine, so the response itself is returned to the caller unmodified.
 *
 * `replicas` (optional constructor dep, divides the policy — #1810) is kept
 * for callers that still want static division, but the DI wiring
 * (`libs/plugin-sdk/src/rate-limit.module.ts`) no longer passes it: since
 * #2015 the registry is Redis-backed and already shared across every
 * process/replica, so dividing further would only shrink the operator's
 * configured cap.
 *
 * Shared buckets (ADR-038 § Amendment): a plugin whose remote scopes its quota
 * wider than a credential passes `options.bucketKey`, and every connection
 * naming the same key paces against ONE limiter. The cached `FetchLike` is
 * then keyed by connection id AND bucket key, so a call site asking for a
 * different bucket can never be handed a closure bound to the wrong one, and
 * the policy is `tightenRateLimit(defaultRateLimit, config.rateLimit)`: the
 * plugin's ceiling, which a connection's own config can only lower. One
 * acquire, not two - a stricter connection's acquire claims against its own
 * lower cap and advances the shared pacing key by its own longer interval,
 * which can only slow the shared bucket, never speed it up. A second limiter
 * on the connection id would be the exact alternative and was not worth its
 * deadlock-ordering and double-release surface for a knob that is a safety
 * valve, not a fairness tool.
 *
 * @module libs/shared/src/http
 */
import type { RateLimiterRegistry } from '../rate-limit';
import { getCurrentPriority, getCurrentRateLimitSignal, tightenRateLimit } from '../rate-limit';
import type { ConnectionRateLimit } from '../rate-limit';
import type {
  FetchLike,
  ForConnectionOptions,
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
  /** Keyed by {@link cacheKeyFor}: the bare connection id for the default bucket. */
  private readonly cache = new Map<string, FetchLike>();
  private readonly connectionRefs = new Map<string, ConnectionRef>();
  /** Shared-bucket cache keys per connection id, so `evict()` can find them. */
  private readonly sharedCacheKeys = new Map<string, Set<string>>();
  /** Connection ids drawing from each shared bucket, so the last one out evicts it. */
  private readonly sharedBucketUsers = new Map<string, Set<string>>();
  private readonly replicas: number;
  private readonly baseFetch: FetchLike;
  private readonly registry: RateLimiterRegistry;

  constructor(deps: HttpTransportFactoryDeps) {
    this.registry = deps.registry;
    this.replicas = deps.replicas && deps.replicas > 0 ? deps.replicas : 1;
    // Late-bound: the default transport resolves `globalThis.fetch` on every
    // call, not once at construction. The factory is a `@Global()` singleton
    // built at app boot, so capturing the reference eagerly would make a later
    // `global.fetch` swap (how integration tests stub an adapter's outbound
    // call) silently bypassed — the call would escape to the real network.
    // Invoking it as a method of `globalThis` also keeps the receiver correct,
    // which an unbound reference loses ("Illegal invocation" in a browser
    // realm; Node/undici tolerate it, but this package is environment-neutral).
    this.baseFetch = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  forConnection(
    connection: RateLimitedConnection,
    defaultRateLimit?: ConnectionRateLimit,
    options?: ForConnectionOptions
  ): FetchLike {
    // Keyed on the connection id alone unless the plugin names a shared
    // bucket - one bucket per connection, never per host. See the port doc +
    // ADR-038 § "The cap is per connection" and § Amendment.
    //
    // Keep the ref fresh on every forConnection() call so a cached closure (below)
    // never reads a stale `config.rateLimit` from the connection object it
    // happened to be built with — an operator's config edit must take effect
    // on the very next call through the same cached FetchLike. `defaultRateLimit`
    // is per-connection-id, not per-call: a caller that omits it (e.g. a second
    // call site resolving the same connection) must never clobber the value a
    // prior caller established, since every caller shares one cached FetchLike.
    const ref = this.connectionRefs.get(connection.id);
    if (ref) {
      ref.current = connection;
      ref.defaultRateLimit = defaultRateLimit ?? ref.defaultRateLimit;
    } else {
      this.connectionRefs.set(connection.id, { current: connection, defaultRateLimit });
    }

    // An empty string is no bucket name at all; treating it as one would pool
    // every connection that passed it by mistake into one silent bucket.
    const sharedBucketKey =
      options?.bucketKey !== undefined && options.bucketKey.length > 0
        ? options.bucketKey
        : undefined;
    const cacheKey = cacheKeyFor(connection.id, sharedBucketKey);

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const connectionRef = this.connectionRefs.get(connection.id)!;
    const fetchImpl: FetchLike = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const configured = connectionRef.current.config?.rateLimit;
      const rawPolicy: ConnectionRateLimit =
        sharedBucketKey === undefined
          ? configured ?? connectionRef.defaultRateLimit ?? {}
          : tightenRateLimit(connectionRef.defaultRateLimit, configured);
      const policy = dividePolicy(rawPolicy, this.replicas);
      const limiter = this.registry.get(sharedBucketKey ?? connectionRef.current.id, policy);
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
    if (sharedBucketKey !== undefined) {
      addToSet(this.sharedCacheKeys, connection.id, cacheKey);
      addToSet(this.sharedBucketUsers, sharedBucketKey, connection.id);
    }
    return fetchImpl;
  }

  evict(connectionId: string): void {
    this.cache.delete(connectionId);
    this.connectionRefs.delete(connectionId);
    this.registry.evict(connectionId);

    for (const cacheKey of this.sharedCacheKeys.get(connectionId) ?? []) {
      this.cache.delete(cacheKey);
    }
    this.sharedCacheKeys.delete(connectionId);

    // A shared bucket outlives any one of its connections: evicting it while a
    // sibling still paces on it would reset the in-process limiter that sibling
    // is queued on (and, on the in-memory registry, the pacing state itself).
    for (const [bucketKey, users] of this.sharedBucketUsers) {
      if (!users.delete(connectionId)) continue;
      if (users.size === 0) {
        this.sharedBucketUsers.delete(bucketKey);
        this.registry.evict(bucketKey);
      }
    }
  }
}

/**
 * The default bucket's cache key is the bare connection id - unchanged, so
 * every plugin that never names a bucket keeps exactly its previous entry. A
 * shared bucket appends the key after a NUL, which no connection id carries.
 */
function cacheKeyFor(connectionId: string, sharedBucketKey: string | undefined): string {
  return sharedBucketKey === undefined ? connectionId : `${connectionId}\u0000${sharedBucketKey}`;
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
  } else {
    map.set(key, new Set([value]));
  }
}
