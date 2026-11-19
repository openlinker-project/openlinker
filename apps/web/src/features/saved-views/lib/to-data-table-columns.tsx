/**
 * toDataTableColumns
 *
 * Adapter from a page's column registry plus a view onto the existing
 * `DataTable`: columns in the view's order, a stacked column rendering only its
 * visible fields, and a header built from those same fields so hiding a field
 * hides its sort button too. The table stays unaware of views.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import { Fragment, type ReactNode } from 'react';
import { SortField, SortStack, StaticSortLabel } from '../../../shared/ui/sort-field';
import type { DataTableColumn } from '../../../shared/ui/data-table';
import { partsOf } from './column-parts';
import type { ViewDefinition } from './saved-view.types';
import type { ColumnDef, ListRegistry, ViewHeaderContext } from './view-registry.types';

function sortField(context: ViewHeaderContext, key: string, label: string): ReactNode {
  const active = context.sort.key === key;
  return (
    <SortField
      key={key + label}
      label={label}
      active={active}
      dir={context.sort.dir}
      ariaLabel={context.sortLabel(label, active, context.sort.dir)}
      onClick={() => context.onSort(key)}
    />
  );
}

function columnSortKeys<Row>(column: ColumnDef<Row>, definition: Pick<ViewDefinition, 'parts'>): string[] {
  if (column.parts) {
    const own = partsOf(column, definition).flatMap((part) => (part.sort ? [part.sort] : []));
    const extra = (column.headerControls ?? []).flatMap((control) => (control.sort ? [control.sort] : []));
    return own.concat(extra);
  }
  return column.sortKey ? [column.sortKey] : [];
}

function columnHeader<Row>(
  column: ColumnDef<Row>,
  definition: Pick<ViewDefinition, 'parts'>,
  context: ViewHeaderContext,
): ReactNode {
  if (column.parts) {
    const labelled: Array<{ id: string; sort?: string; label: string }> = [
      ...partsOf(column, definition)
        .filter((part) => part.headerLabel)
        .map((part) => ({ id: part.id, sort: part.sort, label: part.headerLabel ?? part.label })),
      ...(column.headerControls ?? []),
    ];
    if (labelled.some((part) => part.sort)) {
      return (
        <SortStack end={column.align === 'right'}>
          {labelled.map((part) =>
            part.sort ? (
              sortField(context, part.sort, part.label)
            ) : (
              <StaticSortLabel key={part.id} label={part.label} />
            ),
          )}
        </SortStack>
      );
    }
    return column.header ?? column.label;
  }
  if (column.sortKey) {
    return sortField(context, column.sortKey, typeof column.header === 'string' ? column.header : column.label);
  }
  return column.header ?? column.label;
}

export function toDataTableColumns<Row>(
  registry: ListRegistry<Row>,
  definition: Pick<ViewDefinition, 'columns' | 'parts'>,
  context: ViewHeaderContext,
): DataTableColumn<Row>[] {
  const ariaSort = (keys: string[]): 'ascending' | 'descending' | undefined =>
    keys.includes(context.sort.key) ? (context.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;

  const locked = registry.locked;
  const result: DataTableColumn<Row>[] = [
    {
      id: locked.id,
      header: typeof locked.header === 'function' ? locked.header(context) : locked.header,
      cell: locked.render,
      width: locked.width,
      hideBelow: locked.hideBelow,
      lines: locked.lines,
      ariaSort: ariaSort(locked.sortKeys ?? []),
    },
  ];

  for (const id of definition.columns) {
    const column = registry.columns.find((candidate) => candidate.id === id);
    if (!column) continue;
    result.push({
      id: column.id,
      header: columnHeader(column, definition, context),
      align: column.align,
      width: column.width,
      hideBelow: column.hideBelow,
      lines: column.lines,
      ariaSort: ariaSort(columnSortKeys(column, definition)),
      cell: (row: Row) =>
        column.parts ? (
          <>
            {partsOf(column, definition).map((part) => (
              <Fragment key={part.id}>{part.render(row)}</Fragment>
            ))}
          </>
        ) : (
          column.render?.(row) ?? null
        ),
    });
  }
  return result;
}
