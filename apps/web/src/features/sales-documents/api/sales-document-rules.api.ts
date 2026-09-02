/**
 * Sales-Document Rules API (#2170)
 *
 * @module apps/web/src/features/sales-documents/api
 */
import { ApiError } from '../../../shared/api/api-error';
import type { SalesDocumentMarketsResponse } from './sales-document-markets.types';
import type {
  AdoptSalesDocumentTemplateInput,
  CreateSalesDocumentRuleInput,
  SalesDocumentCountryAcknowledgment,
  SalesDocumentCountryDefault,
  SalesDocumentCountrySummary,
  SalesDocumentRule,
  SalesDocumentStarterTemplate,
  SalesDocumentThreshold,
  UpsertSalesDocumentCountryDefaultInput,
} from './sales-document-rules.types';

export interface SalesDocumentRulesApi {
  listRules: (country: string) => Promise<SalesDocumentRule[]>;
  createRule: (input: CreateSalesDocumentRuleInput) => Promise<SalesDocumentRule>;
  deleteRule: (id: string) => Promise<void>;
  listCountryDefaults: (country: string) => Promise<SalesDocumentCountryDefault[]>;
  upsertCountryDefault: (
    input: UpsertSalesDocumentCountryDefaultInput,
  ) => Promise<SalesDocumentCountryDefault>;
  deleteCountryDefault: (id: string) => Promise<void>;
  listThresholds: () => Promise<SalesDocumentThreshold[]>;
  getTemplate: (country: string) => Promise<SalesDocumentStarterTemplate | null>;
  adoptTemplate: (country: string, input: AdoptSalesDocumentTemplateInput) => Promise<SalesDocumentRule[]>;
  /** GET /sales-documents/countries (#2186) — every country carrying any config. */
  listConfiguredCountries: () => Promise<SalesDocumentCountrySummary[]>;
  /** PUT /sales-documents/countries/:country/acknowledgment (#2186, #2189). */
  acknowledgeNoDocument: (country: string) => Promise<SalesDocumentCountryAcknowledgment>;
  /** DELETE /sales-documents/countries/:country/acknowledgment (#2186, #2189). */
  clearAcknowledgment: (country: string) => Promise<void>;
  /**
   * GET /sales-documents/markets (#2518/#2540, ADR-066) — configured and
   * detected markets merged, each with its effective routing outcome
   * resolved through the same evaluator every real order resolves through.
   */
  listMarkets: () => Promise<SalesDocumentMarketsResponse>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createSalesDocumentRulesApi(request: ApiRequest): SalesDocumentRulesApi {
  return {
    listRules(country): Promise<SalesDocumentRule[]> {
      return request<SalesDocumentRule[]>(`/sales-documents/rules?country=${encodeURIComponent(country)}`);
    },
    createRule(input): Promise<SalesDocumentRule> {
      return request<SalesDocumentRule>('/sales-documents/rules', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    deleteRule(id): Promise<void> {
      return request<void>(`/sales-documents/rules/${id}`, { method: 'DELETE' });
    },
    listCountryDefaults(country): Promise<SalesDocumentCountryDefault[]> {
      return request<SalesDocumentCountryDefault[]>(
        `/sales-documents/country-defaults?country=${encodeURIComponent(country)}`,
      );
    },
    upsertCountryDefault(input): Promise<SalesDocumentCountryDefault> {
      // PUT, not POST — idempotent insert-or-replace (review, optional
      // improvements; matches the backend route).
      return request<SalesDocumentCountryDefault>('/sales-documents/country-defaults', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    deleteCountryDefault(id): Promise<void> {
      return request<void>(`/sales-documents/country-defaults/${id}`, { method: 'DELETE' });
    },
    listThresholds(): Promise<SalesDocumentThreshold[]> {
      return request<SalesDocumentThreshold[]>('/sales-documents/thresholds');
    },
    async getTemplate(country): Promise<SalesDocumentStarterTemplate | null> {
      try {
        return await request<SalesDocumentStarterTemplate>(
          `/sales-documents/templates/${encodeURIComponent(country)}`,
        );
      } catch (error) {
        if (error instanceof ApiError && error.isNotFound()) {
          return null;
        }
        throw error;
      }
    },
    adoptTemplate(country, input): Promise<SalesDocumentRule[]> {
      return request<SalesDocumentRule[]>(
        `/sales-documents/templates/${encodeURIComponent(country)}/adopt`,
        { method: 'POST', body: JSON.stringify(input) },
      );
    },
    listConfiguredCountries(): Promise<SalesDocumentCountrySummary[]> {
      return request<SalesDocumentCountrySummary[]>('/sales-documents/countries');
    },
    acknowledgeNoDocument(country): Promise<SalesDocumentCountryAcknowledgment> {
      return request<SalesDocumentCountryAcknowledgment>(
        `/sales-documents/countries/${encodeURIComponent(country)}/acknowledgment`,
        { method: 'PUT' },
      );
    },
    clearAcknowledgment(country): Promise<void> {
      return request<void>(
        `/sales-documents/countries/${encodeURIComponent(country)}/acknowledgment`,
        { method: 'DELETE' },
      );
    },
    listMarkets(): Promise<SalesDocumentMarketsResponse> {
      return request<SalesDocumentMarketsResponse>('/sales-documents/markets');
    },
  };
}
