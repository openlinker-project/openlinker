/**
 * Subiekt Inventory Bridge HTTP Client
 *
 * A deliberately SMALL, self-contained transport for the bridge's
 * `/api/inventory*` surface — a sibling of `SubiektBridgeHttpClient`
 * (Invoicing), not an extension of it, so this InventoryMaster slice touches
 * no file the Invoicing/Products/Orders/Fiscalization capability slices also
 * own. It re-uses the same construction-time SSRF guard (`isBridgeUrlSafe`)
 * and the same error taxonomy (`SubiektBridgeUnreachableError` /
 * `SubiektRejectedError`, from the shared `subiekt-bridge.errors.ts`) so a
 * caller's `.rejects` assertions stay portable across every Subiekt capability
 * — it deliberately omits the full client's redirect re-validation and
 * idempotency-key-on-body-before-fetch fiscal-dedup discipline, neither of
 * which apply to a non-fiscal, retryable inventory write.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektRejectedError } from '../../bridge/subiekt-bridge.errors';
import {
  extractErrorCode,
  classifyRetryability,
  SubiektBridgeUnreachableWithPhaseError,
} from '../../bridge/subiekt-transport-retryability';
import type {
  BridgeInventoryAdjustRequest,
  BridgeInventoryAdjustResponse,
  BridgeInventoryStockResponse,
  BridgeWarehousesResponse,
} from '../../bridge/subiekt-bridge-inventory.types';
import type { BridgeResponseEnvelope } from '../../bridge/subiekt-bridge.types';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { isBridgeUrlSafe } from './subiekt-url-safety';
import { SUBIEKT_BRIDGE_TIMEOUT_MS } from '../../bridge/subiekt-bridge-timeout';
import { readBridgeAuthReason } from '../../bridge/subiekt-auth-reason';

export interface SubiektInventoryBridgeClientOptions {
  /** Optional bridge token — never logged. */
  token?: string;
  timeoutMs?: number;
  /**
   * REQUIRED — no `globalThis.fetch` fallback. Outbound HTTP must go through
   * the connection-bound transport (`HostServices.http.forConnection`), per
   * `scripts/check-outbound-http.mjs`'s repo-wide invariant; the caller
   * wiring this client into the plugin factory supplies it from there.
   */
  fetchImpl: FetchLike;
}

// #3365 review: the SHARED bridge timeout - see the constant's own docblock for
// why a client deadline shorter than the bridge's server-side wait manufactures
// failures out of slow successes. A stock adjustment is a WRITE, so a spurious
// timeout here is the expensive kind.
const DEFAULT_TIMEOUT_MS = SUBIEKT_BRIDGE_TIMEOUT_MS;

export class SubiektInventoryBridgeClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(bridgeBaseUrl: string, opts: SubiektInventoryBridgeClientOptions) {
    if (!isBridgeUrlSafe(bridgeBaseUrl)) {
      throw new SubiektConfigException(
        `bridgeBaseUrl is not a safe address: ${bridgeBaseUrl}`,
        'bridgeBaseUrl',
        bridgeBaseUrl,
      );
    }
    this.baseUrl = bridgeBaseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl;
  }

  async getStock(towarSymbol: string): Promise<BridgeInventoryStockResponse> {
    const data = await this.request<BridgeInventoryStockResponse>(
      'GET',
      `/api/inventory/${encodeURIComponent(towarSymbol)}/stock`,
    );
    return data;
  }

  /**
   * The seller's own warehouses (#3365).
   *
   * Optional on the bridge side by deployment reality rather than by contract:
   * a bridge predating the route answers 404, and the caller must treat that as
   * "cannot tell", never as "no such warehouse" - concluding the latter from a
   * missing ROUTE would refuse a perfectly good configuration.
   */
  async listWarehouses(): Promise<BridgeWarehousesResponse> {
    return this.request<BridgeWarehousesResponse>('GET', '/api/warehouses');
  }

  async adjust(body: BridgeInventoryAdjustRequest): Promise<BridgeInventoryAdjustResponse> {
    const data = await this.request<BridgeInventoryAdjustResponse>(
      'POST',
      '/api/inventory/adjust',
      body,
    );
    return data;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = `Bearer ${this.token}`;
      headers['x-bridge-token'] = this.token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // Transport-level failure — never reached the bridge's business layer.
      // Classify retryability (#2348 audit B2) rather than throwing bare, or
      // the fiscal-safety-oriented retry classifier treats every transient
      // blip as non-retryable and kills the job on attempt 1.
      const code = extractErrorCode(error);
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt inventory bridge is unreachable (${code ?? 'unknown'})`,
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

    let envelope: BridgeResponseEnvelope<T>;
    try {
      envelope = (await response.json()) as BridgeResponseEnvelope<T>;
    } catch (error) {
      // The response WAS received (past the transport catch above) but
      // couldn't be parsed — the write may or may not have landed, so this
      // stays 'indeterminate' rather than 'safe'.
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt inventory bridge returned an unparseable response: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'indeterminate',
      );
    }

    if (!envelope.success) {
      if (response.status >= 500) {
        // A SERVER fault wearing the business envelope. Without this branch a
        // bridge 500 reaches the adapter as a business rejection, and a
        // rejection on this path is one `looksLikeSubiektNotFound` away from
        // being adjudicated a master-side deletion.
        throw new SubiektBridgeUnreachableWithPhaseError(
          `Subiekt bridge answered HTTP ${response.status}: ${envelope.error?.reason ?? 'no reason given'}`,
          'indeterminate',
        );
      }
      throw new SubiektRejectedError(
        envelope.error?.reason ?? `HTTP ${response.status}`,
        envelope.error?.code,
      );
    }

    return envelope.data as T;
  }
}
