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

export interface SubiektOrdersBridgeClientOptions {
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      throw new SubiektBridgeAuthError(response.status);
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
      const reason = envelope.error?.reason ?? `HTTP ${response.status}`;
      throw new SubiektRejectedError(reason);
    }

    if (envelope.data === null) {
      throw new SubiektRejectedError('Subiekt orders bridge returned an empty success payload');
    }

    return envelope.data;
  }
}
