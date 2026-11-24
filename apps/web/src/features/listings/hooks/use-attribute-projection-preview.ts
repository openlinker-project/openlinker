/**
 * use-attribute-projection-preview (#3995)
 *
 * What the destination connection's attribute mappings and rules will fill for
 * each variant of an offer batch. The rules used to run only inside the publish,
 * so the wizard could neither show their values nor let them satisfy its
 * required-parameter check: the operator typed every rule-covered value by hand.
 *
 * Items are sent in chunks the endpoint accepts, keyed on each item's category
 * and EAN override - a rule can be scoped to a category and a `place-value`
 * rule can read the EAN, so a change to either must re-ask.
 *
 * A chunk that fails is a state, not a silence: its variants are reported in
 * `failedVariantIds` rather than left out of the map, because a variant with no
 * entry is indistinguishable from one the rules simply do not cover.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type {
  AttributeProjectionPreviewEntry,
  AttributeProjectionPreviewItem,
} from '../api/listings.types';

/** Matches the endpoint's per-request cap. */
export const ATTRIBUTE_PROJECTION_PREVIEW_CHUNK = 200;

/**
 * Rules change on another page, so a wizard session should not hold an old
 * answer for long - but one Review step should not re-ask on every render.
 */
export const ATTRIBUTE_PROJECTION_PREVIEW_STALE_TIME_MS = 60 * 1000;

export interface AttributeProjectionPreview {
  /** Entry per variant id, for every variant whose chunk answered. */
  byVariant: ReadonlyMap<string, AttributeProjectionPreviewEntry>;
  /** Variants whose chunk failed, or whose own entry reports a failure. */
  failedVariantIds: ReadonlySet<string>;
  isLoading: boolean;
  /** Re-ask for every chunk that failed. */
  retry: () => void;
}

function itemKey(item: AttributeProjectionPreviewItem): string {
  return `${item.variantId}|${item.categoryId}|${item.ean ?? ''}`;
}

export function useAttributeProjectionPreview(
  connectionId: string | null | undefined,
  items: readonly AttributeProjectionPreviewItem[],
): AttributeProjectionPreview {
  const apiClient = useApiClient();

  const chunks = useMemo(() => {
    const sorted = [...items].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
    const out: AttributeProjectionPreviewItem[][] = [];
    for (let i = 0; i < sorted.length; i += ATTRIBUTE_PROJECTION_PREVIEW_CHUNK) {
      out.push(sorted.slice(i, i + ATTRIBUTE_PROJECTION_PREVIEW_CHUNK));
    }
    return out;
  }, [items]);

  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: listingsQueryKeys.attributeProjectionPreview(
        connectionId ?? '',
        chunk.map(itemKey).join(','),
      ),
      queryFn: () =>
        apiClient.listings.previewAttributeProjection(connectionId!, { items: chunk }),
      enabled: Boolean(connectionId),
      staleTime: ATTRIBUTE_PROJECTION_PREVIEW_STALE_TIME_MS,
      retry: 1,
    })),
  });

  // `useQueries` returns a fresh array every render; this stamp changes only
  // when a chunk's answer or status does, so consumers get a stable object.
  const stamp = queries.map((q) => `${q.status}:${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join('|');

  return useMemo(() => {
    const byVariant = new Map<string, AttributeProjectionPreviewEntry>();
    const failedVariantIds = new Set<string>();
    queries.forEach((query, index) => {
      if (query.isError) {
        for (const item of chunks[index] ?? []) failedVariantIds.add(item.variantId);
        return;
      }
      for (const entry of query.data?.entries ?? []) {
        byVariant.set(entry.variantId, entry);
        if (entry.status === 'failed') failedVariantIds.add(entry.variantId);
      }
    });
    return {
      byVariant,
      failedVariantIds,
      isLoading: queries.some((q) => q.isLoading),
      retry: (): void => {
        for (const q of queries) if (q.isError) void q.refetch();
      },
    };
    // `stamp` stands for `queries`, whose identity changes every render.
  }, [chunks, stamp]);
}
