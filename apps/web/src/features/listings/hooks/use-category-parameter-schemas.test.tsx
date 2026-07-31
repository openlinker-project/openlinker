/**
 * use-category-parameter-schemas tests (#1946)
 *
 * Pins the contract the bulk edit modal's save path depends on: a resolved
 * category's FULL schema keyed by its id, an ABSENT key while it is in flight
 * (never another category's schema - that silent fallback is #1946), a failed
 * category reported distinctly from a loading one so the caller can explain the
 * block, and dedupe + inertness without a connection.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useCategoryParameterSchemas } from './use-category-parameter-schemas';
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

describe('useCategoryParameterSchemas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  function wrap(
    apiClient: ReturnType<typeof createMockApiClient>,
  ): React.FC<{ children: React.ReactNode }> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }) => (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  }

  it('keys each category to its full schema and dedupes repeated ids', async () => {
    // Arrange
    const getCategoryParameters = vi.fn().mockImplementation((_conn: string, categoryId: string) =>
      Promise.resolve({
        parameters:
          categoryId === 'cat-A'
            ? [param({ id: 'a-1', required: true }), param({ id: 'a-2', section: 'product' })]
            : [param({ id: 'b-1' })],
      }),
    );
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    // Act
    const { result } = renderHook(
      () => useCategoryParameterSchemas('conn-1', ['cat-B', 'cat-A', 'cat-B']),
      { wrapper: wrap(apiClient) },
    );

    // Assert
    await waitFor(() => expect(result.current.schemasByCategory.size).toBe(2));
    // Full schema, not a projection - the serializer needs every parameter.
    expect(result.current.schemasByCategory.get('cat-A')?.map((p) => p.id)).toEqual([
      'a-1',
      'a-2',
    ]);
    expect(result.current.schemasByCategory.get('cat-B')?.map((p) => p.id)).toEqual(['b-1']);
    expect(result.current.failedCategoryIds.size).toBe(0);
    expect(getCategoryParameters).toHaveBeenCalledTimes(2);
  });

  it('leaves the key absent while a category is still loading', async () => {
    // Arrange - never-settling request keeps the query in flight.
    const getCategoryParameters = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    // Act
    const { result } = renderHook(() => useCategoryParameterSchemas('conn-1', ['cat-A']), {
      wrapper: wrap(apiClient),
    });

    // Assert - absent from BOTH collections is what "still in flight" means.
    expect(result.current.schemasByCategory.has('cat-A')).toBe(false);
    expect(result.current.failedCategoryIds.has('cat-A')).toBe(false);
  });

  it('reports a failed category distinctly from a loading one', async () => {
    // Arrange
    const getCategoryParameters = vi.fn().mockRejectedValue(new Error('502 Bad Gateway'));
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    // Act
    const { result } = renderHook(() => useCategoryParameterSchemas('conn-1', ['cat-A']), {
      wrapper: wrap(apiClient),
    });

    // Assert
    await waitFor(() => expect(result.current.failedCategoryIds.has('cat-A')).toBe(true));
    expect(result.current.schemasByCategory.has('cat-A')).toBe(false);
  });

  it('re-runs a failed category on retry', async () => {
    // Arrange - fails once, then succeeds.
    const getCategoryParameters = vi
      .fn()
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValue({ parameters: [param({ id: 'a-1' })] });
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });
    const { result } = renderHook(() => useCategoryParameterSchemas('conn-1', ['cat-A']), {
      wrapper: wrap(apiClient),
    });
    await waitFor(() => expect(result.current.failedCategoryIds.has('cat-A')).toBe(true));

    // Act
    act(() => {
      result.current.retryCategory('cat-A');
    });

    // Assert
    await waitFor(() => expect(result.current.schemasByCategory.has('cat-A')).toBe(true));
    expect(result.current.failedCategoryIds.has('cat-A')).toBe(false);
  });

  it('keeps the derived map referentially stable across re-renders', async () => {
    // Arrange
    const getCategoryParameters = vi
      .fn()
      .mockResolvedValue({ parameters: [param({ id: 'a-1' })] });
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });
    const categoryIds = ['cat-A'];
    const { result, rerender } = renderHook(
      () => useCategoryParameterSchemas('conn-1', categoryIds),
      { wrapper: wrap(apiClient) },
    );
    await waitFor(() => expect(result.current.schemasByCategory.size).toBe(1));
    const first = result.current.schemasByCategory;

    // Act
    rerender();

    // Assert - a fresh Map per render would defeat the caller's useCallbacks.
    expect(result.current.schemasByCategory).toBe(first);
  });

  it('does not fetch without a connection id', () => {
    // Arrange
    const getCategoryParameters = vi.fn();
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    // Act
    const { result } = renderHook(() => useCategoryParameterSchemas(undefined, ['cat-A']), {
      wrapper: wrap(apiClient),
    });

    // Assert
    expect(getCategoryParameters).not.toHaveBeenCalled();
    expect(result.current.schemasByCategory.size).toBe(0);
    expect(result.current.failedCategoryIds.size).toBe(0);
  });

  it('does nothing when there are no categories to resolve', () => {
    // Arrange
    const getCategoryParameters = vi.fn();
    const apiClient = createMockApiClient({ listings: { getCategoryParameters } });

    // Act
    const { result } = renderHook(() => useCategoryParameterSchemas('conn-1', []), {
      wrapper: wrap(apiClient),
    });

    // Assert
    expect(getCategoryParameters).not.toHaveBeenCalled();
    expect(result.current.schemasByCategory.size).toBe(0);
  });
});
