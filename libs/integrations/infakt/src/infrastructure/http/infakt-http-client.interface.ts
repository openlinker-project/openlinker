/**
 * Infakt HTTP Client Port
 *
 * Transport contract the Infakt capability adapter codes against. Keeping it
 * an interface — not the concrete `InfaktHttpClient` — lets adapter unit
 * specs substitute an in-memory fake without a real `fetch`, per
 * engineering-standards § "Interface and Implementation Separation".
 *
 * Package-private: consumed only by the in-package factory + adapter via
 * relative import; intentionally NOT re-exported from the package barrel
 * (mirrors the KSeF `IKsefHttpClient` precedent).
 *
 * @module libs/integrations/infakt/src/infrastructure/http
 */
/** Raw bytes + provider-reported content type for a binary (non-JSON) response. */
export interface InfaktBinaryResponse {
  data: Uint8Array;
  contentType: string;
}

export interface IInfaktHttpClient {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  /** Fetch a binary response (e.g. a PDF) rather than parsing JSON. */
  getBinary(path: string, query?: Record<string, string>): Promise<InfaktBinaryResponse>;
}
