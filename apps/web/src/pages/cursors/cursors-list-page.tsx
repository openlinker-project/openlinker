import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { formatRelativeTime } from '../../shared/format/format-relative-time';
import { formatDateTime } from '../../shared/format/format-date';
import { useCursorsQuery } from '../../features/cursors/hooks/use-cursors-query';
import type { Cursor, CursorFilters } from '../../features/cursors/api/cursors.types';
import { interpolate, useMessages, type Messages } from '../../shared/i18n';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type CursorsListCopy = Messages['cursors']['cursorsListPage'];

function buildColumns(copy: CursorsListCopy['columns']): DataTableColumn<Cursor>[] {
  return [
    {
      id: 'cursorKey',
      header: copy.cursorKey,
      cell: (cursor) => <span className="mono-text">{cursor.cursorKey}</span>,
      accessor: (cursor) => cursor.cursorKey,
      sortable: true,
    },
    {
      id: 'value',
      header: copy.value,
      cell: (cursor) => (
        <span className="mono-text" title={cursor.value}>
          {cursor.value.length > 40 ? `${cursor.value.slice(0, 40)}...` : cursor.value}
        </span>
      ),
      hideBelow: 768,
    },
    {
      id: 'connectionId',
      header: copy.connectionId,
      cell: (cursor) => <span className="mono-text">{cursor.connectionId}</span>,
      hideBelow: 1024,
    },
    {
      id: 'updatedAt',
      header: copy.updatedAt,
      cell: (cursor) => (
        <span title={formatDateTime(cursor.updatedAt)}>
          {formatRelativeTime(cursor.updatedAt)}
        </span>
      ),
      accessor: (cursor) => cursor.updatedAt,
      sortable: true,
    },
  ];
}

export function CursorsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = useMessages('cursors').cursorsListPage;
  const columns = useMemo(() => buildColumns(copy.columns), [copy]);
  const { sort, setSort } = useTableSort([{ id: 'updatedAt', desc: true }]);

  const urlConnectionId = searchParams.get('connectionId') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [connectionIdInput, setConnectionIdInput] = useState(urlConnectionId);
  const debouncedConnectionId = useDebouncedValue(connectionIdInput, SEARCH_DEBOUNCE_MS);

  const filters: CursorFilters = {
    connectionId: debouncedConnectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useCursorsQuery(filters, pagination);

  function handleFilterChange(value: string): void {
    setConnectionIdInput(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('connectionId', value);
      } else {
        next.delete('connectionId');
      }
      next.delete('offset');
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      {/* Filters */}
      <div className="toolbar toolbar--compact">
        <Input
          aria-label={copy.filter.ariaLabel}
          placeholder={copy.filter.placeholder}
          value={connectionIdInput}
          onChange={(e) => { handleFilterChange(e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title={copy.loading.title}
          message={copy.loading.message}
        />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>{copy.error.retry}</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={
            debouncedConnectionId
              ? copy.empty.filtered
              : copy.empty.none
          }
        />
      ) : (
        <>
          <DataTable
            caption={copy.caption}
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(cursor) => `${cursor.connectionId}:${cursor.cursorKey}`}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (cursor) => cursor.cursorKey,
              subtitle: (cursor) => cursor.connectionId,
              meta: (cursor) => formatRelativeTime(cursor.updatedAt),
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {interpolate(copy.pagination.range, {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                {copy.pagination.previous}
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                {copy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
