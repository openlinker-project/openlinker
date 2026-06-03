/**
 * DPD Polska DPDServices HTTP Client
 *
 * Native-`fetch` transport for the DPDServices REST API (mirrors
 * `InpostHttpClient` — the established shipping precedent; no axios). Attaches
 * HTTP Basic auth (`Authorization: Basic base64(login:password)`) plus the
 * optional `X-DPD-FID` header (provisional, OQ-2), applies a jittered retry
 * loop, enforces a request timeout, and maps DPDServices error bodies to domain
 * exceptions.
 *
 * **Retry asymmetry (guards double-COD).** HTTP `429` / `5xx` mean DPD did NOT
 * commit, so they are always retried. A **network/timeout** is retried ONLY
 * when the caller opts in (`retryOnNetworkError`) — true for the idempotent
 * label render, false for the create (`generatePackagesNumbers`), where a
 * blind retry after a committed-but-lost response would mint a second waybill
 * and a second COD charge. Non-retryable failures (`401`/`403` → unauthorized,
 * `4xx` → `ShippingProviderRejectionException`) throw immediately; a retryable
 * failure that exhausts the budget surfaces as `DpdNetworkException`.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@openlinker/shared/logging';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type { DpdError401, DpdErrorItem, DpdErrors } from '../../domain/types/dpd-rest.types';
import { DpdUnauthorizedException } from '../../domain/exceptions/dpd-unauthorized.exception';
import { DpdNetworkException } from '../../domain/exceptions/dpd-network.exception';
import type { DpdHttpAuth, DpdRequestOptions, IDpdHttpClient } from './dpd-http-client.interface';

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

const DPD_BRAND = 'dpd';

/**
 * Internal marker for retryable transport failures (429 / 503 always; ambiguous
 * 5xx + network only for idempotent calls). Never escapes the client — the
 * retry loop converts it to `DpdNetworkException` once the budget is exhausted.
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

export class DpdHttpClient implements IDpdHttpClient {
  private readonly logger = new Logger(DpdHttpClient.name);
  private readonly retryConfig: RetryConfig;
  private readonly authorizationHeader: string;

  constructor(
    private readonly baseUrl: string,
    private readonly auth: DpdHttpAuth,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    const token = Buffer.from(`${auth.login}:${auth.password}`, 'utf8').toString('base64');
    this.authorizationHeader = `Basic ${token}`;
  }

  async request<T>(options: DpdRequestOptions): Promise<T> {
    const requestId = randomUUID();
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeOnce<T>(options);
      } catch (error) {
        if (!(error instanceof RetryableHttpError)) {
          // Non-retryable (unauthorized / rejection) OR a network error on a
          // non-idempotent call (already converted to DpdNetworkException in
          // fetchOnce) — propagate without retry.
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw new DpdNetworkException(error.message, error);
        }
        const waitMs = error.retryAfterMs ?? this.jitter(delay);
        this.logger.warn(
          `DPDServices ${options.method} ${options.path} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}); retrying in ${waitMs}ms [requestId=${requestId}]`,
        );
        await this.sleep(waitMs);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
      }
    }

    // Unreachable: the final attempt either returns or throws above.
    throw new DpdNetworkException('DPDServices request exhausted its retry budget');
  }

  private async executeOnce<T>(options: DpdRequestOptions): Promise<T> {
    const response = await this.fetchOnce(options);

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
      throw new DpdNetworkException('DPDServices returned an unparseable response body', error);
    }
  }

  private async fetchOnce(options: DpdRequestOptions): Promise<Response> {
    const url = new URL(options.path, this.baseUrl).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Authorization: this.authorizationHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.auth.masterFid) {
      headers['X-DPD-FID'] = this.auth.masterFid;
    }

    try {
      return await fetch(url, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = `DPDServices network error: ${(error as Error).message}`;
      // Idempotent reads may retry; the non-idempotent create must NOT
      // (double-waybill / double-COD), so it throws a terminal network error.
      if (options.idempotent) {
        throw new RetryableHttpError(message);
      }
      throw new DpdNetworkException(message, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Map a non-ok DPDServices response to the right domain exception. No-op on ok. */
  private async throwIfNotOk(response: Response, options: DpdRequestOptions): Promise<void> {
    if (response.ok) {
      return;
    }

    const errorBody = await this.safeParseError(response);
    const message = errorMessage(errorBody, options, response.status);

    if (response.status === 401 || response.status === 403) {
      throw new DpdUnauthorizedException(message);
    }
    if (response.status === 429 || response.status === 503) {
      // Rate-limited / unavailable: DPD did NOT process the request, so a retry
      // can't double-create — always retryable, regardless of idempotency.
      throw new RetryableHttpError(
        message,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    if (response.status >= 500) {
      // Ambiguous 5xx (500/502/504): the request may have committed server-side.
      // Retry only idempotent reads; a non-idempotent create treats it as an
      // indeterminate outcome (reconcile, don't re-POST) to avoid double-COD.
      if (options.idempotent) {
        throw new RetryableHttpError(message, response.status);
      }
      throw new DpdNetworkException(message);
    }
    const first = firstErrorItem(errorBody);
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      first?.code ?? null,
      message,
      first ? { field: first.field, subCode: first.subCode } : undefined,
    );
  }

  private async safeParseError(response: Response): Promise<DpdErrors | DpdError401 | undefined> {
    try {
      const text = await response.text();
      if (!text) {
        return undefined;
      }
      const data: unknown = JSON.parse(text);
      return data as DpdErrors | DpdError401;
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

/** First structured error item from a `DpdErrors` body, if present. */
function firstErrorItem(body: DpdErrors | DpdError401 | undefined): DpdErrorItem | undefined {
  const errors = (body as DpdErrors | undefined)?.errors;
  return errors && errors.length > 0 ? errors[0] : undefined;
}

function errorMessage(
  body: DpdErrors | DpdError401 | undefined,
  options: DpdRequestOptions,
  status: number,
): string {
  const first = (body as DpdErrors | undefined)?.errors?.[0];
  if (first?.userMessage) {
    return first.userMessage;
  }
  const status401 = (body as DpdError401 | undefined)?.status;
  if (status401) {
    return status401;
  }
  return `DPDServices ${options.method} ${options.path} failed (${status})`;
}
