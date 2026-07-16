import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type Row as TanStackRow,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  /**
   * Leading selection slot (e.g. a checkbox), rendered outside the card's
   * navigation Link so toggling it never navigates. Keeps multi-select usable
   * in the mobile card layout (#1620).
   */
  select?: (row: Row) => ReactNode;
  /**
   * Full field set for the card body — the mobile counterpart of the desktop
   * expandable detail panel. Rendered below the meta row so a card shows every
   * field without an expand step (#1620), unless `collapsibleDetail` is set.
   */
  detail?: (row: Row) => ReactNode;
  /**
   * Always-visible summary block rendered between the meta row and the detail
   * (#1713) — the handful of facts worth showing before expanding. Distinct
   * from `detail`, which carries the full long-form field set.
   */
  summary?: (row: Row) => ReactNode;
  /**
   * When true, `detail` is collapsed behind a "View full details" disclosure
   * (#1713) instead of always rendered — so the card leads with `title` /
   * `subtitle` / `meta` / `summary` and the long field set is opt-in. Defaults
   * to false: existing consumers keep the always-expanded card body.
   */
  collapsibleDetail?: boolean;
}

/**
 * Per-row expandable detail (#1620). When provided, the desktop table renders a
 * leading toggle column; clicking a row (or its toggle) reveals `renderDetail`
 * in an accordion panel beneath the row instead of navigating. Interactive
 * elements inside the row (links, buttons, checkboxes) still short-circuit the
 * toggle. Expandable takes precedence over `rowHref` for the row-level click.
 *
 * **Not supported together with `virtualize`.** The virtualizer forces every
 * row to a fixed `estimateRowHeight`, which a variable-height detail panel
 * would break. Rather than silently rendering a toggle that does nothing,
 * `DataTable` disables virtualization (falls back to rendering every row) for
 * as long as `expandable` is set, and logs a dev-only console warning so a
 * future caller who reaches for both on the same table notices immediately
 * instead of shipping a table whose expand affordance quietly does nothing.
 * If a future table genuinely needs both at once, teach the virtualizer to
 * measure dynamic row heights (e.g. `virtualizer.measureElement`) rather than
 * re-enabling this combination as-is.
 */
export interface DataTableExpandable<Row> {
  renderDetail: (row: Row) => ReactNode;
  /** aria-label for the per-row toggle button. */
  toggleLabel?: (row: Row, expanded: boolean) => string;
}

