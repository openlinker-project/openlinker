/**
 * Mirakl HTTP Client Types
 *
 * Transport-layer types for `MiraklHttpClient`: retry configuration, request
 * options, the response envelope, the file-upload shape used by the CSV
 * imports, and the two page envelopes Mirakl paginates with.
 *
 * @module libs/integrations/mirakl/src/infrastructure/http
 */

/** The methods the Mirakl Seller API uses. */
export type MiraklHttpMethod = 'GET' | 'POST' | 'PUT';

/** Bounded in-request retry. The sync runner is the second retry tier. */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

/** Same modest budget as the Erli client: 3 retries, 500 ms to 8 s jittered. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
};

/** A query value; `undefined` is dropped, an array repeats the parameter. */
export type MiraklQueryValue =
  | string
  | number
  | boolean
  | undefined
  | ReadonlyArray<string | number | boolean>;

export interface MiraklRequestOptions {
  queryParams?: Readonly<Record<string, MiraklQueryValue>>;
  /** Per-attempt timeout override (ms); defaults to 30 s. */
  timeoutMs?: number;
  /**
   * Marks a POST safe to retry on 5xx or a transport failure. GET and PUT are
   * idempotent by HTTP semantics regardless of this flag. File uploads never
   * retry on those failures: a re-sent import could be applied twice.
   */
  idempotent?: boolean;
}

export interface MiraklHttpResponse<T> {
  status: number;
  data: T;
}

/** One CSV file sent as `multipart/form-data` (STO01, PRI01, P41, OF01). */
export interface MiraklFileUpload {
  /** Form field name Mirakl expects, `file` for every Seller API import. */
  fieldName: string;
  fileName: string;
  contentType: string;
  content: string;
}

/** Offset-paginated list (OR11, OF21, P31): items under a resource key. */
export type MiraklOffsetPage = Readonly<Record<string, unknown>> & {
  readonly total_count?: number;
};

/** Seek-paginated list (OF02, RT11, PRI02). */
export interface MiraklSeekPage<T> {
  readonly data?: readonly T[];
  readonly next_page_token?: string | null;
}
