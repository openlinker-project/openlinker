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
import { canonicalQuery, resolveNonViewParams } from './view-query';

export function normalizeView<Row>(registry: ListRegistry<Row>, definition: ViewDefinition): ViewDefinition {
  return {
    ...definition,
    query: canonicalQuery(definition.query, resolveNonViewParams(registry)),
    sort: effectiveSort(registry, definition),
  };
}

/**
 * The definition as it is stored. A list with no sorts has no sort to remember:
 * persisting the placeholder default would later read as a sort the list no
 * longer offers.
 */
export function forStorage<Row>(registry: ListRegistry<Row>, definition: ViewDefinition): ViewDefinition {
  const encoded = registry.storedQuery
    ? { ...definition, query: registry.storedQuery.encode(definition.query) }
    : definition;
  return registry.sorts.length === 0 ? { ...encoded, sort: null } : encoded;
}

/** The inverse of `forStorage`'s query spelling, applied to a definition read back from the server. */
export function decodeStoredQuery<Row>(registry: ListRegistry<Row>, definition: ViewDefinition): ViewDefinition {
  return registry.storedQuery ? { ...definition, query: registry.storedQuery.decode(definition.query) } : definition;
}
