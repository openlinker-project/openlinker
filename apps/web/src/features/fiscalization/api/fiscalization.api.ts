/**
 * Fiscalization API Client (#1909)
 *
 * Thin API module consuming the #1908 HTTP surface:
 *   - `GET /fiscal-registrations?orderId=…` — every record held by an order,
 *     newest-first, across every connection. Empty list is the normal
 *     never-registered state — never a 404.
 *   - `POST /fiscal-registrations` — register on an explicit operator request.
 *   - `POST /fiscal-registrations/:id/reconcile` — settle an in-doubt outcome
 *     by asking the provider; never a resend.
 *
 * @module apps/web/src/features/fiscalization/api
 */
import type {
  FiscalRegistrationRecord,
  ReconcileFiscalRegistrationResult,
  RegisterFiscalTransactionInput,
} from './fiscalization.types';

export interface FiscalizationApi {
  listForOrder: (orderId: string) => Promise<FiscalRegistrationRecord[]>;
  register: (input: RegisterFiscalTransactionInput) => Promise<FiscalRegistrationRecord>;
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
    register(input): Promise<FiscalRegistrationRecord> {
      return request<FiscalRegistrationRecord>('/fiscal-registrations', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    reconcile(id): Promise<ReconcileFiscalRegistrationResult> {
      return request<ReconcileFiscalRegistrationResult>(
        `/fiscal-registrations/${encodeURIComponent(id)}/reconcile`,
        { method: 'POST' },
      );
    },
  };
}
