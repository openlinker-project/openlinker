/**
 * InPost ShipX Client
 *
 * The application facade. Depends only on ports (`HttpClientPort`,
 * `TokenProviderPort`, `LoggerPort`) — it knows ShipX URL shapes and the
 * shipment state machine, nothing about `fetch` or token storage. Resource
 * methods return typed domain shapes; any HTTP >= 400 becomes an
 * `InpostApiError`.
 *
 * @module application
 */

import type { HttpClientPort, HttpMethod, HttpResponse } from '../domain/ports/http-client.port.ts';
import type { LoggerPort } from '../domain/ports/logger.port.ts';
import type { TokenProviderPort } from '../domain/ports/token-provider.port.ts';
import type { Paged } from '../domain/types/common.types.ts';
import type { Organization } from '../domain/types/organization.types.ts';
import type { Point, PointsQuery } from '../domain/types/point.types.ts';
import type {
  CreateShipmentCommand,
  LabelOptions,
  Shipment,
  ShipmentStatus,
  TrackingStatus,
} from '../domain/types/shipment.types.ts';
import { InpostApiError } from '../domain/errors/inpost-api.error.ts';
import { NoopLoggerAdapter } from '../adapters/console-logger.adapter.ts';

export interface InpostShipXClientDeps {
  readonly baseUrl: string;
  readonly httpClient: HttpClientPort;
  readonly tokenProvider: TokenProviderPort;
  readonly logger?: LoggerPort;
  /** Optional default organization id for org-scoped calls. */
  readonly organizationId?: number | string;
}

type QueryValue = string | number | boolean | undefined;

interface RequestOptions {
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly responseType?: 'json' | 'binary' | 'text';
}

export interface WaitOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export class InpostShipXClient {
  readonly #baseUrl: string;
  readonly #http: HttpClientPort;
  readonly #tokens: TokenProviderPort;
  readonly #logger: LoggerPort;
  readonly #defaultOrgId: string | undefined;

  constructor(deps: InpostShipXClientDeps) {
    this.#baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.#http = deps.httpClient;
    this.#tokens = deps.tokenProvider;
    this.#logger = deps.logger ?? new NoopLoggerAdapter();
    this.#defaultOrgId = deps.organizationId === undefined ? undefined : String(deps.organizationId);
  }

  // ── Points (apipoints) ───────────────────────────────────────────────────

  getPoints(query?: PointsQuery): Promise<Paged<Point>> {
    return this.#request<Paged<Point>>('GET', '/points', { query: query as RequestOptions['query'] });
  }

  getPoint(name: string): Promise<Point> {
    return this.#request<Point>('GET', `/points/${encodeURIComponent(name)}`);
  }

  // ── Organizations ──────────────────────────────────────────────────────────

  listOrganizations(): Promise<Paged<Organization>> {
    return this.#request<Paged<Organization>>('GET', '/organizations');
  }

  getOrganization(id: number | string): Promise<Organization> {
    return this.#request<Organization>('GET', `/organizations/${encodeURIComponent(String(id))}`);
  }

