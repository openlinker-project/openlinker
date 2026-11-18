/**
 * Normalize View
 *
 * One spelling per list state, so "is it edited?" is a plain comparison: the
 * filter query in canonical order, and a concrete sort (a view that says "the
 * page default" and one that names it are the same list).
 *
 * @module apps/web/src/features/saved-views/lib
 */
import { effectiveSort } from './reconcile-view';
import type { ViewDefinition } from './saved-view.types';
import type { ListRegistry } from './view-registry.types';
import { canonicalQuery } from './view-query';

export function normalizeView<Row>(registry: ListRegistry<Row>, definition: ViewDefinition): ViewDefinition {
  return {
    ...definition,
    query: canonicalQuery(definition.query, registry.nonViewParams),
    sort: effectiveSort(registry, definition),
  };
}
