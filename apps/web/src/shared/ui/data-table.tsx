import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table';
import {
  useCallback,
  useMemo,
  useState,
  type Key,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMediaQuery } from './use-media-query';

export type DataTableHideBreakpoint = 480 | 768 | 1024;

export interface DataTableColumn<Row> {
  align?: 'center' | 'left' | 'right';
  cell: (row: Row) => ReactNode;
  header: ReactNode;
  hideBelow?: DataTableHideBreakpoint;
  id: string;
  /**
   * Used for client-side sorting. `null` / `undefined` are coerced to '' and
   * therefore sort to the top of an ascending sort — document this for callers
   * whose users may expect "nulls last".
   */
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

const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, details, summary, [role="button"]';

function shouldIgnoreRowClick(event: MouseEvent): boolean {
  if (event.defaultPrevented) return true;
  if (event.button !== 0) return true;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  const target = event.target as Element | null;
  if (target?.closest(INTERACTIVE_SELECTOR)) return true;
  return false;
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
  const navigate = useNavigate();
  const defs = useMemo(() => buildColumnDefs(columns), [columns]);
  const columnById = useMemo(() => {
    const map = new Map<string, DataTableColumn<Row>>();
    for (const column of columns) map.set(column.id, column);
    return map;
  }, [columns]);

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

  const makeRowClickHandler = useCallback(
    (href: string) =>
      (event: MouseEvent<HTMLTableRowElement | HTMLLIElement>): void => {
        if (shouldIgnoreRowClick(event)) return;
        void navigate(href);
      },
    [navigate],
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
                  const column = columnById.get(header.column.id);
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
                    onClick={href ? makeRowClickHandler(href) : undefined}
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

              const mainContent = (
                <>
                  <strong className="data-table__card-title">{cardView.title(row)}</strong>
                  {cardView.subtitle ? (
                    <span className="data-table__card-subtitle">{cardView.subtitle(row)}</span>
                  ) : null}
                </>
              );

              return (
                <li
                  key={rowKey(row)}
                  className={
                    href ? 'data-table__card data-table__card--linked' : 'data-table__card'
                  }
                  onClick={href ? makeRowClickHandler(href) : undefined}
                >
                  {href ? (
                    <Link to={href} className="data-table__card-main data-table__card-main--link">
                      {mainContent}
                    </Link>
                  ) : (
                    <div className="data-table__card-main">{mainContent}</div>
                  )}
                  {cardView.meta ? (
                    <div className="data-table__card-meta">{cardView.meta(row)}</div>
                  ) : null}
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
  return columns.map((column) => {
    const accessor = column.accessor;
    return {
      id: column.id,
      header: () => column.header,
      cell: (info) => column.cell(info.row.original),
      enableSorting: column.sortable ?? false,
      accessorFn: accessor ? (row) => accessor(row) ?? '' : undefined,
    };
  });
}