interface DataTableProps<Row> {
  caption?: ReactNode;
  cardView?: DataTableCardView<Row>;
  className?: string;
  columns: DataTableColumn<Row>[];
  /** Fixed scroll-container height when virtualize is enabled. Default 560. */
  containerHeight?: number;
  emptyState?: ReactNode;
  /** Per-row expandable detail panel (desktop accordion). See {@link DataTableExpandable}. */
  expandable?: DataTableExpandable<Row>;
  /** Per-row height estimate used by the virtualizer. Default 36. */
  estimateRowHeight?: number;
  /**
   * Server-controlled sorting (#944). When true, the table does not reorder
   * rows itself — it renders `rows` as-given and only tracks the active sort
   * column/direction for the header affordance, firing `onSortChange` on click.
   * Use when the backend already applied the sort (e.g. a paginated list where
   * client sort would only reorder the visible page). Default false (client
   * sort, unchanged for existing consumers).
   */
  manualSorting?: boolean;
  onSortChange?: OnChangeFn<SortingState>;
  rowHref?: (row: Row) => string;
  rowKey: (row: Row) => Key;
  rows: Row[];
  sort?: SortingState;
  /**
   * When true, the table body renders only rows visible inside a fixed-height
   * scroll container. Use for lists that commonly exceed ~200 rows.
   *
   * Rows are forced to `estimateRowHeight` pixels — content taller than that
   * clips. Only enable on surfaces whose row content you control.
   */
  virtualize?: boolean;
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
  containerHeight = 560,
  emptyState,
  expandable,
  estimateRowHeight = 36,
  manualSorting = false,
  onSortChange,
  rowHref,
  rowKey,
  rows,
  sort,
  virtualize = false,
}: DataTableProps<Row>): ReactElement {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // Expansion state (#1620) — keyed by `rowKey`, so it survives re-sorts and
  // page-data churn as long as the same row stays present.
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(new Set());
  const toggleExpanded = useCallback((key: Key): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Leading toggle column widens the desktop body/header/padding colSpans.
  const columnCount = columns.length + (expandable ? 1 : 0);

  const table = useReactTable<Row>({
    data: rows,
    columns: defs,
    state: { sorting: effectiveSort },
    onSortingChange: effectiveOnSortChange,
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    // Skip the client sorted-row model in server-sort mode so the table renders
    // `rows` in the order the backend returned them (#944).
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
  });

  if (import.meta.env.DEV && expandable && virtualize) {
    // eslint-disable-next-line no-console -- dev-only guard, see DataTableExpandable JSDoc
    console.warn(
      '[DataTable] `expandable` and `virtualize` were both provided; `virtualize` is ' +
        'ignored while `expandable` is set (a variable-height detail row cannot live ' +
        'inside a fixed-height virtualized row). See the DataTableExpandable JSDoc in ' +
        'data-table.tsx.',
    );
  }

  const tableRows = table.getRowModel().rows;
  const isEmpty = tableRows.length === 0;
  // `expandable` wins over `virtualize` — see the DataTableExpandable JSDoc.
  const virtualizeActive = virtualize && !renderCards && !isEmpty && !expandable;
  const containerClasses = [
    'data-table__container',
    cardView ? 'data-table__container--with-cards' : '',
    virtualizeActive ? 'data-table__container--virtual' : '',
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

  const makeRowExpandHandler = useCallback(
    (key: Key) =>
      (event: MouseEvent<HTMLTableRowElement>): void => {
        if (shouldIgnoreRowClick(event)) return;
        toggleExpanded(key);
      },
    [toggleExpanded],
  );

  const virtualizer = useVirtualizer({
    count: virtualizeActive ? tableRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  });

  const renderBodyRow = (
    tanstackRow: TanStackRow<Row>,
    style?: CSSProperties,
    withDetail = true,
  ): ReactElement => {
    const row = tanstackRow.original;
    const key = rowKey(row);
    const href = rowHref?.(row);
    // Expandable takes precedence over rowHref for the row-level click.
    const expanded = expandable ? expandedKeys.has(key) : false;
    // Auto-link the first cell only in pure-navigation mode (no expand toggle).
    const linkifyFirstCell = Boolean(href) && !expandable;
    const rowClasses = [
      'data-table__row',
      expandable ? 'data-table__row--expandable' : href ? 'data-table__row--linked' : '',
      expanded ? 'data-table__row--expanded' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const onClick = expandable
      ? makeRowExpandHandler(key)
      : href
        ? makeRowClickHandler(href)
        : undefined;

    const bodyRow = (
      <tr key={key} className={rowClasses} onClick={onClick} style={style}>
        {expandable ? (
          <td className="data-table__expand-cell">
            <button
              type="button"
              className="data-table__expand-toggle"
              aria-expanded={expanded}
              aria-label={
                expandable.toggleLabel?.(row, expanded) ??
                (expanded ? 'Collapse row details' : 'Expand row details')
              }
              onClick={(event) => {
                event.stopPropagation();
                toggleExpanded(key);
              }}
            >
              <span className="data-table__expand-icon" aria-hidden="true">
                {expanded ? '▾' : '▸'}
              </span>
            </button>
          </td>
        ) : null}
        {columns.map((column, index) => {
          const cellClasses = [
            column.align ? `data-table__cell--${column.align}` : '',
            column.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : '',
          ]
            .filter(Boolean)
            .join(' ');

          const content =
            linkifyFirstCell && href && index === 0 ? (
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

    if (!expandable || !withDetail) return bodyRow;

    return (
      <Fragment key={key}>
        {bodyRow}
        {expanded ? (
          <tr className="data-table__detail-row">
            <td className="data-table__detail-cell" colSpan={columnCount}>
              <div className="data-table__detail">{expandable.renderDetail(row)}</div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  const renderTable = (): ReactElement => (
    <table className="data-table">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {expandable ? (
              <th scope="col" className="data-table__expand-cell">
                <span className="sr-only">Expand row</span>
              </th>
            ) : null}
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
            <td className="data-table__empty-cell" colSpan={columnCount}>
              {emptyNode}
            </td>
          </tr>
        ) : virtualizeActive ? (
          renderVirtualRows()
        ) : (
          tableRows.map((tanstackRow) => renderBodyRow(tanstackRow))
        )}
      </tbody>
    </table>
  );

  function renderVirtualRows(): ReactElement[] {
    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const paddingTop = virtualItems[0]?.start ?? 0;
    const paddingBottom =
      virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

    const rows: ReactElement[] = [];
    if (paddingTop > 0) {
      rows.push(
        <tr key="__padding_top" aria-hidden="true" style={{ height: paddingTop }}>
          <td colSpan={columnCount} />
        </tr>,
      );
    }
    for (const virtualItem of virtualItems) {
      const tanstackRow = tableRows[virtualItem.index];
      // This path only runs when `expandable` is absent (virtualizeActive is
      // forced false while `expandable` is set — see the DataTableExpandable
      // JSDoc), so `withDetail=false` here is defensive, not load-bearing.
      rows.push(renderBodyRow(tanstackRow, { height: virtualItem.size }, false));
    }
    if (paddingBottom > 0) {
      rows.push(
        <tr key="__padding_bottom" aria-hidden="true" style={{ height: paddingBottom }}>
          <td colSpan={columnCount} />
        </tr>,
      );
    }
    return rows;
  }

  const plainScrollable = !renderCards && !virtualizeActive;

  return (
    <div
      className={containerClasses}
      tabIndex={plainScrollable ? 0 : undefined}
      role={plainScrollable ? 'region' : undefined}
      aria-label={
        plainScrollable
          ? typeof caption === 'string'
            ? `${caption} (scrollable)`
            : 'Scrollable table'
          : undefined
      }
    >
      {!renderCards ? (
        virtualizeActive ? (
          <div
            ref={scrollRef}
            className="data-table__virtual-scroller"
            style={{ height: containerHeight }}
            tabIndex={0}
            role="region"
            aria-label={typeof caption === 'string' ? `${caption} (scrollable)` : 'Scrollable table'}
          >
            {renderTable()}
          </div>
        ) : (
          renderTable()
        )
      ) : null}

      {renderCards && cardView ? (
        <ul className="data-table__cards">
          {isEmpty ? (
            <li className="data-table__cards-empty">{emptyNode}</li>
          ) : (
            tableRows.map((tanstackRow) => {
              const row = tanstackRow.original;
              const href = rowHref?.(row);
              return (
                <DataTableCard
                  key={rowKey(row)}
                  row={row}
                  cardView={cardView}
                  href={href}
                  onClick={href ? makeRowClickHandler(href) : undefined}
                />
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

interface DataTableCardProps<Row> {
  row: Row;
  cardView: DataTableCardView<Row>;
  href?: string;
  onClick?: (event: MouseEvent<HTMLLIElement>) => void;
}

/**
 * One mobile card (#1713). Holds its own `detailOpen` state so the full detail
 * can collapse behind a "View full details" disclosure when
 * `cardView.collapsibleDetail` is set; otherwise the detail renders inline as
 * before. The always-visible `summary` sits between the meta row and the
 * disclosure.
 */
function DataTableCard<Row>({
  row,
  cardView,
  href,
  onClick,
}: DataTableCardProps<Row>): ReactElement {
  const [detailOpen, setDetailOpen] = useState(false);
  const detail = cardView.detail;
  const collapsible = cardView.collapsibleDetail ?? false;
  const showDetail = detail !== undefined && (!collapsible || detailOpen);

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
      className={href ? 'data-table__card data-table__card--linked' : 'data-table__card'}
      onClick={onClick}
    >
      <div className="data-table__card-head">
        {cardView.select ? (
          <div className="data-table__card-select">{cardView.select(row)}</div>
        ) : null}
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
      </div>
      {cardView.summary ? (
        <div className="data-table__card-summary">{cardView.summary(row)}</div>
      ) : null}
      {detail !== undefined && collapsible ? (
        <button
          type="button"
          className="data-table__card-disclosure"
          aria-expanded={detailOpen}
          onClick={(event) => {
            // Never bubble to the card-level navigation handler.
            event.stopPropagation();
            setDetailOpen((open) => !open);
          }}
        >
          <span className="data-table__card-disclosure-chev" aria-hidden="true">
            {detailOpen ? '⌄' : '›'}
          </span>
          {detailOpen ? 'Hide details' : 'View full details'}
        </button>
      ) : null}
      {showDetail && detail ? (
        <div className="data-table__card-detail">{detail(row)}</div>
      ) : null}
    </li>
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
      // react-table only treats a column as sortable when it has an accessorFn,
      // so a `sortable` column with no `accessor` (server-sorted columns under
      // `manualSorting` — #944) still needs one. Fall back to a constant: it's
      // unused for ordering in manual mode and a no-op for client sort.
      accessorFn: accessor
        ? (row) => accessor(row) ?? ''
        : column.sortable
          ? () => ''
          : undefined,
    };
  });
}
