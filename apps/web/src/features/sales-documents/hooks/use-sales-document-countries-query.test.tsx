/**
 * useSalesDocumentCountriesQuery — hook tests (#2187)
 *
 * Mirrors `use-invoices-query.test.tsx`'s shape: a mocked api client +
 * renderHook with providers.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentCountrySummary } from '../api/sales-document-rules.types';
import { useSalesDocumentCountriesQuery } from './use-sales-document-countries-query';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

const summaries: SalesDocumentCountrySummary[] = [
  {
    country: 'PL',
    ruleCount: 2,
    invoiceDefaultConnectionId: 'conn_1',
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
  },
];

describe('useSalesDocumentCountriesQuery', () => {
  it('should use salesDocumentRulesQueryKeys.countries() as the query key', () => {
    expect(salesDocumentRulesQueryKeys.countries()).toEqual(['sales-document-rules', 'countries']);
  });

  it('should call apiClient.salesDocumentRules.listConfiguredCountries', async () => {
    const listConfiguredCountries = vi.fn().mockResolvedValue(summaries);
    const apiClient = createMockApiClient({ salesDocumentRules: { listConfiguredCountries } });
    const { result } = renderHook(() => useSalesDocumentCountriesQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listConfiguredCountries).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(summaries);
  });

  it('should surface a rejection as query.isError', async () => {
    const listConfiguredCountries = vi.fn().mockRejectedValue(new Error('boom'));
    const apiClient = createMockApiClient({ salesDocumentRules: { listConfiguredCountries } });
    const { result } = renderHook(() => useSalesDocumentCountriesQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});
