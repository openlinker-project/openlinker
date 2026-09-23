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
import type { FetchLike } from '@openlinker/shared/http';
import type { SubiektBridgeClient } from '../../bridge/subiekt-bridge.client';
import { SubiektRejectedError } from '../../bridge/subiekt-bridge.errors';
import type {
  BridgeInvoiceStatusRequest,
  BridgeInvoiceStatusResponse,
  BridgeIssueInvoiceRequest,
  BridgeIssueInvoiceResponse,
  BridgeKorektaRequest,
  BridgeKorektaResponse,
  BridgeListBankAccountsResponse,
  BridgeListCashRegistersResponse,
  BridgeRegulatoryStatus,
  BridgeResponseEnvelope,
  BridgeSetDefaultBankAccountResponse,
  BridgeUpsertCustomerRequest,
  BridgeUpsertCustomerResponse,
} from '../../bridge/subiekt-bridge.types';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { isBridgeUrlSafe } from './subiekt-url-safety';
import {
  classifyRetryability,
  extractErrorCode,
  SubiektBridgeUnreachableWithPhaseError,
} from '../../bridge/subiekt-transport-retryability';

/**
 * Bridge REST surface, reconciled against the live bridge's minimal-API routes
 * (`Subiekt.Bridge.Api/Endpoints/*`): the bridge exposes English-noun routes
 * under the `/api/*` prefix (which it guards with `X-Api-Key`); `/health` is
 * anonymous and stays outside the prefix. The configured bridge base URL must
 * NOT include `/api` — these paths carry it.
 */
export const SUBIEKT_BRIDGE_ENDPOINTS = {
  issueInvoice: '/api/invoices',
  /**
   * Correction (faktura korygująca) endpoint, templated by the ORIGINAL document's
   * numeric id. The bridge route is `POST /api/invoices/{origId}/corrections`.
   */
  issueCorrection: (origId: number): string => `/api/invoices/${origId}/corrections`,
  upsertCustomer: '/api/customers/upsert',
  /** Templated by `providerInvoiceId`; the bridge route is `GET /api/invoices/{id}/status`. */
  invoiceStatus: (providerInvoiceId: string): string =>
    `/api/invoices/${encodeURIComponent(providerInvoiceId)}/status`,
  /** Bank-account discovery; the bridge route is `GET /api/bank-accounts` (#1324). */
  bankAccounts: '/api/bank-accounts',
  /**
   * Default bank-account selector, templated by the numeric account id. The
   * bridge route is `PUT /api/bank-accounts/{id}/default` (#1324).
   */
  setDefaultBankAccount: (id: number): string => `/api/bank-accounts/${id}/default`,
  /**
   * Stanowisko Kasowe (cash register) discovery. The bridge route is
   * `GET /api/cash-registers` (#1324).
   */
  cashRegisters: '/api/cash-registers',
  health: '/health',
} as const;

/**
 * The `data` payload the bridge's `GET /api/invoices/{id}/status` returns (a
 * superset of what we project): the KSeF `regulatoryStatus` + `clearanceReference`
 * (#3352) plus a Polish document `status`. We read `regulatoryStatus` and
 * `clearanceReference`; the rest is ignored.
 */
interface BridgeInvoiceStatusData {
  regulatoryStatus: BridgeRegulatoryStatus;
  clearanceReference?: string | null;
  status?: string;
}

