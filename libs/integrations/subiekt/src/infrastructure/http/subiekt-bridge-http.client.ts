/**
 * Subiekt Bridge HTTP Client (#753)
 *
 * The REAL transport implementing the frozen `SubiektBridgeClient` against the
 * local Windows bridge (#752), over native `fetch` + `AbortController`.
 *
 * SECURITY / FISCAL-SAFETY responsibilities:
 *   - Construction-time URL validation via `isBridgeUrlSafe` (imported from
 *     `./subiekt-url-safety` — NOT from the DTO) -> throws `SubiektConfigException`.
 *     Defense-in-depth on top of the config-time DTO guard; every construction
 *     site must handle the throw.
 *   - `redirect: 'manual'`; each 3xx `Location` host is re-checked with
 *     `isBridgeUrlSafe` (the live-request SSRF vector construction-time
 *     validation does not cover).
 *   - `idempotencyKey` (when present) is placed on the request body BEFORE the
 *     fetch, so it is present on every error branch (fiscal dedup hinges on it).
 *   - Concrete retryability phase classification (see error translation below):
 *     the only layer that sees the raw fetch error classifies `'safe'` vs
 *     `'indeterminate'` by inspecting `error.cause?.code`. The frozen
 *     `SubiektBridgeUnreachableError` cannot carry phase, so we throw a
 *     client-private subclass `SubiektBridgeUnreachableWithPhaseError` (still
 *     `instanceof SubiektBridgeUnreachableError`, keeping the contract suite and
 *     fake compatible).
 *
 * Optional `Authorization` / `x-bridge-token` header from `token` — NEVER logged.
 * A 401/403 from the bridge is a BRIDGE AUTH / CONFIG problem (bad/missing
 * token), NOT a fiscal rejection: it surfaces as a terminal
 * `SubiektBridgeAuthError` (never the rejected-invoice path), the token is never
 * read back or logged. Other 4xx keep the `SubiektRejectedError` behavior.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http
 */
import { Logger } from '@openlinker/shared/logging';
import type { SubiektBridgeClient } from '../../bridge/subiekt-bridge.client';
import {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from '../../bridge/subiekt-bridge.errors';
import type {
  BridgeInvoiceStatusRequest,
  BridgeInvoiceStatusResponse,
  BridgeIssueInvoiceRequest,
  BridgeIssueInvoiceResponse,
  BridgeKorektaRequest,
  BridgeKorektaResponse,
  BridgeRegulatoryStatus,
  BridgeResponseEnvelope,
  BridgeUpsertCustomerRequest,
  BridgeUpsertCustomerResponse,
} from '../../bridge/subiekt-bridge.types';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import type { SubiektTransportRetryability } from '../../domain/types/subiekt-transport-retryability.types';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { isBridgeUrlSafe } from './subiekt-url-safety';

/**
 * Node error codes that PROVE the request never left the host (connect-refused
 * / DNS-failure). Only these are classified `'safe'` — auto-retry cannot
 * double-issue a fiscal document. Everything else is `'indeterminate'`.
 */
const SAFE_RETRY_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** Extract a `cause.code` string from an unknown thrown value, if present. */
function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  // AbortError surfaces via `name` rather than a cause code.
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return 'ABORT';
  return undefined;
}

/** Map a raw fetch error code to the fiscal-safety retryability phase. */
function classifyRetryability(code: string | undefined): SubiektTransportRetryability {
  return code !== undefined && SAFE_RETRY_CODES.has(code) ? 'safe' : 'indeterminate';
}

/**
 * Bridge REST surface, reconciled against the live bridge's minimal-API routes
 * (`Subiekt.Bridge.Api/Endpoints/*`): the bridge exposes Polish-noun routes
 * under the `/api/*` prefix (which it guards with `X-Api-Key`); `/health` is
 * anonymous and stays outside the prefix. The configured bridge base URL must
 * NOT include `/api` — these paths carry it.
 */
