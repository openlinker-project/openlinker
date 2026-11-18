/**
 * Reconcile View
 *
 * A saved view can outlive the page it was written for: a column is renamed, a
 * filter value is retired. Instead of failing, loading skips what no longer
 * exists and reports it as typed issues, so the UI can offer a repair rather
 * than silently showing a different list.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import { partIds } from './column-parts';
import type { ReconcileResult, ViewDefinition, ViewIssue, ViewSort } from './saved-view.types';
import type { ListRegistry, SystemViewDef } from './view-registry.types';
import { canonicalQuery, filterEntries } from './view-query';

export function defaultColumnIds<Row>(registry: ListRegistry<Row>): string[] {
  return registry.columns.filter((column) => column.defaultVisible).map((column) => column.id);
}

export function definitionFromSystemView<Row>(
  registry: ListRegistry<Row>,
  view: SystemViewDef,
): ViewDefinition {
  return {
    v: 1,
    query: canonicalQuery(view.query, registry.nonViewParams),
    sort: view.sort === undefined ? registry.defaultSort : view.sort,
    columns: view.columns ?? defaultColumnIds(registry),
    parts: view.parts ?? {},
  };
}

/** The effective sort of a definition: its own, or the page default. */
export function effectiveSort<Row>(registry: ListRegistry<Row>, definition: ViewDefinition): ViewSort {
  return definition.sort ?? registry.defaultSort;
}

export function reconcileView<Row>(
  definition: ViewDefinition,
  registry: ListRegistry<Row>,
): ReconcileResult {
  const issues: ViewIssue[] = [];

  const columns: string[] = [];
  for (const id of definition.columns) {
    if (registry.columns.some((column) => column.id === id)) columns.push(id);
    else issues.push({ kind: 'unknown-column', columnId: id });
  }

  const parts: Record<string, string[]> = {};
  for (const [columnId, ids] of Object.entries(definition.parts)) {
    const column = registry.columns.find((candidate) => candidate.id === columnId);
    // A column that vanished is already reported through `columns`.
    if (!column?.parts) continue;
    const known = ids.filter((id) => column.parts?.some((part) => part.id === id));
    if (known.length !== ids.length) {
      issues.push({
        kind: 'unknown-part',
        columnId,
        partIds: ids.filter((id) => !known.includes(id)),
      });
    }
    if (known.length > 0 && known.join() !== partIds(column).join()) parts[columnId] = known;
  }

  const kept = new URLSearchParams();
  for (const [key, value] of filterEntries(definition.query, registry.nonViewParams)) {
    const filter = registry.filters.find((candidate) => candidate.key === key);
    if (!filter) issues.push({ kind: 'unknown-filter', key });
    else if (filter.parse && !filter.parse(value)) issues.push({ kind: 'invalid-filter-value', key, value });
    else kept.append(key, value);
  }

  let sort = definition.sort;
  if (sort && !registry.sorts.some((option) => option.key === sort?.key)) {
    issues.push({ kind: 'unknown-sort', key: sort.key });
    sort = registry.defaultSort;
  }

  return {
    definition: {
      ...definition,
      columns: columns.length > 0 ? columns : defaultColumnIds(registry),
      parts,
      query: canonicalQuery(kept, registry.nonViewParams),
      sort,
    },
    issues,
  };
}
