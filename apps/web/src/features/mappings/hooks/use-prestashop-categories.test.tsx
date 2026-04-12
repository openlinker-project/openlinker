/**
 * usePrestashopCategoriesQuery tests
 *
 * Regression coverage for the camelCase-shape mismatch that previously caused
 * the Category Mappings page to render as empty despite the API returning data.
 *
 * @module apps/web/src/features/mappings/hooks
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import type { PrestashopCategory } from '../api/mappings.types';
import { createMockApiClient } from '../../../test/test-utils';
import { usePrestashopCategoriesQuery } from './use-prestashop-categories';

function wrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): (props: { children: ReactNode }) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('usePrestashopCategoriesQuery', () => {
  it('drops the root category and passes camelCase fields through', async () => {
    const raw: PrestashopCategory[] = [
      { id: '1', name: 'Root', parentId: null, depth: 0, active: true },
      { id: '2', name: 'Home', parentId: '1', depth: 1, active: true },
      { id: '3', name: 'Clothes', parentId: '2', depth: 2, active: true },
    ];
    const apiClient = createMockApiClient({
      mappings: { getPrestashopCategories: vi.fn().mockResolvedValue(raw) },
    });

    const { result } = renderHook(() => usePrestashopCategoriesQuery('conn-1'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      { id: '2', name: 'Home', parentId: '1', depth: 1 },
      { id: '3', name: 'Clothes', parentId: '2', depth: 2 },
    ]);
    expect(apiClient.mappings.getPrestashopCategories).toHaveBeenCalledWith('conn-1');
  });

  it('falls back to "Category {id}" when the name is empty', async () => {
    const raw: PrestashopCategory[] = [
      { id: '7', name: '', parentId: '2', depth: 2, active: true },
    ];
    const apiClient = createMockApiClient({
      mappings: { getPrestashopCategories: vi.fn().mockResolvedValue(raw) },
    });

    const { result } = renderHook(() => usePrestashopCategoriesQuery('conn-1'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      { id: '7', name: 'Category 7', parentId: '2', depth: 2 },
    ]);
  });
});
