/**
 * Returns List Page (#2335)
 *
 * The operator's view of the return aggregate, with the orphan bucket
 * first-class.
 *
 * Three rules shape this page, and each exists because its opposite tells the
 * operator something false about their own data.
 *
 * **The two totals are not interchangeable.** `total` is bucket-APPLIED and is
 * the only number pagination may read — it counts the rows this page is drawn
 * from. `counts` is bucket-LESS and is the only number the chips may read — a
 * chip fed from `total` would show either the number already on screen or a
 * zero, so the bucket you are *not* looking at would appear empty whenever a
 * filter is active.
 *
 * **Four empty branches, evaluated in order.** Past-the-end, filtered, not
 * configured, and genuinely empty are four different operator situations.
 * `offset` is paging and not a filter, so without the first branch `?offset=999`
 * on a deployment with 47 returns lands in the last branch and reports that
 * there are none.
 *
 * **The unfiltered-empty branches wait for ingestion availability to settle.**
 * If the list resolves first, "No returns recorded yet." paints and a second
 * later swaps to "not set up" — two contradictory claims about the deployment
 * in one second. A failed availability read is settled and degrades to the
 * neutral branch, never to the configuration claim it could not verify.
 *
 * @module apps/web/src/pages/returns
 */
import { useMemo, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Select } from '../../shared/ui/select';
import { ConnectionEntityLabel, useConnectionsQuery } from '../../features/connections';
import {
  RETURNS_EMPTY_COPY,
  RETURNS_ERROR_COPY,
  RETURNS_FILTER_COPY,
  RETURNS_PAGE_COPY,
  RETURNS_PAGINATION_COPY,
  RETURNS_ROW_COPY,
  RETURNS_PAGE_SIZE,
  ReturnIdentityCell,
  ReturnOpenedCell,
  ReturnOrderCell,
  ReturnSourceStatus,
  ReturnStatusCell,
  clearReturnFilters,
  describeRange,
  describeUnreadableRows,
  hasActiveReturnFilters,
  readReturnFilters,
  readReturnOffset,
  returnIdentitySummary,
  returnOrderSummary,
  setReturnFilterParam,
  setReturnOffsetParam,
  useReturnIngestionAvailabilityQuery,
  useReturnsQuery,
  type ReturnBucket,
  type ReturnListItem,
} from '../../features/returns';

/** `bucket` absent means "both sides", which is what the All chip selects. */
type BucketChoice = ReturnBucket | 'all';

