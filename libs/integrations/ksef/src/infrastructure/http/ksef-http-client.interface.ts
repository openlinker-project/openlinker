/**
 * KSeF HTTP Client Port
 *
 * Narrow transport contract the KSeF capability adapters code against. Keeping
 * it an interface — not a concrete client — lets adapter unit specs mock KSeF
 * HTTP without a real `fetch`, per engineering-standards § "Interface and
 * Implementation Separation".
 *
 * STUB for C2: the concrete `KsefHttpClient` implementing this contract (auth
 * header injection, retry/backoff, structured logging) lands in C3. Credentials
 * are wired into the client at construction time (resolved via the host's
 * `CredentialsResolverPort` in the factory) — the method signatures here make
 * no credential assumptions, so the transport stays agnostic of the auth mode.
 *
 * Package-private: consumed only by the in-package `KsefAdapterFactory` (C3+)
 * via relative import; intentionally NOT re-exported from the package barrel
 * (siblings keep their clients private too).
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
export interface IKsefHttpClient {
  /** GET — idempotent; transient `5xx`/network failures are retried (C3). */
  get<T>(path: string): Promise<T>;

  /**
   * POST — non-idempotent by default: a `5xx`/network failure fails fast (no
   * retry) unless the caller opts in. Used for document submission (C3+).
   */
  post<T>(path: string, body?: unknown): Promise<T>;
}
