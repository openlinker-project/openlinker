/**
 * InPost ShipX HTTP Client
 *
 * Native-`fetch` transport for the ShipX REST API (mirrors `AllegroHttpClient`
 * — the established in-tree precedent; no axios). Attaches the static Bearer
 * API token, applies a jittered retry loop for `429` / `5xx` / network errors
 * (respecting `Retry-After`), enforces a request timeout, and maps ShipX error
 * bodies to domain exceptions. Non-retryable `4xx` (401/403 → unauthorized,
 * other → `ShippingProviderRejectionException`) throw immediately; retryable
 * failures that exhaust the budget surface as `InpostNetworkException`.
 *
 * @module libs/integrations/inpost/src/infrastructure/http
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@openlinker/shared/logging';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type { ShipXErrorBody } from '../../domain/types/inpost-shipx.types';
import { InpostUnauthorizedException } from '../../domain/exceptions/inpost-unauthorized.exception';
import { InpostNetworkException } from '../../domain/exceptions/inpost-network.exception';
import type {
  IInpostHttpClient,
  InpostBinaryResponse,
  InpostRequestOptions,
} from './inpost-http-client.interface';

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
};

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Internal marker for retryable transport failures (429 / 5xx / network).
 * Never escapes the client — the retry loop converts it to
 * `InpostNetworkException` once the budget is exhausted.
 */
class RetryableHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableHttpError';
  }
}

export class InpostHttpClient implements IInpostHttpClient {
  private readonly logger = new Logger(InpostHttpClient.name);
  private readonly retryConfig: RetryConfig;

  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  async request<T>(options: InpostRequestOptions): Promise<T> {
    return this.withRetry(options, (opts) => this.executeOnce<T>(opts));
  }

  async requestBinary(options: InpostRequestOptions): Promise<InpostBinaryResponse> {
    return this.withRetry(options, (opts) => this.executeBinaryOnce(opts));
  }

