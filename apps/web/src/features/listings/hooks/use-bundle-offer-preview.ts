/**
 * use-bundle-offer-preview (#3520)
 *
 * How each bundle variant of an offer batch would publish as a product-set
 * offer: its components with how each enters the set, what blocks it, the
 * category the destination requires and how many whole sets are sellable.
 *
 * Mirrors `useAttributeProjectionPreview`: chunked to the endpoint's cap, and a
 * chunk that fails is reported in `failedVariantIds` rather than left out of the
 * map, because a bundle with no entry would read as an ordinary product and
 * quietly bring back every blocker that does not apply to a set.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { BundleOfferPreviewEntry, BundleOfferPreviewItem } from '../api/listings.types';

/** Matches the endpoint's per-request cap. */
export const BUNDLE_OFFER_PREVIEW_CHUNK = 100;

/** Marketplace state changes under the operator's feet; one Review need not re-ask on every render. */
export const BUNDLE_OFFER_PREVIEW_STALE_TIME_MS = 60 * 1000;

export type BundleOfferPreviewOk = Extract<BundleOfferPreviewEntry, { status: 'ok' }>;

export interface BundleOfferPreview {
  /** Entry per variant id that answered with `status: 'ok'`: the bundles. */
  bundles: ReadonlyMap<string, BundleOfferPreviewOk>;
  /** Variants whose chunk failed, or whose own entry reports a failure. */
  failedVariantIds: ReadonlySet<string>;
  isLoading: boolean;
  retry: () => void;
}

export const EMPTY_BUNDLE_PREVIEW: BundleOfferPreview = {
  bundles: new Map(),
  failedVariantIds: new Set(),
  isLoading: false,
  retry: () => undefined,
};

function itemKey(item: BundleOfferPreviewItem): string {
  return `${item.variantId}|${item.categoryId ?? ''}`;
}

export function useBundleOfferPreview(
  connectionId: string | null | undefined,
  items: readonly BundleOfferPreviewItem[],
): BundleOfferPreview {
  const apiClient = useApiClient();

  const chunks = useMemo(() => {
    const sorted = [...items].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
    const out: BundleOfferPreviewItem[][] = [];
    for (let i = 0; i < sorted.length; i += BUNDLE_OFFER_PREVIEW_CHUNK) {
      out.push(sorted.slice(i, i + BUNDLE_OFFER_PREVIEW_CHUNK));
    }
    return out;
  }, [items]);

  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: listingsQueryKeys.bundleOfferPreview(
        connectionId ?? '',
        chunk.map(itemKey).join(','),
      ),
      queryFn: () => apiClient.listings.previewBundleOffers(connectionId!, { items: chunk }),
      enabled: Boolean(connectionId),
      staleTime: BUNDLE_OFFER_PREVIEW_STALE_TIME_MS,
      retry: 1,
    })),
  });

  const stamp = queries.map((q) => `${q.status}:${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join('|');

  return useMemo(() => {
    const bundles = new Map<string, BundleOfferPreviewOk>();
    const failedVariantIds = new Set<string>();
    queries.forEach((query, index) => {
      if (query.isError) {
        for (const item of chunks[index] ?? []) failedVariantIds.add(item.variantId);
        return;
      }
      for (const entry of query.data?.entries ?? []) {
        if (entry.status === 'ok') bundles.set(entry.variantId, entry);
        else if (entry.status === 'failed') failedVariantIds.add(entry.variantId);
      }
    });
    return {
      bundles,
      failedVariantIds,
      isLoading: queries.some((q) => q.isLoading),
      retry: (): void => {
        for (const q of queries) if (q.isError) void q.refetch();
      },
    };
    // `stamp` stands for `queries`, whose identity changes every render.
  }, [chunks, stamp]);
}
