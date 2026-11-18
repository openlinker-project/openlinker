/**
 * Column Parts
 *
 * Pure rules for the fields of stacked columns: which are visible, in what
 * order, and how a change is stored. Ported one-to-one from the prototype
 * engine (`partIds`, `partsOf`, `setPartsIn`, `reorder`).
 *
 * @module apps/web/src/features/saved-views/lib
 */
import type { ColumnDef, PartDef } from './view-registry.types';
import type { ViewDefinition } from './saved-view.types';

type Parts = Pick<ViewDefinition, 'parts'>;

/** Every field id of a column in its default order. */
export function partIds<Row>(column: ColumnDef<Row>): string[] {
  return (column.parts ?? []).map((part) => part.id);
}

/** The visible fields of a column, in the order the view shows them. Unknown ids are skipped. */
export function partsOf<Row>(column: ColumnDef<Row>, view: Parts): PartDef<Row>[] {
  const all = column.parts ?? [];
  const ids = view.parts[column.id] ?? partIds(column);
  const visible: PartDef<Row>[] = [];
  for (const id of ids) {
    const part = all.find((candidate) => candidate.id === id);
    if (part) visible.push(part);
  }
  return visible;
}

/** Stores a column's fields, keeping only deviations from the column default. */
export function setPartsIn<Row, V extends Parts>(column: ColumnDef<Row>, view: V, ids: string[]): V {
  const parts = { ...view.parts };
  if (ids.join() === partIds(column).join()) delete parts[column.id];
  else parts[column.id] = ids;
  return { ...view, parts };
}

/** Moves an item; an out-of-range target leaves the list as it was. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from < 0 || from >= items.length) return items.slice();
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
