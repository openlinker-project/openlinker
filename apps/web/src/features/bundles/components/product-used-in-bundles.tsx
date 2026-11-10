/**
 * "Used in bundles" (#3624): which bundles hold a product as a component and
 * whether as a gift, so an operator knows changing its stock changes theirs.
 * Renders nothing when the product is in no bundle - there is no "none"
 * reassurance, because a failed read looks identical to an empty one.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApiClient } from '../../../app/api/api-client-provider';
import { interpolate, useMessages } from '../../../shared/i18n';
import { bundlesQueryKeys } from '../api/bundles.query-keys';

export function ProductUsedInBundles({
  variantIds,
}: {
  variantIds: readonly string[];
}): ReactElement | null {
  const copy = useMessages('bundles');
  const apiClient = useApiClient();
  const result = useQuery({
    queryKey: bundlesQueryKeys.usedInMany(variantIds),
    queryFn: () => apiClient.bundles.usedInMany(variantIds),
    enabled: variantIds.length > 0,
    retry: false,
    staleTime: 30_000,
  });
  const entries = result.data ?? [];
  if (entries.length === 0) {
    return null;
  }
  return (
    <section className="bundle-used-in" data-testid="bundle-list-used-in">
      <div className="products-detail-field__label">{copy.list.usedInTitle}</div>
      <p className="text-muted">{copy.list.usedInIntro}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((entry) => (
          <li key={`${entry.bundleVariantId}:${entry.componentVariantId ?? ''}`} data-testid={`bundle-list-used-in-${entry.bundle.sku ?? entry.bundleVariantId}`}>
            <Link to={`/products/bundles/${entry.bundleVariantId}`}>
              {interpolate(copy.list.usedInBundle, {
                n: entry.quantity,
                name: entry.bundle.name ?? entry.bundle.sku ?? entry.bundleVariantId,
              })}
            </Link>
            {entry.giftSlot === true ? <span className="text-muted"> ({copy.list.usedInGift})</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
