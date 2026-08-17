/**
 * useCategorySearchQuery tests (#2075)
 *
 * The min-length gate is the whole reason this hook exists rather than a bare
 * `useQuery` at each call site — these tests are what keep it from drifting
 * back out into three pickers that can each forget it.
 *
 * @module apps/web/src/features/mappings/hooks
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import {
  useCategorySearchQuery,
  isSearchableCategoryQuery,
  CATEGORY_SEARCH_MIN_QUERY_LENGTH,
} from './use-category-search';
import type { CategorySearchHit } from '../api/mappings.types';

const HIT: CategorySearchHit = {
  category: { id: '258066', name: 'Smartfony', parentId: '258060', leaf: true },
  path: [
    { id: '258000', name: 'Elektronika' },
    { id: '258060', name: 'Telefony' },
    { id: '258066', name: 'Smartfony' },
  ],
};

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

function mockApi(searchCategories = vi.fn().mockResolvedValue([HIT])) {
  return { apiClient: createMockApiClient({ mappings: { searchCategories } }), searchCategories };
}

describe('isSearchableCategoryQuery', () => {
  it('should reject a query shorter than the minimum after trimming', () => {
    expect(isSearchableCategoryQuery('')).toBe(false);
    expect(isSearchableCategoryQuery('a')).toBe(false);
    // Whitespace is not signal — " a " is still one character of query.
    expect(isSearchableCategoryQuery('  a  ')).toBe(false);
  });

  it('should accept a query at the minimum length', () => {
    expect(isSearchableCategoryQuery('ab')).toBe(true);
    expect('ab'.length).toBe(CATEGORY_SEARCH_MIN_QUERY_LENGTH);
  });
});

describe('useCategorySearchQuery', () => {
  it('should not issue a request below the minimum query length', async () => {
    const { apiClient, searchCategories } = mockApi();

    renderHook(() => useCategorySearchQuery('conn-1', 'a'), { wrapper: wrapper(apiClient) });

    // Give the query client a tick to have fired if the gate were missing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(searchCategories).not.toHaveBeenCalled();
  });

  it('should search once the query reaches the minimum length', async () => {
    const { apiClient, searchCategories } = mockApi();

    const { result } = renderHook(() => useCategorySearchQuery('conn-1', 'sm'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.data).toEqual([HIT]));
    expect(searchCategories).toHaveBeenCalledWith('conn-1', 'sm', expect.any(Number));
  });

  it('should trim the query before sending it', async () => {
    const { apiClient, searchCategories } = mockApi();

    renderHook(() => useCategorySearchQuery('conn-1', '  smart  '), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(searchCategories).toHaveBeenCalled());
    expect(searchCategories).toHaveBeenCalledWith('conn-1', 'smart', expect.any(Number));
  });

  it('should stay disabled when the caller disables it, even for a long query', async () => {
    const { apiClient, searchCategories } = mockApi();

    renderHook(() => useCategorySearchQuery('conn-1', 'smartfony', false), {
      wrapper: wrapper(apiClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(searchCategories).not.toHaveBeenCalled();
  });
});
