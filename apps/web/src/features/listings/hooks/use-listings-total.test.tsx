/**
 * Listings two-stage total - the placeholder-page hazard (#2947 review)
 *
 * This list's ROWS query keeps the previous page alive
 * (`placeholderData: keepPreviousData`), which is right for the table and
 * lethal for the total: inferring `offset + rowCount` from a placeholder states
 * the PREVIOUS tab's size as the current one's, and - because the count key
 * omits `lifecycle` - it does so while the correct answer is already cached and
 * in hand.
 */
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useListingsTotal } from './use-listings-total';
import type { ListingsFilters, OfferMapping } from '../api/listings.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';

const BUCKETS = { Active: 3, Invalid: 0, Draft: 900, Ended: 0, Unsynced: 0 };

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * A FULL page - as many rows as the limit asked for - so it implies no exact
 * total and the count is genuinely needed. An empty FIRST page would not do:
 * that is an exact zero, and inferring it is correct.
 */
const fullPage: RowsPage<OfferMapping> = {
  items: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` })) as unknown as OfferMapping[],
  limit: 20,
  offset: 0,
};

/** The Active tab's page: 3 rows out of a 20 limit, so SHORT and inferable. */
const activePage: RowsPage<OfferMapping> = {
  items: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] as unknown as OfferMapping[],
  limit: 20,
  offset: 0,
};

describe('useListingsTotal (#2947 review)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(filters: ListingsFilters, page: RowsPage<OfferMapping>, placeholder: boolean) {
    const apiClient = createMockApiClient({
      listings: {
        count: vi.fn().mockResolvedValue({ total: 903, lifecycleCounts: BUCKETS }),
      },
    });
    return renderHook(() => useListingsTotal(filters, page, placeholder), {
      wrapper: createWrapper(apiClient),
    });
  }

  it('does NOT infer from a placeholder page - it would state the previous tab size', async () => {
    // The operator has clicked Draft (900). The rows are still the Active tab's
    // three, kept by `keepPreviousData`. Inferring gives 3, and 3 would render
    // as an authoritative "of 3" beside a tab badge reading 900, with Next
    // disabled so the tab could not be paged at all.
    const { result } = mount({ lifecycle: 'Draft' }, activePage, true);

    await flush();

    expect(result.current.total).toBe(900);
    expect(result.current.state).toBe('known');
  });

  it('DOES infer from a settled page, which is what keeps a short list instant', async () => {
    const { result } = mount({ lifecycle: 'Active' }, activePage, false);

    // No await: the inference is synchronous, which is the point - the pager
    // shows the real number the moment the rows land, while the buckets are
    // still counting.
    expect(result.current.total).toBe(3);
    expect(result.current.state).toBe('known');
  });

  it('reports UNKNOWN when a selected tab has no buckets to derive from', async () => {
    // Without `lifecycleCounts` the payload's own `total` is the un-narrowed
    // sum across every bucket. Rendering it as the selected tab's size would
    // print the whole catalogue as that tab's, presented as certain.
    const apiClient = createMockApiClient({
      listings: { count: vi.fn().mockResolvedValue({ total: 903 }) },
    });
    const { result } = renderHook(
      () => useListingsTotal({ lifecycle: 'Draft' }, fullPage, false),
      { wrapper: createWrapper(apiClient) }
    );

    await flush();

    expect(result.current.total).toBeNull();
    expect(result.current.total).not.toBe(903);
    expect(result.current.state).toBe('unavailable');
  });

  it('falls back to the un-narrowed sum only when NO tab is selected', async () => {
    const apiClient = createMockApiClient({
      listings: { count: vi.fn().mockResolvedValue({ total: 903 }) },
    });
    const { result } = renderHook(
      () => useListingsTotal({}, fullPage, false),
      { wrapper: createWrapper(apiClient) }
    );

    await flush();

    // With no tab, the sum IS the answer to the question being asked.
    expect(result.current.total).toBe(903);
    expect(result.current.state).toBe('known');
  });
});