export const SUBIEKT_BRIDGE_ENDPOINTS = {
  issueInvoice: '/api/faktury',
  /**
   * Correction (faktura korygująca) endpoint, templated by the ORIGINAL document's
   * numeric id. The bridge route is `POST /api/faktury/{origId}/korekta`.
   */
  issueCorrection: (origId: number): string => `/api/faktury/${origId}/korekta`,
  upsertCustomer: '/api/kontrahenci/upsert',
  /** Templated by `providerInvoiceId`; the bridge route is `GET /api/faktury/{id}/status`. */
  invoiceStatus: (providerInvoiceId: string): string =>
    `/api/faktury/${encodeURIComponent(providerInvoiceId)}/status`,
  health: '/health',
} as const;

/**
 * The `data` payload the bridge's `GET /api/faktury/{id}/status` returns (a
 * superset of what we project): the KSeF `regulatoryStatus` plus a Polish
 * document `status`. We only read `regulatoryStatus`; the rest is ignored.
 */
interface BridgeInvoiceStatusData {
  regulatoryStatus: BridgeRegulatoryStatus;
  status?: string;
}

/** Options for the HTTP client. */
export interface SubiektBridgeHttpClientOptions {
  /** Optional bridge token — never logged. */
  token?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Client-private subclass of the frozen unreachable error that carries the
 * retryability phase across the frozen-error boundary. IS-A
 * `SubiektBridgeUnreachableError`, so contract-suite / `instanceof` checks and
 * the fake remain valid. NOT exported from the package barrel.
 */
export class SubiektBridgeUnreachableWithPhaseError extends SubiektBridgeUnreachableError {
  readonly retryability: SubiektTransportRetryability;

