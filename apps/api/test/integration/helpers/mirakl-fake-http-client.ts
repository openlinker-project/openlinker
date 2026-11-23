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
 * - `PUT /api/orders/{id}/tracking` (OR23), `.../ship` (OR24) and
 *   `.../cancel` (OR29) (#4276): store the tracking number, move the order to
 *   `SHIPPED` or `CANCELED`.
 * - `GET /api/orders/documents` (OR72) and `POST /api/orders/{id}/documents`
 *   (OR74): keep the uploaded documents per order.
 *
 * Every other call rejects, so an unexpected request fails the test loudly.
 *
 * @module apps/api/test/integration/helpers
 */
import { MiraklApiException } from '@openlinker/integrations-mirakl';
import type { MiraklOrder } from '@openlinker/integrations-mirakl/domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '@openlinker/integrations-mirakl/infrastructure/http/mirakl-http-client.interface';
import type {
  MiraklFileUpload,
  MiraklHttpResponse,
  MiraklRequestOptions,
} from '@openlinker/integrations-mirakl/infrastructure/http/mirakl-http-client.types';

export interface RecordedMiraklCall {
  readonly method: 'GET' | 'PUT' | 'POST';
  readonly path: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

interface StoredOrder {
  order: MiraklOrder;
  /** State OR21 moves the order to (default `SHIPPING`). */
  acceptedState: string;
}

const ORDER_ACTION_PATH = /^\/api\/orders\/([^/]+)\/(accept|tracking|ship|cancel|documents)$/;

interface StoredDocument {
  readonly order_id: string;
  readonly file_name: string;
  readonly type: string;
}

export class MiraklFakeHttpClient implements IMiraklHttpClient {
  readonly calls: RecordedMiraklCall[] = [];
  private readonly orders = new Map<string, StoredOrder>();
  private readonly armedAcceptErrors: MiraklApiException[] = [];
  readonly documents: StoredDocument[] = [];

  /** Add or replace an order on the fake marketplace. */
  putOrder(order: MiraklOrder, acceptedState = 'SHIPPING'): void {
    this.orders.set(order.order_id ?? '', { order, acceptedState });
  }

  orderState(orderId: string): string | undefined {
    return this.orders.get(orderId)?.order.order_state;
  }

  order(orderId: string): MiraklOrder | undefined {
    return this.orders.get(orderId)?.order;
  }

  /** Make the next OR21 call fail with this error instead of accepting. */
  failNextAccept(error: MiraklApiException): void {
    this.armedAcceptErrors.push(error);
  }

  callsOf(method: 'GET' | 'PUT' | 'POST'): RecordedMiraklCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.calls.length = 0;
    this.orders.clear();
    this.armedAcceptErrors.length = 0;
    this.documents.length = 0;
  }

  get<T>(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>> {
    const query = options?.queryParams ?? {};
    this.calls.push({ method: 'GET', path, query });
    if (path === '/api/orders/documents') {
      const ids = String(query.order_ids ?? '').split(',');
      const docs = this.documents.filter((document) => ids.includes(document.order_id));
      return Promise.resolve({
        status: 200,
        data: { order_documents: docs, total_count: docs.length } as unknown as T,
      });
    }
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
    const match = ORDER_ACTION_PATH.exec(path);
    if (!match || match[2] === 'documents') {
      return Promise.reject(new MiraklApiException(`Mirakl fake: no PUT ${path}`, 404));
    }
    const action = match[2];
    if (action === 'accept') {
      const armed = this.armedAcceptErrors.shift();
      if (armed) {
        return Promise.reject(armed);
      }
    }
    const stored = this.orders.get(decodeURIComponent(match[1]));
    if (!stored) {
      return Promise.reject(new MiraklApiException('not found', 404, 'ORDER_NOT_FOUND'));
    }
    switch (action) {
      case 'accept':
        if (stored.order.order_state !== 'WAITING_ACCEPTANCE') {
          return Promise.reject(new MiraklApiException('invalid state', 400, 'ORDER_INVALID_STATE'));
        }
        this.moveTo(stored, stored.acceptedState);
        break;
      case 'tracking': {
        const tracking = body as { tracking_number: string; carrier_code?: string };
        stored.order = {
          ...stored.order,
          shipping_tracking: tracking.tracking_number,
          shipping_carrier_code: tracking.carrier_code,
        };
        break;
      }
      case 'ship':
        if (stored.order.order_state !== 'SHIPPING') {
          // OR24 refusals carry no code, like Mirakl.
          return Promise.reject(new MiraklApiException('cannot ship', 400));
        }
        this.moveTo(stored, 'SHIPPED');
        break;
      case 'cancel':
        this.moveTo(stored, 'CANCELED');
        break;
    }
    return Promise.resolve({ status: 204, data: undefined as unknown as T });
  }

  private moveTo(stored: StoredOrder, state: string): void {
    stored.order = {
      ...stored.order,
      order_state: state,
      last_updated_date: new Date(Date.now() - 60_000).toISOString(),
      order_lines: (stored.order.order_lines ?? []).map((line) => ({
        ...line,
        order_line_state: state,
      })),
    };
  }

  getText<T>(): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException('Mirakl fake: getText not used', 404));
  }

  post<T>(): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException('Mirakl fake: post not used', 404));
  }

  postFile<T>(path: string, file: MiraklFileUpload): Promise<MiraklHttpResponse<T>> {
    this.calls.push({ method: 'POST', path, body: file.fields });
    const match = ORDER_ACTION_PATH.exec(path);
    if (!match || match[2] !== 'documents') {
      return Promise.reject(new MiraklApiException(`Mirakl fake: no POST ${path}`, 404));
    }
    const orderId = decodeURIComponent(match[1]);
    if (!this.orders.has(orderId)) {
      return Promise.reject(new MiraklApiException('not found', 404, 'ORDER_NOT_FOUND'));
    }
    const described = JSON.parse(file.fields?.order_documents ?? '{}') as {
      order_documents?: Array<{ file_name: string; type_code: string }>;
    };
    for (const entry of described.order_documents ?? []) {
      this.documents.push({ order_id: orderId, file_name: entry.file_name, type: entry.type_code });
    }
    return Promise.resolve({
      status: 200,
      data: { errors_count: 0, order_documents: described.order_documents } as unknown as T,
    });
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
