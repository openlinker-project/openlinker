/**
 * Fiscalization API Client (#1909)
 *
 * Thin API module consuming the #1908 HTTP surface:
 *   - `GET /fiscal-registrations?orderId=…` — every record held by an order,
 *     newest-first, across every connection. Empty list is the normal
 *     never-registered state — never a 404.
 *   - `POST /fiscal-registrations` — ASK for a registration on an explicit
 *     operator request. It accepts the work and returns; it does not perform it,
 *     so the answer carries no outcome (#2525).
 *   - `GET /orders/:orderId/fiscal-registration?connectionId=…` — where that
 *     work has got to. The poll target, and a pure read (#2526).
 *   - `POST /fiscal-registrations/:id/reconcile` — settle an in-doubt outcome
 *     by asking the provider; never a resend.
 *
 * @module apps/web/src/features/fiscalization/api
 */
import type {
  AcceptedFiscalRegistration,
  FiscalRegistrationProgressView,
  FiscalRegistrationRecord,
  ReconcileFiscalRegistrationResult,
  RegisterFiscalTransactionInput,
} from './fiscalization.types';

export interface FiscalizationApi {
  listForOrder: (orderId: string) => Promise<FiscalRegistrationRecord[]>;
  register: (input: RegisterFiscalTransactionInput) => Promise<AcceptedFiscalRegistration>;
  getProgress: (orderId: string, connectionId: string) => Promise<FiscalRegistrationProgressView>;
  reconcile: (id: string) => Promise<ReconcileFiscalRegistrationResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export function createFiscalizationApi(request: ApiRequest): FiscalizationApi {
  return {
    listForOrder(orderId): Promise<FiscalRegistrationRecord[]> {
      const query = new URLSearchParams({ orderId }).toString();
      return request<FiscalRegistrationRecord[]>(`/fiscal-registrations?${query}`);
    },
    register(input): Promise<AcceptedFiscalRegistration> {
      return request<AcceptedFiscalRegistration>('/fiscal-registrations', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    getProgress(orderId, connectionId): Promise<FiscalRegistrationProgressView> {
      const query = new URLSearchParams({ connectionId }).toString();
      return request<FiscalRegistrationProgressView>(
        `/orders/${encodeURIComponent(orderId)}/fiscal-registration?${query}`,
      );
    },
    reconcile(id): Promise<ReconcileFiscalRegistrationResult> {
      return request<ReconcileFiscalRegistrationResult>(
        `/fiscal-registrations/${encodeURIComponent(id)}/reconcile`,
        { method: 'POST' },
      );
    },
  };
}
