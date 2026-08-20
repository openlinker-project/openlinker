/**
 * eparagony.pl HTTP Client Port
 *
 * Narrow transport contract the fiscalization adapter codes against, so its unit
 * specs can drive the whole registration lifecycle without a real `fetch`.
 *
 * Package-private: consumed by the in-package factory and adapters via relative
 * import, and NOT re-exported from the package barrel (siblings keep their
 * clients private too).
 *
 * @module libs/integrations/eparagony/src/infrastructure/http
 */
import type {
  EparagonyHttpResponse,
  EparagonyRequestOptions,
} from './eparagony-http-client.types';

export interface IEparagonyHttpClient {
  /** Authenticated GET against the documents API. Idempotent; retried on 5xx/network. */
  get<T>(path: string, options?: EparagonyRequestOptions): Promise<EparagonyHttpResponse<T>>;

  /**
   * Authenticated POST against the documents API. Non-idempotent by default;
   * pass `options.idempotent` only when an `Idempotency-Key` header makes a
   * re-issue provably safe.
   */
  post<T>(
    path: string,
    body: unknown,
    options?: EparagonyRequestOptions,
  ): Promise<EparagonyHttpResponse<T>>;

  /**
   * Force the next call to acquire a fresh bearer token. Used by the connection
   * tester so a "Test connection" click genuinely exercises the credentials
   * rather than replaying a cached token.
   */
  invalidateToken(): void;

  /**
   * Acquire (or reuse) a bearer token without issuing an API call. Exercises the
   * credentials and the granted scope set on its own.
   */
  ensureToken(): Promise<void>;
}
