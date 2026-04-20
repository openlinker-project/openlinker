import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table';
import { useState, type Key, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMediaQuery } from './use-media-query';

export type DataTableHideBreakpoint = 480 | 768 | 1024;

export interface DataTableColumn<Row> {
  align?: 'center' | 'left' | 'right';
  cell: (row: Row) => ReactNode;
  header: ReactNode;
  hideBelow?: DataTableHideBreakpoint;
  id: string;
  accessor?: (row: Row) => string | number | boolean | null | undefined;
  sortable?: boolean;
}

export interface DataTableCardView<Row> {
  meta?: (row: Row) => ReactNode;
  subtitle?: (row: Row) => ReactNode;
  title: (row: Row) => ReactNode;
}

interface DataTableProps<Row> {
  caption?: ReactNode;
  cardView?: DataTableCardView<Row>;
  className?: string;
  columns: DataTableColumn<Row>[];
  emptyState?: ReactNode;
  onSortChange?: OnChangeFn<SortingState>;
  rowHref?: (row: Row) => string;
  rowKey: (row: Row) => Key;
  rows: Row[];
  sort?: SortingState;
}

export function DataTable<Row>({
  caption,
  cardView,
  className = '',
  columns,
  emptyState,
  onSortChange,
  rowHref,
  rowKey,
  rows,
  sort,
}: DataTableProps<Row>): ReactElement {
  const defs = buildColumnDefs(columns);
  const [internalSort, setInternalSort] = useState<SortingState>([]);
  const effectiveSort = sort ?? internalSort;
  const effectiveOnSortChange = onSortChange ?? setInternalSort;
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const renderCards = Boolean(cardView) && isMobile;

  const table = useReactTable<Row>({
    data: rows,
    columns: defs,
    state: { sorting: effectiveSort },
    onSortingChange: effectiveOnSortChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const isEmpty = tableRows.length === 0;
  const containerClasses = [
    'data-table__container',
    cardView ? 'data-table__container--with-cards' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const emptyNode = emptyState ?? (
    <div className="empty-state">
      <h2>No records to display</h2>
      <p>There is no data available for this table yet.</p>
    </div>
  );

  return (
    <div className={containerClasses}>
      {!renderCards ? (
      <table className="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const column = columns.find((c) => c.id === header.column.id);
                const canSort = column?.sortable ?? false;
                const sortDir = header.column.getIsSorted();
                const classes = [
                  column?.align ? `data-table__cell--${column.align}` : '',
                  column?.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : '',
                  canSort ? 'data-table__header--sortable' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <th
                    key={header.id}
                    scope="col"
                    className={classes || undefined}
                    aria-sort={
                      canSort
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : sortDir === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="data-table__header-button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="data-table__sort-indicator" aria-hidden="true">
                          {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : '↕'}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isEmpty ? (
            <tr className="data-table__empty-row">
              <td className="data-table__empty-cell" colSpan={columns.length}>
                {emptyNode}
              </td>
            </tr>
          ) : (
            tableRows.map((tanstackRow) => {
              const row = tanstackRow.original;
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={href ? 'data-table__row data-table__row--linked' : 'data-table__row'}
                >
                  {columns.map((column, index) => {
                    const cellClasses = [
                      column.align ? `data-table__cell--${column.align}` : '',
                      column.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    const content =
                      href && index === 0 ? (
                        <Link to={href} className="data-table__row-link">
                          {column.cell(row)}
                        </Link>
                      ) : (
                        column.cell(row)
                      );

                    return (
                      <td key={column.id} className={cellClasses || undefined}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      ) : null}

      {renderCards && cardView ? (
        <ul className="data-table__cards">
          {isEmpty ? (
            <li className="data-table__cards-empty">{emptyNode}</li>
          ) : (
            tableRows.map((tanstackRow) => {
              const row = tanstackRow.original;
              const href = rowHref?.(row);
              const body = (
                <>
                  <div className="data-table__card-main">
                    <strong className="data-table__card-title">{cardView.title(row)}</strong>
                    {cardView.subtitle ? (
                      <span className="data-table__card-subtitle">{cardView.subtitle(row)}</span>
                    ) : null}
                  </div>
                  {cardView.meta ? (
                    <div className="data-table__card-meta">{cardView.meta(row)}</div>
                  ) : null}
                </>
              );

              return (
                <li key={rowKey(row)} className="data-table__card">
                  {href ? (
                    <Link to={href} className="data-table__card-link">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

function buildColumnDefs<Row>(columns: DataTableColumn<Row>[]): ColumnDef<Row>[] {
  return columns.map((column) => ({
    id: column.id,
    header: () => column.header,
    cell: (info) => column.cell(info.row.original),
    enableSorting: column.sortable ?? false,
    accessorFn: column.accessor
      ? (row) => column.accessor!(row) ?? ''
      : undefined,
  }));
}
