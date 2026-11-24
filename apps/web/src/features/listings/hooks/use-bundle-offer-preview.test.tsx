/**
 * use-bundle-offer-preview tests (#3520)
 *
 * Regression: the wizard derives `items` from rows that the preview is written
 * back into, so a fresh array with the same content must keep the same result
 * identity, or Review loops until React throws "maximum update depth" (#185).
 *
 * @module apps/web/src/features/listings/hooks
 */
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useBundleOfferPreview } from './use-bundle-offer-preview';

describe('useBundleOfferPreview', () => {
  afterEach(cleanup);

  it('should keep the bundles map identity when items are re-created with the same content', async () => {
    const apiClient = createMockApiClient();
    (apiClient.listings.previewBundleOffers as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      entries: [{ variantId: 'v1', status: 'ok' }],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useBundleOfferPreview('c1', [{ variantId: 'v1' }].slice(0, n)),
      { wrapper, initialProps: { n: 1 } },
    );
    await waitFor(() => expect(result.current.bundles.size).toBe(1));
    const first = result.current.bundles;
    rerender({ n: 1 });
    rerender({ n: 1 });
    expect(result.current.bundles).toBe(first);
  });
});
