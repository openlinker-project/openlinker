/**
 * use-bulk-required-product-params tests (#810)
 *
 * Verifies the per-category fan-out returns the required, unconditional,
 * product-section parameter ids — and only those — and stays inert with no
 * categories to resolve.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useBulkRequiredProductParams } from './use-bulk-required-product-params';
import type { CategoryParameter } from '../api/listings.types';

function param(overrides: Partial<CategoryParameter>): CategoryParameter {
  return {
    id: 'p',
    name: 'P',
    type: 'string',
    required: false,
    restrictions: {},
    section: 'offer',
    ...overrides,
  };
}

describe('useBulkRequiredProductParams', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  function wrap(apiClient: ReturnType<typeof createMockApiClient>): React.FC<{ children: React.ReactNode }> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }) => (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  }

  it('keeps only required, unconditional, product-section params', async () => {
    const getCategoryParameters = vi.fn().mockResolvedValue({
      parameters: [
        param({ id: 'brand', required: true, section: 'product' }), // keep
        param({ id: 'model', required: true, section: 'product' }), // keep
        param({ id: 'color', required: false, section: 'product' }), // drop — optional
        param({ id: 'warranty', required: true, section: 'offer' }), // drop — offer section
        param({
          id: 'sub-type',
          required: true,
          section: 'product',
          dependsOn: { parameterId: 'brand', valueIds: ['x'] },
        }), // drop — conditional
      ],
    });
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    const { result } = renderHook(() => useBulkRequiredProductParams('conn-1', ['cat-A']), {
      wrapper: wrap(apiClient),
    });

    await waitFor(() => expect(result.current.requiredByCategory.has('cat-A')).toBe(true));
    expect(result.current.requiredByCategory.get('cat-A')).toEqual(['brand', 'model']);
    expect(result.current.isResolving).toBe(false);
  });

  it('resolves an empty category with an empty id list (no required product params)', async () => {
    const getCategoryParameters = vi.fn().mockResolvedValue({
      parameters: [param({ id: 'warranty', required: true, section: 'offer' })],
    });
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    const { result } = renderHook(() => useBulkRequiredProductParams('conn-1', ['cat-A']), {
      wrapper: wrap(apiClient),
    });

    await waitFor(() => expect(result.current.requiredByCategory.has('cat-A')).toBe(true));
    expect(result.current.requiredByCategory.get('cat-A')).toEqual([]);
  });

  it('maps multiple categories and dedupes repeats', async () => {
    const getCategoryParameters = vi.fn().mockImplementation((_conn: string, categoryId: string) =>
      Promise.resolve({
        parameters:
          categoryId === 'cat-A'
            ? [param({ id: 'brand', required: true, section: 'product' })]
            : [param({ id: 'gtin', required: true, section: 'product' })],
      }),
    );
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    const { result } = renderHook(
      () => useBulkRequiredProductParams('conn-1', ['cat-A', 'cat-B', 'cat-A']),
      { wrapper: wrap(apiClient) },
    );

    await waitFor(() => expect(result.current.requiredByCategory.size).toBe(2));
    expect(result.current.requiredByCategory.get('cat-A')).toEqual(['brand']);
    expect(result.current.requiredByCategory.get('cat-B')).toEqual(['gtin']);
    // Deduped: 'cat-A' fetched once despite appearing twice.
    expect(getCategoryParameters).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no categories to resolve', () => {
    const getCategoryParameters = vi.fn();
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    const { result } = renderHook(() => useBulkRequiredProductParams('conn-1', []), {
      wrapper: wrap(apiClient),
    });

    expect(result.current.requiredByCategory.size).toBe(0);
    expect(result.current.isResolving).toBe(false);
    expect(getCategoryParameters).not.toHaveBeenCalled();
  });

  it('does not fetch without a connection id', () => {
    const getCategoryParameters = vi.fn();
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    renderHook(() => useBulkRequiredProductParams(undefined, ['cat-A']), {
      wrapper: wrap(apiClient),
    });

    expect(getCategoryParameters).not.toHaveBeenCalled();
  });
});