  constructor(message: string, retryability: SubiektTransportRetryability) {
    super(message);
    this.name = 'SubiektBridgeUnreachableWithPhaseError';
    this.retryability = retryability;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SubiektBridgeHttpClient implements SubiektBridgeClient {
  private readonly logger = new Logger(SubiektBridgeHttpClient.name);
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(bridgeBaseUrl: string, opts: SubiektBridgeHttpClientOptions = {}) {
    // Defense-in-depth SSRF guard: reject a bad / IMDS bridge URL at
    // construction time (on top of the config-time DTO guard).
    if (!isBridgeUrlSafe(bridgeBaseUrl)) {
      throw new SubiektConfigException(
        'bridgeBaseUrl is missing, malformed, or points at a disallowed (cloud-metadata) address',
        'bridgeBaseUrl',
        bridgeBaseUrl,
      );
    }
    // Strip a single trailing slash so path concatenation stays canonical.
    this.baseUrl = bridgeBaseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 30000;
  }

  async issueInvoice(req: BridgeIssueInvoiceRequest): Promise<BridgeIssueInvoiceResponse> {
    return this.postJson<BridgeIssueInvoiceResponse>(
      SUBIEKT_BRIDGE_ENDPOINTS.issueInvoice,
      req,
    );
  }

  async issueCorrection(origId: number, req: BridgeKorektaRequest): Promise<BridgeKorektaResponse> {
    return this.postJson<BridgeKorektaResponse>(
      SUBIEKT_BRIDGE_ENDPOINTS.issueCorrection(origId),
      req,
    );
  }

  async upsertCustomer(req: BridgeUpsertCustomerRequest): Promise<BridgeUpsertCustomerResponse> {
    return this.postJson<BridgeUpsertCustomerResponse>(
      SUBIEKT_BRIDGE_ENDPOINTS.upsertCustomer,
      req,
    );
  }

  async getInvoiceStatus(req: BridgeInvoiceStatusRequest): Promise<BridgeInvoiceStatusResponse> {
    // The status endpoint's `data` carries `regulatoryStatus` and a Polish
    // document `status` (e.g. "zatwierdzony") but NO `state` field. A document
    // that reads back at all has been issued, so derive `state: 'issued'`.
    const data = await this.getJson<BridgeInvoiceStatusData>(
      SUBIEKT_BRIDGE_ENDPOINTS.invoiceStatus(req.providerInvoiceId),
    );
    return {
      state: 'issued',
      regulatoryStatus: data.regulatoryStatus ?? 'none',
    };
  }

  /**
   * Connectivity probe for the connection tester. Issues `GET /health` and
   * resolves when the bridge is reachable (any non-transport response, incl. a
   * 4xx). Rejects with `SubiektBridgeUnreachableError` / `SubiektConfigException`
   * only when the bridge could not be reached. Not part of the frozen
   * `SubiektBridgeClient` surface.
   */
  async checkHealth(): Promise<void> {
    try {
      await this.getJson<unknown>(SUBIEKT_BRIDGE_ENDPOINTS.health);
    } catch (error: unknown) {
      // A business rejection means the bridge IS reachable — a passing probe.
      if (error instanceof SubiektRejectedError) {
        return;
      }
      throw error;
    }
  }

  // --- transport internals ----------------------------------------------------

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    if (this.token !== undefined && this.token.length > 0) {
      // Bridge token — NEVER logged.
      headers.authorization = `Bearer ${this.token}`;
      headers['x-bridge-token'] = this.token;
    }
    return headers;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.buildHeaders(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error: unknown) {
      // Transport-level failure — never reached Subiekt's business layer.
      const code = extractErrorCode(error);
      const retryability = classifyRetryability(code);
      this.logger.warn('Subiekt bridge request failed at transport layer', {
        method,
        path,
        code,
        retryability,
      });
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt bridge is unreachable (${code ?? 'unknown'})`,
        retryability,
      );
    } finally {
      clearTimeout(timer);
    }

    // Manual redirect handling — re-check each hop's Location host with the
    // SSRF predicate (the live-request vector construction-time cannot cover).
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location !== null && !isBridgeUrlSafe(location)) {
        throw new SubiektConfigException(
          'Subiekt bridge redirected to a disallowed (cloud-metadata) address',
          'bridgeBaseUrl',
          location,
        );
      }
      // A redirect we did not follow is treated as an unreachable transport
      // ambiguity — fiscal-safe `'indeterminate'`.
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt bridge returned an unfollowed redirect (HTTP ${response.status})`,
        'indeterminate',
      );
    }

    if (response.status >= 500) {
      // The POST may have been received and acted on — `'indeterminate'`.
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt bridge returned a server error (HTTP ${response.status})`,
        'indeterminate',
      );
    }

    if (response.status === 401 || response.status === 403) {
      // BRIDGE AUTH / CONFIG problem (bad/missing token or credentials) — NOT a
      // fiscal rejection. Surface a clear, terminal auth error; never read or
      // log the body/token.
      throw new SubiektBridgeAuthError(response.status);
    }

    if (response.status >= 400) {
      // Business rejection — terminal. Surface the bridge-native rejected error.
      const reason = await this.readRejectionReason(response);
      throw new SubiektRejectedError(reason);
    }

    // 2xx — the bridge wraps EVERY response in `{ success, data, error }`. Unwrap
    // it: a `success: false` envelope (e.g. a 200/422 validation result) is a
    // terminal business rejection carrying `error.reason`; otherwise return `data`.
    const envelope = (await response.json()) as BridgeResponseEnvelope<T>;
    if (!envelope.success || envelope.data === null) {
      const reason =
        envelope.error?.reason !== undefined && envelope.error.reason.length > 0
          ? envelope.error.reason
          : `HTTP ${response.status}`;
      throw new SubiektRejectedError(reason);
    }
    return envelope.data;
  }

  /**
   * Read a human reason from a non-2xx response. The bridge returns its error
   * inside the envelope's `error.reason`; fall back to a bare top-level `reason`
   * and finally to the status code.
   */
  private async readRejectionReason(response: Response): Promise<string> {
    try {
      const parsed: unknown = await response.json();
      if (typeof parsed === 'object' && parsed !== null) {
        // Enveloped error: { success, data, error: { code, reason } }.
        const envelopeError = (parsed as { error?: { reason?: unknown } }).error;
        if (
          envelopeError !== undefined &&
          envelopeError !== null &&
          typeof envelopeError.reason === 'string' &&
          envelopeError.reason.length > 0
        ) {
          return envelopeError.reason;
        }
        // Legacy / bare `{ reason }` fallback.
        const reason = (parsed as { reason?: unknown }).reason;
        if (typeof reason === 'string' && reason.length > 0) {
          return reason;
        }
      }
    } catch {
      // Non-JSON / empty body — fall through to the status-based reason.
    }
    return `HTTP ${response.status}`;
  }
}
