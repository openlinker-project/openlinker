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
import { getCurrentPriority } from '../rate-limit';
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
  if (!header) return null;

  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds)) {
    return Math.max(0, asSeconds * 1000);
  }

  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return null;
}

export class HttpTransportFactory implements HttpTransportFactoryPort {
  private readonly cache = new Map<string, FetchLike>();
  private readonly replicas: number;
  private readonly baseFetch: FetchLike;
  private readonly registry: RateLimiterRegistry;

  constructor(deps: HttpTransportFactoryDeps) {
    this.registry = deps.registry;
    this.replicas = deps.replicas && deps.replicas > 0 ? deps.replicas : 1;
    this.baseFetch = deps.fetchImpl ?? globalThis.fetch;
  }

  for(connection: RateLimitedConnection): FetchLike {
    const cached = this.cache.get(connection.id);
    if (cached) {
      return cached;
    }

    const fetchImpl: FetchLike = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const rawPolicy: ConnectionRateLimit = connection.config?.rateLimit ?? {};
      const policy = dividePolicy(rawPolicy, this.replicas);
      const limiter = this.registry.get(connection.id, policy);
      const priority = getCurrentPriority();

      const release = await limiter.acquire(policy, priority);
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

    this.cache.set(connection.id, fetchImpl);
    return fetchImpl;
  }
}
