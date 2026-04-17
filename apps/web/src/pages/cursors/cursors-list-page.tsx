import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { formatRelativeTime } from '../../shared/format/format-relative-time';
import { formatDateTime } from '../../shared/format/format-date';
import { useCursorsQuery } from '../../features/cursors/hooks/use-cursors-query';
import type { Cursor, CursorFilters } from '../../features/cursors/api/cursors.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS: DataTableColumn<Cursor>[] = [
  {
    id: 'cursorKey',
    header: 'Cursor Key',
    cell: (cursor) => <span className="mono-text">{cursor.cursorKey}</span>,
  },
  {
    id: 'value',
    header: 'Value',
    cell: (cursor) => (
      <span className="mono-text" title={cursor.value}>
        {cursor.value.length > 40 ? `${cursor.value.slice(0, 40)}...` : cursor.value}
      </span>
    ),
  },
  {
    id: 'connectionId',
    header: 'Connection ID',
    cell: (cursor) => <span className="mono-text">{cursor.connectionId}</span>,
  },
  {
    id: 'updatedAt',
    header: 'Last Updated',
    cell: (cursor) => (
      <span title={formatDateTime(cursor.updatedAt)}>
        {formatRelativeTime(cursor.updatedAt)}
      </span>
    ),
  },
];

export function CursorsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

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
      eyebrow="Operations"
      title="Cursors"
      description="Sync cursor state per connection — track incremental sync positions."
    >
      {/* Filters */}
      <div className="toolbar toolbar--compact">
        <input
          aria-label="Filter by connection ID"
          placeholder="Connection ID..."
          value={connectionIdInput}
          onChange={(e) => { handleFilterChange(e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading cursors"
          message="Fetching cursor data..."
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load cursors"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No cursors found"
          message={
            debouncedConnectionId
              ? 'No cursors match the current filter.'
              : 'No sync cursors have been created yet. Cursors appear after the first sync job runs.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Connection cursors"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(cursor) => `${cursor.connectionId}:${cursor.cursorKey}`}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                Previous
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