/** Options for the HTTP client. */
export interface SubiektBridgeHttpClientOptions {
  /** Optional bridge token — never logged. */
  token?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Connection-bound outbound transport (#1810). Defaults to `globalThis.fetch`
   * when omitted — production call sites always inject one; see the
   * constructor note for why this stays optional for now.
   */
  fetchImpl?: FetchLike;
}

export class SubiektBridgeHttpClient implements SubiektBridgeClient {
  private readonly logger = new Logger(SubiektBridgeHttpClient.name);
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

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
    // Pre-existing silent fallback, surfaced (not introduced) by the
    // strengthened `check-outbound-http.mjs` in #1968 — `no-restricted-globals`
    // never saw it, because it flags the bare identifier `fetch`, not a member
    // expression. Every production call site (adapter factory, connection
    // tester) already injects a connection-bound transport; the fallback only
    // serves test constructions. Making it REQUIRED — the posture
    // `AllegroHttpClient`/`ErliHttpClient`/`KsefHttpClient` adopt — is the
    // parity follow-up (mirrors the identical PrestaShop note); until then
    // the bypass is at least greppable.
    // eslint-disable-next-line no-restricted-globals -- pre-existing test-only fallback; production call sites all inject a transport. Make required for Allegro/Erli/KSeF parity (#1810 follow-up)
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
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
      clearanceReference: data.clearanceReference ?? null,
    };
  }

  async listBankAccounts(): Promise<BridgeListBankAccountsResponse> {
    return this.getJson<BridgeListBankAccountsResponse>(SUBIEKT_BRIDGE_ENDPOINTS.bankAccounts);
  }

  async setDefaultBankAccount(
    bankAccountId: number,
  ): Promise<BridgeSetDefaultBankAccountResponse> {
    return this.putJson<BridgeSetDefaultBankAccountResponse>(
      SUBIEKT_BRIDGE_ENDPOINTS.setDefaultBankAccount(bankAccountId),
      {},
    );
  }

  async listCashRegisters(): Promise<BridgeListCashRegistersResponse> {
    return this.getJson<BridgeListCashRegistersResponse>(SUBIEKT_BRIDGE_ENDPOINTS.cashRegisters);
  }

  /**
   * Probe for the connection tester and the reachability sweep: is the bridge
   * reachable AND does it accept our credentials?
   *
   * It deliberately does NOT use `/health`. Both bridges exempt `/health` from
   * their auth middleware, so a connection carrying no token at all passed the
   * old probe and then failed 401 on its first real call — the operator was
   * shown a green tick for a configuration that could never work, and the
   * reachability sweep was blind to a rotated bridge token, the single most
   * likely way a working connection stops working.
   *
   * `/api/bank-accounts` is the probe instead because the auth middleware sits
   * in FRONT of every `/api/*` route on both bridges, so any answer other than
   * 401/403 proves authorization passed — and it is a plain read with no side
   * effects, which a probe that may run on a schedule has to be.
   *
   * Resolves when the bridge is reachable and authorized, including when it
   * answers with a business rejection (that still proves both). Rejects with
   * `SubiektBridgeAuthError` on 401/403, carrying the bridge's own reason, and
   * with `SubiektBridgeUnreachableError` / `SubiektConfigException` when the
   * bridge could not be reached. Not part of the frozen `SubiektBridgeClient`
   * surface.
   */
  async checkReachableAndAuthorized(): Promise<void> {
    try {
      await this.getJson<unknown>(SUBIEKT_BRIDGE_ENDPOINTS.bankAccounts);
    } catch (error: unknown) {
      // A business rejection means the bridge IS reachable and DID accept our
      // credentials — it got past the auth middleware to produce one.
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

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
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
      // fiscal rejection. Surface a clear, terminal auth error.
      //
      // The body IS read here, deliberately reversing the earlier "never read
      // the body" rule. The bridge distinguishes two states the operator must
      // act on differently — a wrong token versus a bridge where `InvoiceToken`
      // was never set, which closes every `/api/*` route — and it says which in
      // `error.reason`. Withholding that turned both into one generic sentence
      // and sent the operator looking for a bad value when nothing was set.
      //
      // The rule the original comment was protecting (never surface the token)
      // is kept by `redactToken`, which is stronger than not reading at all: it
      // holds even for a bridge that echoes the credential, ours or anyone's.
      throw new SubiektBridgeAuthError(response.status, await this.readAuthReason(response));
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

  /**
   * The bridge's own explanation for a 401 / 403, safe to show an operator, or
   * `undefined` when it gave none.
   *
   * `readRejectionReason` falls back to `HTTP <status>` when the body carries
   * nothing readable. On the auth path that string adds nothing the error's own
   * `status` does not already say, so it is mapped to `undefined` rather than
   * padding the message with a number.
   */
  private async readAuthReason(response: Response): Promise<string | undefined> {
    const raw = await this.readRejectionReason(response);
    if (raw === `HTTP ${response.status}`) {
      return undefined;
    }
    const safe = this.redactToken(raw);
    return safe.length > 0 ? safe : undefined;
  }

  /**
   * Removes the bridge token from a string taken off the wire.
   *
   * This is what lets the 401 path read the response body at all. The body
   * comes from a service OpenLinker does not control, so "our bridge does not
   * echo the token" is not a property this client may rely on. Capping the
   * length bounds the same risk for anything else a hostile or broken bridge
   * might put there.
   */
  private redactToken(text: string): string {
    const MAX = 300;
    let out = text;
    if (this.token !== undefined && this.token.length > 0) {
      out = out.split(this.token).join('[redacted]');
    }
    return out.length > MAX ? `${out.slice(0, MAX)}…` : out;
  }
}
