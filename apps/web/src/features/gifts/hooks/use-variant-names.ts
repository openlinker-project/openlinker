/**
 * Product names for the variant ids a saved rule holds (#3940)
 *
 * A rule stores internal ids; the composer shows names. Derived from
 * {@link useVariantSummaries}, so it shares that hook's cache and its one
 * product read per distinct product instead of issuing reads of its own.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import { useMemo } from 'react';
import { useVariantSummaries } from './use-variant-summaries';

export function useVariantNames(variantIds: readonly string[]): ReadonlyMap<string, string> {
  const summaries = useVariantSummaries(variantIds);
  return useMemo(() => {
    const names = new Map<string, string>();
    summaries.forEach((summary, id) => names.set(id, summary.name));
    return names;
  }, [summaries]);
}