export function ReturnsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => readReturnFilters(searchParams), [searchParams]);
  const offset = readReturnOffset(searchParams);
  const isFiltered = hasActiveReturnFilters(filters);

  const query = useReturnsQuery(filters, { limit: RETURNS_PAGE_SIZE, offset });
  const availabilityQuery = useReturnIngestionAvailabilityQuery();
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];

  // One connections read serves both the filter dropdown and every row's source
  // label, so the table issues no per-row connection fetch (#1996). A row whose
  // connection is not in the list resolves to `null`, which renders as the bare
  // id rather than as a spinner that never stops.
  const connectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connections) map.set(connection.id, connection.name);
    return map;
  }, [connections]);

  const columns = useMemo<DataTableColumn<ReturnListItem>[]>(
    () => [
      {
        id: 'return',
        header: RETURNS_ROW_COPY.returnLabel,
        cell: (item) => <ReturnIdentityCell item={item} />,
      },
      {
        id: 'order',
        header: RETURNS_ROW_COPY.orderLabel,
        cell: (item) => <ReturnOrderCell item={item} />,
      },
      {
        id: 'source',
        header: RETURNS_ROW_COPY.sourceLabel,
        cell: (item) => (
          <ConnectionEntityLabel
            connectionId={item.sourceConnectionId}
            name={connectionNameById.get(item.sourceConnectionId) ?? null}
            linkToDetail={false}
            showCopy={false}
          />
        ),
        hideBelow: 1024,
      },
      {
        id: 'opened',
        header: RETURNS_ROW_COPY.openedLabel,
        cell: (item) => <ReturnOpenedCell item={item} />,
        hideBelow: 768,
      },
      {
        id: 'sourceStatus',
        header: RETURNS_ROW_COPY.sourceStatusLabel,
        cell: (item) => <ReturnSourceStatus rawStatus={item.rawStatus} />,
        hideBelow: 768,
      },
      {
        id: 'status',
        header: RETURNS_ROW_COPY.statusLabel,
        cell: (item) => <ReturnStatusCell item={item} />,
      },
    ],
    [connectionNameById],
  );

  const bucketChoice: BucketChoice = filters.bucket ?? 'all';
  const counts = query.data?.counts;
  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const droppedCount = query.data?.droppedCount ?? 0;

  function selectBucket(choice: BucketChoice): void {
    setSearchParams((prev) =>
      setReturnFilterParam(new URLSearchParams(prev), 'bucket', choice === 'all' ? '' : choice),
    );
  }

  function selectSource(value: string): void {
    setSearchParams((prev) =>
      setReturnFilterParam(new URLSearchParams(prev), 'sourceConnectionId', value),
    );
  }

  function goToOffset(next: number): void {
    setSearchParams((prev) => setReturnOffsetParam(new URLSearchParams(prev), next));
  }

  function clearFilters(): void {
    setSearchParams((prev) => clearReturnFilters(new URLSearchParams(prev)));
  }

  // Availability is only consulted on the unfiltered-empty branches, but it must
  // have SETTLED before either of them renders — see the module docblock.
  const availabilitySettled = !availabilityQuery.isLoading;
  const returnsConfigured = availabilityQuery.data?.configured ?? true;

  const isEmpty = !query.isLoading && query.error === null && items.length === 0;
  // A page where EVERY row failed to parse is not an empty page. Falling
  // through to the branches below would blank the table and tell the operator
  // they have no returns — the exact false claim the per-row parse exists to
  // avoid, arriving by a different route. Reported before anything else can
  // interpret the emptiness.
  const isUnreadable = isEmpty && droppedCount > 0;
  // `offset > 0 && total > 0` is the past-the-end shape: rows exist, this page
  // is simply beyond them. `total === 0` with an offset is an empty set that
  // happens to carry a stale param, and belongs in the branches below.
  const isPastEnd = isEmpty && !isUnreadable && offset > 0 && total > 0;
  const awaitingAvailability =
    isEmpty && !isUnreadable && !isPastEnd && !isFiltered && !availabilitySettled;

  return (
    <PageLayout
      eyebrow={RETURNS_PAGE_COPY.eyebrow}
      title={RETURNS_PAGE_COPY.title}
      description={RETURNS_PAGE_COPY.description}
    >
      <div className="toolbar">
        <div className="toolbar__group" role="group" aria-label={RETURNS_FILTER_COPY.bucketGroupLabel}>
          <Chip active={bucketChoice === 'all'} onClick={() => { selectBucket('all'); }}>
            {RETURNS_FILTER_COPY.all}
            {counts ? ` (${counts.total})` : ''}
          </Chip>
          <Chip
            tone="error"
            active={bucketChoice === 'orphan'}
            onClick={() => { selectBucket('orphan'); }}
          >
            {RETURNS_FILTER_COPY.orphan}
            {counts ? ` (${counts.orphan})` : ''}
          </Chip>
          <Chip
            active={bucketChoice === 'attributed'}
            onClick={() => { selectBucket('attributed'); }}
          >
            {RETURNS_FILTER_COPY.attributed}
            {counts ? ` (${counts.attributed})` : ''}
          </Chip>
        </div>

        <Select
          aria-label={RETURNS_FILTER_COPY.sourceLabel}
          value={filters.sourceConnectionId ?? ''}
          onChange={(event) => { selectSource(event.target.value); }}
        >
          <option value="">{RETURNS_FILTER_COPY.allSources}</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </Select>

        {isFiltered ? (
          <Button onClick={clearFilters}>{RETURNS_FILTER_COPY.clear}</Button>
        ) : null}
      </div>

      {query.isLoading || awaitingAvailability ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title={RETURNS_ERROR_COPY.title}
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>{RETURNS_ERROR_COPY.retry}</Button>
          }
        />
      ) : isUnreadable ? (
        <ErrorState
          title={RETURNS_ERROR_COPY.unreadableTitle}
          message={describeUnreadableRows(droppedCount)}
          action={
            <Button onClick={() => { void query.refetch(); }}>{RETURNS_ERROR_COPY.retry}</Button>
          }
        />
      ) : isPastEnd ? (
        <EmptyState
          liveRegion="off"
          title={RETURNS_EMPTY_COPY.pastEnd.title}
          message={RETURNS_EMPTY_COPY.pastEnd.message}
          action={
            <Button onClick={() => { goToOffset(0); }}>{RETURNS_EMPTY_COPY.pastEnd.action}</Button>
          }
        />
      ) : isEmpty && isFiltered ? (
        <EmptyState
          liveRegion="off"
          title={RETURNS_EMPTY_COPY.noMatches.title}
          message={RETURNS_EMPTY_COPY.noMatches.message}
          action={<Button onClick={clearFilters}>{RETURNS_FILTER_COPY.clear}</Button>}
        />
      ) : isEmpty && !returnsConfigured ? (
        <EmptyState
          liveRegion="off"
          title={RETURNS_EMPTY_COPY.notConfigured.title}
          message={RETURNS_EMPTY_COPY.notConfigured.message}
        />
      ) : isEmpty ? (
        <EmptyState
          liveRegion="off"
          title={RETURNS_EMPTY_COPY.none.title}
          message={RETURNS_EMPTY_COPY.none.message}
        />
      ) : (
        <>
          <DataTable
            caption={RETURNS_PAGE_COPY.tableCaption}
            columns={columns}
            rows={items}
            rowKey={(item) => item.id}
            // No `rowHref` yet, deliberately. It would resolve to
            // `/returns/:returnId`, which #2336 registers — and this branch is
            // mergeable on its own, so until that lands every row would be a
            // click that goes to a blank page (the router has no catch-all to
            // explain it). A row that looks clickable and is not is worse than
            // a row that does not look clickable. #2336 adds the prop with the
            // route, in one change.
            cardView={{
              // The card reuses the SAME renderers as the columns above, so the
              // two layouts cannot drift (#2091).
              title: (item) => returnIdentitySummary(item),
              subtitle: (item) => returnOrderSummary(item),
              meta: (item) => <ReturnStatusCell item={item} />,
              detail: (item) => (
                <dl className="card-detail">
                  <dt>{RETURNS_ROW_COPY.sourceLabel}</dt>
                  <dd>
                    <ConnectionEntityLabel
                      connectionId={item.sourceConnectionId}
                      name={connectionNameById.get(item.sourceConnectionId) ?? null}
                      linkToDetail={false}
                      showCopy={false}
                    />
                  </dd>
                  <dt>{RETURNS_ROW_COPY.openedLabel}</dt>
                  <dd>
                    <ReturnOpenedCell item={item} />
                  </dd>
                  <dt>{RETURNS_ROW_COPY.sourceStatusLabel}</dt>
                  <dd>
                    <ReturnSourceStatus rawStatus={item.rawStatus} />
                  </dd>
                </dl>
              ),
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {describeRange(offset + 1, Math.min(offset + RETURNS_PAGE_SIZE, total), total)}
              {/* Adjacent to the range on purpose: the range counts what the
                  server says exists and the rows count what could be shown, so
                  the gap between them has to be readable in one glance. */}
              {droppedCount > 0 ? ` · ${describeUnreadableRows(droppedCount)}` : ''}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={offset <= 0}
                onClick={() => { goToOffset(Math.max(0, offset - RETURNS_PAGE_SIZE)); }}
              >
                {RETURNS_PAGINATION_COPY.previous}
              </Button>
              <Button
                disabled={offset + RETURNS_PAGE_SIZE >= total}
                onClick={() => { goToOffset(offset + RETURNS_PAGE_SIZE); }}
              >
                {RETURNS_PAGINATION_COPY.next}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
