/**
 * Subiekt Orders Bridge Client
 *
 * A small, self-contained HTTP transport for the bridge's `/api/orders*`
 * surface. Deliberately NOT built on `SubiektBridgeHttpClient` (the invoicing
 * transport) — that client's public methods are tied 1:1 to
 * `SubiektBridgeClient`'s invoicing-shaped interface, and extending it there
 * would widen an interface owned by a sibling capability. This client owns its
 * own construction, auth header, and envelope unwrapping, following the exact
 * same conventions (URL safety check, optional bearer/x-bridge-token, `{success,
 * data, error}` envelope) established by `SubiektBridgeHttpClient` (#753).
 *
 * @module libs/integrations/subiekt/bridge
 */
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektRejectedError } from './subiekt-bridge.errors';
import {
  extractErrorCode,
  classifyRetryability,
  SubiektBridgeUnreachableWithPhaseError,
} from './subiekt-transport-retryability';
import { SubiektBridgeAuthError } from '../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../domain/exceptions/subiekt-config.exception';
import { isBridgeUrlSafe } from '../infrastructure/http/subiekt-url-safety';
import type {
  BridgeCreateOrderRequest,
  BridgeCreateOrderResponse,
  BridgeOrderDetailResponse,
  BridgeOrderFeedResponse,
  BridgeWriteShippingRequest,
  BridgeWriteShippingResponse,
} from './subiekt-bridge-orders.types';
import { SUBIEKT_BRIDGE_TIMEOUT_MS } from './subiekt-bridge-timeout';
import { readBridgeAuthReason } from './subiekt-auth-reason';

export interface SubiektOrdersBridgeClientOptions {
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class SubiektOrdersBridgeClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(bridgeBaseUrl: string, opts: SubiektOrdersBridgeClientOptions = {}) {
    if (!isBridgeUrlSafe(bridgeBaseUrl)) {
      throw new SubiektConfigException(
        `Unsafe Subiekt bridge URL: ${bridgeBaseUrl}`,
        'bridgeBaseUrl',
        bridgeBaseUrl,
      );
    }
    this.baseUrl = bridgeBaseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? SUBIEKT_BRIDGE_TIMEOUT_MS;
    // eslint-disable-next-line no-restricted-globals -- test-only fallback; production call sites all inject a connection-bound transport (SubiektBridgeHttpClient precedent, #1810)
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch);
  }

  async createOrder(req: BridgeCreateOrderRequest): Promise<BridgeCreateOrderResponse> {
    return this.postJson<BridgeCreateOrderResponse>('/api/orders', req);
  }

  async listOrderFeed(since: string | null, limit: number): Promise<BridgeOrderFeedResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (since !== null) {
      params.set('since', since);
    }
    return this.getJson<BridgeOrderFeedResponse>(`/api/orders/feed?${params.toString()}`);
  }

  async getOrder(id: string): Promise<BridgeOrderDetailResponse> {
    return this.getJson<BridgeOrderDetailResponse>(`/api/orders/${encodeURIComponent(id)}`);
  }

  async writeShipping(
    id: string,
    req: BridgeWriteShippingRequest,
  ): Promise<BridgeWriteShippingResponse> {
    return this.putJson<BridgeWriteShippingResponse>(
      `/api/orders/${encodeURIComponent(id)}/shipping`,
      req,
    );
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = `Bearer ${this.token}`;
      headers['x-bridge-token'] = this.token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      // Transport-level failure — classify retryability (#2348 audit B2) so a
      // transient blip enters the normal retry ladder instead of dying on
      // attempt 1, same fix as the sibling Inventory bridge client.
      const code = extractErrorCode(error);
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt orders bridge unreachable (${code ?? 'unknown'})`,
        classifyRetryability(code),
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      // #3365 review: carry WHAT the bridge said, redacted. Three clients in
      // this package can be handed a 401 and only the invoicing one read the
      // body, so one rotated token produced a named cause on one path and a bare
      // status on the other two.
      throw new SubiektBridgeAuthError(
        response.status,
        await readBridgeAuthReason(response, this.token),
      );
    }

    let envelope: { success: boolean; data: T | null; error: { code: string; reason: string } | null };
    try {
      envelope = (await response.json()) as typeof envelope;
    } catch {
      // Response received but unparseable — the write may or may not have
      // landed, so this stays 'indeterminate'.
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt orders bridge returned a non-JSON response (status ${response.status})`,
        'indeterminate',
      );
    }

    if (!response.ok || !envelope.success) {
      if (response.status >= 500) {
        // A SERVER fault, even when it arrives wearing the business envelope.
        // The invoicing, catalogue and inventory transports all draw this line;
        // this one did not, and the consequence is worse here than anywhere
        // else. `SubiektRejectedError` passes through `translateBridgeError`
        // unchanged and no retry classifier recognises it, so it is RETRYABLE -
        // the runner re-POSTs `createOrder`, and if Subiekt created the ZK
        // before the 500 that is a SECOND zamówienie and a second kontrahent
        // for one sale. `'indeterminate'` is what routes it to the fiscal-safe
        // ladder instead, which is the exact guarantee the order processor's
        // own docblock was written to give for `SubiektBridgeUnreachableError`.
        //
        // It also stops the operator being told "Subiekt rejected the request:
        // HTTP 500" - that sentence blames the shop for its own bridge being
        // down.
        throw new SubiektBridgeUnreachableWithPhaseError(
          `Subiekt orders bridge answered HTTP ${response.status}: ` +
            `${envelope.error?.reason ?? 'no reason given'}`,
          'indeterminate',
        );
      }
      const reason = envelope.error?.reason ?? `HTTP ${response.status}`;
      // The machine-readable code travels with it (#3365): this transport had
      // already typed `error.code` on the envelope and then dropped it, so no
      // caller here could tell a not-found from a refusal the way the catalogue
      // and inventory paths now can.
      throw new SubiektRejectedError(reason, envelope.error?.code);
    }

    if (envelope.data === null) {
      throw new SubiektRejectedError('Subiekt orders bridge returned an empty success payload');
    }

    return envelope.data;
  }
}