  /** Resolves the configured org id, else the first organization the token owns. */
  async resolveOrganizationId(): Promise<string> {
    if (this.#defaultOrgId) return this.#defaultOrgId;
    const orgs = await this.listOrganizations();
    const first = orgs.items[0];
    if (!first) {
      throw new Error('No organization available for this token; set organizationId explicitly');
    }
    return String(first.id);
  }

  // ── Shipments ────────────────────────────────────────────────────────────

  async createShipment(
    command: CreateShipmentCommand,
    organizationId?: number | string,
  ): Promise<Shipment> {
    const orgId = organizationId !== undefined ? String(organizationId) : await this.resolveOrganizationId();
    return this.#request<Shipment>('POST', `/organizations/${orgId}/shipments`, { body: command });
  }

  getShipment(shipmentId: number | string): Promise<Shipment> {
    return this.#request<Shipment>('GET', `/shipments/${encodeURIComponent(String(shipmentId))}`);
  }

  async listShipments(
    query?: Record<string, QueryValue>,
    organizationId?: number | string,
  ): Promise<Paged<Shipment>> {
    const orgId = organizationId !== undefined ? String(organizationId) : await this.resolveOrganizationId();
    return this.#request<Paged<Shipment>>('GET', `/organizations/${orgId}/shipments`, { query });
  }

  /** Picks one of the prepared offers (when a shipment was created without `service`). */
  selectOffer(shipmentId: number | string, offerId: number): Promise<Shipment> {
    return this.#request<Shipment>('POST', `/shipments/${encodeURIComponent(String(shipmentId))}/select_offer`, {
      body: { offer_id: offerId },
    });
  }

  /**
   * Confirms (purchases) a selected offer — moves the shipment toward `confirmed`
   * and draws on the organization's balance. ShipX settles asynchronously, so
   * poll with {@link waitForShipmentStatus} afterwards; a settlement failure
   * (e.g. insufficient funds) surfaces as a `failure` entry in `transactions`.
   */
  buyShipment(shipmentId: number | string, offerId: number): Promise<Shipment> {
    return this.#request<Shipment>('POST', `/shipments/${encodeURIComponent(String(shipmentId))}/buy`, {
      body: { offer_id: offerId },
    });
  }

  /** Fetches the shipping label bytes (PDF by default). Requires a confirmed shipment. */
  getLabel(shipmentId: number | string, options?: LabelOptions): Promise<Uint8Array> {
    return this.#request<Uint8Array>('GET', `/shipments/${encodeURIComponent(String(shipmentId))}/label`, {
      query: { format: options?.format ?? 'pdf', type: options?.type ?? 'normal' },
      responseType: 'binary',
    });
  }

  /** Like {@link getLabel} but also returns the provider-reported `Content-Type`. */
  async getLabelDocument(
    shipmentId: number | string,
    options?: LabelOptions,
  ): Promise<{ contentType: string; body: Uint8Array }> {
    const res = await this.#send<Uint8Array>(
      'GET',
      `/shipments/${encodeURIComponent(String(shipmentId))}/label`,
      { query: { format: options?.format ?? 'pdf', type: options?.type ?? 'normal' }, responseType: 'binary' },
    );
    return { contentType: res.headers['content-type'] || 'application/pdf', body: res.body };
  }

  /**
   * Cancels a shipment. ShipX only allows this pre-confirmation; a confirmed
   * shipment returns `invalid_action` → `InpostApiError` with status 400.
   */
  cancelShipment(shipmentId: number | string): Promise<void> {
    return this.#request<void>('DELETE', `/shipments/${encodeURIComponent(String(shipmentId))}`);
  }

  // ── Tracking ─────────────────────────────────────────────────────────────

  getTracking(trackingNumber: string): Promise<TrackingStatus> {
    return this.#request<TrackingStatus>('GET', `/tracking/${encodeURIComponent(trackingNumber)}`);
  }

  // ── Polling helper ─────────────────────────────────────────────────────────

  /**
   * Polls a shipment until `predicate(status)` is true or the timeout elapses.
   * Returns the last fetched shipment; throws on timeout.
   */
  async waitForShipmentStatus(
    shipmentId: number | string,
    predicate: (status: ShipmentStatus, shipment: Shipment) => boolean,
    options?: WaitOptions,
  ): Promise<Shipment> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const intervalMs = options?.intervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    let last: Shipment;
    do {
      last = await this.getShipment(shipmentId);
      this.#logger.debug(`shipment ${shipmentId} status=${last.status}`);
      if (predicate(last.status, last)) return last;
      if (Date.now() >= deadline) break;
      await sleep(intervalMs);
    } while (Date.now() < deadline);
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for shipment ${shipmentId} (last status: ${last.status})`,
    );
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  async #request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
    return (await this.#send<T>(method, path, options)).body;
  }

  async #send<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    const url = this.#buildUrl(path, options?.query);
    const responseType = options?.responseType ?? 'json';
    const token = await this.#tokens.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: responseType === 'binary' ? 'application/pdf' : 'application/json',
    };
    if (options?.body !== undefined) headers['Content-Type'] = 'application/json';

    this.#logger.debug(`→ ${method} ${url}`);
    const res = await this.#http.send<T>({ method, url, headers, body: options?.body, responseType });
    this.#logger.debug(`← ${res.status} ${method} ${url}`);

    if (res.status >= 400) {
      throw InpostApiError.fromResponse(method, url, res.status, res.body);
    }
    return res;
  }

  #buildUrl(path: string, query?: Readonly<Record<string, QueryValue>>): string {
    const url = new URL(this.#baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
