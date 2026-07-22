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
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Key,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type UIEvent,
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
  /**
   * Slot rendered as a bottom rail on the table — a bulk action bar is the
   * canonical use. The rail is `position: fixed`, positioned imperatively and
   * clamped to the table's box: it pins to the bottom of the viewport whenever
   * any part of the table is on screen, and rests at the table's end (above
   * whatever follows, e.g. pagination) once you scroll there — never below the
   * table, never above its top. `fixed` (not `sticky`) because an ancestor's
   * `overflow` would otherwise capture the sticky context. Typically a
   * self-hiding bar (e.g. `BulkActionBar`, which goes `aria-hidden` + fades out
   * at count 0) so the rail is inert when idle.
   */
  footer?: ReactNode;
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
   * Freeze the leading N data columns to the left edge while the rest of the
   * row scrolls horizontally underneath them (desktop table layout only — the
   * mobile card view ignores it). Counts entries in `columns`; the auto
   * expander column, when `expandable` is set, is frozen alongside them as part
   * of the identity cluster. `0` (default) keeps every column scrolling.
   *
   * The freeze boundary is inert until content is actually hidden beneath it:
   * once the container is scrolled right, the last frozen column gains an
   * accent hairline + a shadow cast rightward, so the affordance appears
   * exactly when it carries meaning.
   *
   * **Works with `virtualize`.** The scroll handler that toggles the boundary
   * is wired to the virtual scroller as well as the plain container, and the
   * frozen cells use CSS `position: sticky` inside whichever scroll box is
   * active — so freezing behaves identically in virtualized and non-virtualized
   * tables. (It does not combine with the mobile card view, which ignores it.)
   */
  stickyLeftColumns?: number;
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
  footer,
  estimateRowHeight = 36,
  manualSorting = false,
  onSortChange,
  rowHref,
  rowKey,
  rows,
  sort,
  stickyLeftColumns = 0,
  virtualize = false,
}: DataTableProps<Row>): ReactElement {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // ── Horizontal sticky (frozen) leading columns ──────────────────────────
  // The expander cell (when present) leads the identity cluster, so it freezes
  // together with the first `stickyLeftColumns` data columns. Left offsets are
  // measured from the header row because column widths are content-driven.
  const leadCellCount = expandable ? 1 : 0;
  const stickyCount = Math.min(Math.max(stickyLeftColumns, 0), columns.length);
  const stickyActive = stickyCount > 0 && !renderCards;
  const frozenCellCount = stickyActive ? leadCellCount + stickyCount : 0;
  const [stickyOffsets, setStickyOffsets] = useState<number[]>([]);
  const [stickyScrolled, setStickyScrolled] = useState(false);

  useLayoutEffect(() => {
    if (!stickyActive) {
      setStickyOffsets((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const tableEl = tableRef.current;
    if (!tableEl) return;
    const measure = (): void => {
      const headRow = tableEl.querySelector('thead tr');
      if (!headRow) return;
      const cells = Array.from(headRow.children) as HTMLElement[];
      const offsets: number[] = [];
      let acc = 0;
      for (let i = 0; i < frozenCellCount && i < cells.length; i += 1) {
        offsets.push(acc);
        acc += cells[i].getBoundingClientRect().width;
      }
      setStickyOffsets((prev) =>
        prev.length === offsets.length && prev.every((v, i) => v === offsets[i]) ? prev : offsets,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tableEl);
    return () => {
      observer.disconnect();
    };
  }, [stickyActive, frozenCellCount, columns, rows]);

  const handleStickyScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      if (!stickyActive) return;
      const next = event.currentTarget.scrollLeft > 0;
      setStickyScrolled((prev) => (prev === next ? prev : next));
    },
    [stickyActive],
  );

  // `cellIndex` is the cell's position in the rendered row, counting the
  // leading expander cell (when present) as index 0.
  const stickyCellProps = useCallback(
    (cellIndex: number): { className: string; style?: CSSProperties } => {
      if (!stickyActive || cellIndex >= frozenCellCount) return { className: '' };
      const isLast = cellIndex === frozenCellCount - 1;
      return {
        className: isLast
          ? 'data-table__sticky-col data-table__sticky-col--last'
          : 'data-table__sticky-col',
        style: { left: stickyOffsets[cellIndex] ?? 0 },
      };
    },
    [stickyActive, frozenCellCount, stickyOffsets],
  );

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

  // Footer rail = a popover-style bar fixed to the viewport, clamped to the
  // table's box. `position: sticky` can't be used because an ancestor
  // (.shell-content, overflow-x: hidden) captures the sticky context and never
  // scrolls. Instead the bar is `position: fixed` and positioned imperatively:
  // anchored to the bottom of the viewport, then clamped so it never leaves the
  // table's top/bottom edges, and matched to the table's left/width. Updated on
  // scroll/resize by mutating style directly (no React re-render → smooth).
  const hasFooter = footer != null;
  useLayoutEffect(() => {
    if (!hasFooter) return;
    const wrap = wrapRef.current;
    const rail = railRef.current;
    if (!wrap || !rail) return;

    const GAP = 12; // rest distance from the viewport bottom edge
    const update = (): void => {
      const box = wrap.getBoundingClientRect();
      // No layout yet (or a non-rendering environment like jsdom, where every
      // rect is 0) — leave the rail as-is (visible, unpositioned) so it stays in
      // the accessibility tree; don't mistake "not measured" for "off-screen".
      if (box.width === 0 && box.height === 0) return;
      // Hide while the table is genuinely scrolled entirely off-screen.
      if (box.bottom <= 0 || box.top >= window.innerHeight) {
        rail.style.visibility = 'hidden';
        return;
      }
      rail.style.visibility = 'visible';
      const barHeight = rail.offsetHeight;
      const bottomAnchored = window.innerHeight - barHeight - GAP;
      // Clamp between the table's top edge and bottom edge.
      const top = Math.min(Math.max(bottomAnchored, box.top), box.bottom - barHeight);
      rail.style.top = `${Math.round(top)}px`;
      rail.style.left = `${Math.round(box.left)}px`;
      rail.style.width = `${Math.round(box.width)}px`;
    };

    update();
    // Capture phase so scrolls in any scroll container (incl. .shell-content) fire.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    observer.observe(rail);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [hasFooter, rows.length]);

  // Publish the scroll container's visible width so an expanded accordion detail
  // can pin itself to the viewport (sticky-left, that width) instead of stretching
  // to the full — often horizontally-scrolled — table width. Keeps the drawer
  // fully readable and out from under the frozen columns.
  const hasExpandable = expandable != null;
  useLayoutEffect(() => {
    if (!hasExpandable || renderCards) return;
    const container = containerRef.current;
    if (!container) return;
    const publish = (): void => {
      container.style.setProperty('--dt-visible-width', `${container.clientWidth}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [hasExpandable, renderCards, rows.length]);

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
          <td
            className={['data-table__expand-cell', stickyCellProps(0).className]
              .filter(Boolean)
              .join(' ')}
            style={stickyCellProps(0).style}
          >
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
          const sticky = stickyCellProps(leadCellCount + index);
          const cellClasses = [
            column.align ? `data-table__cell--${column.align}` : '',
            column.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : '',
            sticky.className,
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
            <td key={column.id} className={cellClasses || undefined} style={sticky.style}>
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

  const renderTable = (): ReactElement => {
    const expanderSticky = stickyCellProps(0);
    return (
    <table
      ref={tableRef}
      className={['data-table', stickyScrolled ? 'data-table--sticky-scrolled' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {expandable ? (
              <th
                scope="col"
                className={['data-table__expand-cell', expanderSticky.className]
                  .filter(Boolean)
                  .join(' ')}
                style={expanderSticky.style}
              >
                <span className="sr-only">Expand row</span>
              </th>
            ) : null}
            {headerGroup.headers.map((header, headerIndex) => {
              const column = columnById.get(header.column.id);
              const canSort = column?.sortable ?? false;
              const sortDir = header.column.getIsSorted();
              const sticky = stickyCellProps(leadCellCount + headerIndex);
              const classes = [
                column?.align ? `data-table__cell--${column.align}` : '',
                column?.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : '',
                canSort ? 'data-table__header--sortable' : '',
                sticky.className,
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <th
                  key={header.id}
                  scope="col"
                  className={classes || undefined}
                  style={sticky.style}
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
  };

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

  const scrollRegion = (
    <div
      ref={containerRef}
      className={containerClasses}
      onScroll={stickyActive ? handleStickyScroll : undefined}
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
            onScroll={stickyActive ? handleStickyScroll : undefined}
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

  // The footer rail is wrapped together with the table so the imperatively
  // positioned `position: fixed` bar is clamped to the table's box: it pins to
  // the viewport bottom whenever any part of the table is on screen, and rests
  // at the table's end once scrolled there — never below the table, never above
  // its top. `fixed` (not `sticky`) because .shell-content's overflow would
  // capture the sticky context. Whatever the page puts after DataTable
  // (pagination) sits outside the wrap, so it's never covered.
  if (footer) {
    return (
      <div className="data-table__wrap" ref={wrapRef}>
        {scrollRegion}
        <div className="data-table__footer-rail" ref={railRef}>
          {footer}
        </div>
      </div>
    );
  }

  return scrollRegion;
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
  const detailId = useId();
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
          aria-controls={detailId}
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
        <div id={detailId} className="data-table__card-detail">
          {detail(row)}
        </div>
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