  /**
   * Shared retry loop: runs `exec` up to `maxRetries + 1` times, retrying only
   * on the internal `RetryableHttpError` marker (429 / 5xx / network), honoring
   * `Retry-After`, and converting an exhausted budget to `InpostNetworkException`.
   */
  private async withRetry<R>(
    options: InpostRequestOptions,
    exec: (options: InpostRequestOptions) => Promise<R>,
  ): Promise<R> {
    const requestId = randomUUID();
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await exec(options);
      } catch (error) {
        if (!(error instanceof RetryableHttpError)) {
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw new InpostNetworkException(error.message, error);
        }
        const waitMs = error.retryAfterMs ?? this.jitter(delay);
        this.logger.warn(
          `ShipX ${options.method} ${options.path} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}); retrying in ${waitMs}ms [requestId=${requestId}]`,
        );
        await this.sleep(waitMs);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
      }
    }

    // Unreachable: the final attempt either returns or throws above.
    throw new InpostNetworkException('ShipX request exhausted its retry budget');
  }

  private async executeOnce<T>(options: InpostRequestOptions): Promise<T> {
    const response = await this.fetchOnce(options);

    // Error handling runs FIRST (throws on !ok) so a binary call never feeds
    // bytes to the error parser and a JSON call never parses an error body as data.
    await this.throwIfNotOk(response, options);

    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      const data: unknown = JSON.parse(text);
      return data as T;
    } catch (error) {
      throw new InpostNetworkException('ShipX returned an unparseable response body', error);
    }
  }

  private async executeBinaryOnce(options: InpostRequestOptions): Promise<InpostBinaryResponse> {
    const response = await this.fetchOnce(options);
    await this.throwIfNotOk(response, options);

    const body = new Uint8Array(await response.arrayBuffer());
    return {
      body,
      contentType: response.headers.get('content-type')?.toLowerCase() ?? '',
    };
  }

  private async fetchOnce(options: InpostRequestOptions): Promise<Response> {
    const url = this.buildUrl(options.path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RetryableHttpError(`ShipX network error: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Map a non-ok ShipX response to the right domain exception. No-op on ok. */
  private async throwIfNotOk(response: Response, options: InpostRequestOptions): Promise<void> {
    if (response.ok) {
      return;
    }

    const errorBody = await this.safeParseError(response);
    const message =
      errorBody?.message ?? `ShipX ${options.method} ${options.path} failed (${response.status})`;

    if (response.status === 401 || response.status === 403) {
      throw new InpostUnauthorizedException(message);
    }
    if (response.status === 429) {
      throw new RetryableHttpError(
        message,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    if (response.status >= 500) {
      throw new RetryableHttpError(message, response.status);
    }
    const flatDetails = flattenShipXFieldErrors(errorBody?.details);
    throw new ShippingProviderRejectionException(
      'inpost',
      firstDetailKey(flatDetails),
      message,
      Object.keys(flatDetails).length > 0 ? { fieldErrors: flatDetails } : undefined,
    );
  }

  private buildUrl(path: string, query?: InpostRequestOptions['query']): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          // ShipX list params use the Rails bracket form (`shipment_ids[]=1`).
          for (const item of value) {
            url.searchParams.append(`${key}[]`, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async safeParseError(response: Response): Promise<ShipXErrorBody | undefined> {
    try {
      const text = await response.text();
      if (!text) {
        return undefined;
      }
      const data: unknown = JSON.parse(text);
      return data as ShipXErrorBody;
    } catch {
      return undefined;
    }
  }

  private jitter(delayMs: number): number {
    return Math.round(delayMs * (0.5 + Math.random() * 0.5));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Pick the first field key from a (flattened) ShipX per-field error map to use
 * as the rejection's `providerCode`. The closest thing ShipX surfaces to a
 * typed error code is the field that triggered the rejection (e.g.
 * `'target_point'`, `'sender'`, `'parcels'`). Returns `null` when no details
 * are available.
 */
function firstDetailKey(
  details: Record<string, readonly string[]> | undefined,
): string | null {
  if (!details) return null;
  const keys = Object.keys(details);
  return keys.length > 0 ? keys[0] : null;
}

/**
 * Normalise ShipX's `details` map to a single flat, leaf-keyed
 * `{ field: string[] }` shape. ShipX uses two shapes depending on the
 * rejected field (confirmed live against the sandbox, #1807):
 *
 * - flat, for simple top-level fields: `{ name: ["required"] }`
 * - nested, for compound/array request fields: `{ custom_attributes: [{
 *   target_point: ["does_not_exist"] }] }` — a paczkomat rejection surfaces
 *   this way because `target_point` lives inside `custom_attributes` on the
 *   wire (`buildLockerRequest`).
 *
 * Without this normalisation, `firstDetailKey` picked the *outer* key
 * (`'custom_attributes'`) instead of the actual offending field
 * (`'target_point'`), which broke the `target_point` → "pick another locker"
 * re-tag in `InpostShippingAdapter.generateLabel` (#885) for exactly the case
 * it was built for.
 *
 * Messages for a repeated leaf key (the same field rejected across multiple
 * array items, or a flat top-level key that also appears nested) are merged
 * rather than overwritten, so the FE's `StructuredErrorList` (#1812) shows
 * every rejected sub-field instead of just the last one seen.
 *
 * Nesting is flattened exactly one level deep — the only two shapes ShipX is
 * confirmed to emit live (#1807). A hypothetical doubly-nested `details`
 * (`{ a: [{ b: [{ c: [...] }] }] }`) is a conscious non-goal: the inner value
 * is an array of objects, fails the string-array guard, and is dropped rather
 * than recursed, so no unproven shape is over-generalised for.
 */
function flattenShipXFieldErrors(
  details: ShipXErrorBody['details'],
): Record<string, readonly string[]> {
  if (!details) return {};
  const flat: Record<string, string[]> = {};
  const mergeInto = (fieldKey: string, messages: readonly string[]): void => {
    flat[fieldKey] = [...(flat[fieldKey] ?? []), ...messages];
  };
  for (const [key, value] of Object.entries(details)) {
    if (!Array.isArray(value)) {
      continue;
    }
    if (value.every((item): item is string => typeof item === 'string')) {
      mergeInto(key, value);
      continue;
    }
    for (const item of value) {
      if (item === null || typeof item !== 'object') {
        continue;
      }
      const nestedFieldErrors = item as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nestedFieldErrors)) {
        if (Array.isArray(nestedValue) && nestedValue.every((m) => typeof m === 'string')) {
          mergeInto(nestedKey, nestedValue as readonly string[]);
        }
      }
    }
  }
  return flat;
}
