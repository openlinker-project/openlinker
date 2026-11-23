/**
 * Mirakl Fake HTTP Client (#4275)
 *
 * An in-memory stand-in for the Mirakl order API behind the REAL
 * `MiraklOrderSourceAdapter`, so the Empik vertical slice runs the adapter's
 * acceptance, window and paging logic unchanged. It answers:
 *
 * - `GET /api/orders` (OR11): filters `order_ids`, `order_state_codes` (comma
 *   list), `start_update_date` / `end_update_date`; pages by `max` / `offset`.
 * - `PUT /api/orders/{id}/accept` (OR21): moves a waiting order to its
 *   `acceptedState` and stamps a fresh `last_updated_date`; an order that is
 *   not waiting answers `ORDER_INVALID_STATE`, like Mirakl.
 *
 * Every other call rejects, so an unexpected request fails the test loudly.
 *
 * @module apps/api/test/integration/helpers
 */
import { MiraklApiException } from '@openlinker/integrations-mirakl';
import type { MiraklOrder } from '@openlinker/integrations-mirakl/domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '@openlinker/integrations-mirakl/infrastructure/http/mirakl-http-client.interface';
import type {
  MiraklHttpResponse,
  MiraklRequestOptions,
} from '@openlinker/integrations-mirakl/infrastructure/http/mirakl-http-client.types';

export interface RecordedMiraklCall {
  readonly method: 'GET' | 'PUT';
  readonly path: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

interface StoredOrder {
  order: MiraklOrder;
  /** State OR21 moves the order to (default `SHIPPING`). */
  acceptedState: string;
}

const ACCEPT_PATH = /^\/api\/orders\/([^/]+)\/accept$/;

export class MiraklFakeHttpClient implements IMiraklHttpClient {
  readonly calls: RecordedMiraklCall[] = [];
  private readonly orders = new Map<string, StoredOrder>();
  private readonly armedAcceptErrors: MiraklApiException[] = [];

  /** Add or replace an order on the fake marketplace. */
  putOrder(order: MiraklOrder, acceptedState = 'SHIPPING'): void {
    this.orders.set(order.order_id ?? '', { order, acceptedState });
  }

  orderState(orderId: string): string | undefined {
    return this.orders.get(orderId)?.order.order_state;
  }

  /** Make the next OR21 call fail with this error instead of accepting. */
  failNextAccept(error: MiraklApiException): void {
    this.armedAcceptErrors.push(error);
  }

  callsOf(method: 'GET' | 'PUT'): RecordedMiraklCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.calls.length = 0;
    this.orders.clear();
    this.armedAcceptErrors.length = 0;
  }

  get<T>(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>> {
    const query = options?.queryParams ?? {};
    this.calls.push({ method: 'GET', path, query });
    if (path !== '/api/orders') {
      return Promise.reject(new MiraklApiException(`Mirakl fake: no GET ${path}`, 404));
    }
    const matching = [...this.orders.values()]
      .map((stored) => stored.order)
      .filter((order) => matchesQuery(order, query));
    const max = Number(query.max ?? 100);
    const offset = Number(query.offset ?? 0);
    const data = { orders: matching.slice(offset, offset + max), total_count: matching.length };
    return Promise.resolve({ status: 200, data: data as unknown as T });
  }

  put<T>(path: string, body?: unknown): Promise<MiraklHttpResponse<T>> {
    this.calls.push({ method: 'PUT', path, body });
    const match = ACCEPT_PATH.exec(path);
    if (!match) {
      return Promise.reject(new MiraklApiException(`Mirakl fake: no PUT ${path}`, 404));
    }
    const armed = this.armedAcceptErrors.shift();
    if (armed) {
      return Promise.reject(armed);
    }
    const stored = this.orders.get(decodeURIComponent(match[1]));
    if (!stored) {
      return Promise.reject(new MiraklApiException('not found', 404, 'ORDER_NOT_FOUND'));
    }
    if (stored.order.order_state !== 'WAITING_ACCEPTANCE') {
      return Promise.reject(new MiraklApiException('invalid state', 400, 'ORDER_INVALID_STATE'));
    }
    const updatedAt = new Date(Date.now() - 60_000).toISOString();
    stored.order = {
      ...stored.order,
      order_state: stored.acceptedState,
      last_updated_date: updatedAt,
      order_lines: (stored.order.order_lines ?? []).map((line) => ({
        ...line,
        order_line_state: stored.acceptedState,
      })),
    };
    return Promise.resolve({ status: 204, data: undefined as unknown as T });
  }

  getText<T>(): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException('Mirakl fake: getText not used', 404));
  }

  post<T>(): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException('Mirakl fake: post not used', 404));
  }

  postFile<T>(): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException('Mirakl fake: postFile not used', 404));
  }
}

function matchesQuery(order: MiraklOrder, query: Readonly<Record<string, unknown>>): boolean {
  if (typeof query.order_ids === 'string' && order.order_id !== query.order_ids) {
    return false;
  }
  if (typeof query.order_state_codes === 'string') {
    const states = query.order_state_codes.split(',');
    if (!states.includes(order.order_state ?? '')) {
      return false;
    }
  }
  const updatedAt = Date.parse(order.last_updated_date ?? '');
  if (typeof query.start_update_date === 'string' && updatedAt < Date.parse(query.start_update_date)) {
    return false;
  }
  if (typeof query.end_update_date === 'string' && updatedAt > Date.parse(query.end_update_date)) {
    return false;
  }
  return true;
}
