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
import { KeyValueList } from '../../shared/ui/key-value-list';
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
  ReturnSegmentStrip,
  ReturnStageCell,
  type ReturnSegment,
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
        // #2377 — replaces the Wave-1c `status` column. Not a sibling of it: the
        // two are renderings of the SAME lifecycle fact (`declined` is stage #1),
        // and two competing lifecycle signals in one row is exactly what the
        // #2100 three-independent-parts rule is NOT about — that rule is for
        // different facts (money, attention, action).
        id: 'stage',
        header: RETURNS_ROW_COPY.stageLabel,
        cell: (item) => <ReturnStageCell item={item} />,
      },
    ],
    [connectionNameById],
  );

  const bucketChoice: BucketChoice = filters.bucket ?? 'all';
  const counts = query.data?.counts;
  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const droppedCount = query.data?.droppedCount ?? 0;
  // Distinct from `droppedCount`, and it has to be: an unreadable envelope
  // yields no rows AND no drops, so every emptiness test below would read it as
  // the server confirming there are none.
  const envelopeUnreadable = query.data?.envelopeUnreadable ?? false;
  // The limit the server APPLIED, not the one this page asked for. They agree
  // today (20 is under the 100 cap), so reading the request would be true by
  // coincidence; reading the response makes the reported range and the paging
  // step structurally true. A zero — the api client's own fallback when neither
  // the response nor the request carried one — would freeze paging, so the page
  // size stands in for it.
  const appliedLimit =
    query.data !== undefined && query.data.limit > 0 ? query.data.limit : RETURNS_PAGE_SIZE;

  function selectBucket(choice: BucketChoice): void {
    setSearchParams((prev) =>
      setReturnFilterParam(new URLSearchParams(prev), 'bucket', choice === 'all' ? '' : choice),
    );
  }

  /**
   * Select a segment, or clear it (`null` — the `All returns` card).
   *
   * Writes ONLY `segment`. It must never touch `bucket`: the bucket chips are a
   * separate, independently-usable surface, and two surfaces fighting over one
   * param is how they start disagreeing about what is filtered.
   */
  function selectSegment(segment: ReturnSegment | null): void {
    setSearchParams((prev) =>
      setReturnFilterParam(new URLSearchParams(prev), 'segment', segment ?? ''),
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
  // The whole response was unreadable. Ahead of every empty branch, including
  // the per-row one: without it the page falls through to "No returns recorded
  // yet." on a deployment that may hold thousands, and the null `counts` blanks
  // the chips too, so no other signal survives.
  const isEnvelopeUnreadable = isEmpty && envelopeUnreadable;
  // A page where EVERY row failed to parse is not an empty page. Falling
  // through to the branches below would blank the table and tell the operator
  // they have no returns — the exact false claim the per-row parse exists to
  // avoid, arriving by a different route. Reported before anything else can
  // interpret the emptiness.
  const isUnreadable = isEmpty && !isEnvelopeUnreadable && droppedCount > 0;
  // `offset > 0 && total > 0` is the past-the-end shape: rows exist, this page
  // is simply beyond them. `total === 0` with an offset is an empty set that
  // happens to carry a stale param, and belongs in the branches below.
  const isPastEnd = isEmpty && !isEnvelopeUnreadable && !isUnreadable && offset > 0 && total > 0;
  const awaitingAvailability =
    isEmpty &&
    !isEnvelopeUnreadable &&
    !isUnreadable &&
    !isPastEnd &&
    !isFiltered &&
    !availabilitySettled;

  return (
    <PageLayout
      eyebrow={RETURNS_PAGE_COPY.eyebrow}
      title={RETURNS_PAGE_COPY.title}
      description={RETURNS_PAGE_COPY.description}
    >
      <ReturnSegmentStrip
        counts={query.data?.segmentCounts ?? null}
        selected={filters.segment ?? null}
        onSelect={selectSegment}
      />

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
      ) : isEnvelopeUnreadable ? (
        <ErrorState
          title={RETURNS_ERROR_COPY.unreadableTitle}
          message={RETURNS_ERROR_COPY.unreadableEnvelopeMessage}
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
            // Relative, resolving against the parent `returns` path now that
            // the list is its index child — the `customers` / `invoices` shape.
            // #2336 added this together with the `/returns/:returnId` route, in
            // one change, because a row that looks clickable and lands on a
            // blank page is worse than one that does not look clickable.
            rowHref={(item) => item.id}
            cardView={{
              // The card reuses the SAME renderers as the columns above, so the
              // two layouts cannot drift (#2091).
              title: (item) => returnIdentitySummary(item),
              subtitle: (item) => returnOrderSummary(item),
              meta: (item) => <ReturnStageCell item={item} />,
              // `KeyValueList`, not a hand-rolled `<dl>`: the peer lists
              // (`listings`, `orders`) render their card detail through the same
              // primitive, and a bare `<dl>` under a class no stylesheet defines
              // renders its terms and values unseparated.
              detail: (item) => (
                <KeyValueList
                  items={[
                    {
                      id: 'source',
                      label: RETURNS_ROW_COPY.sourceLabel,
                      value: (
                        <ConnectionEntityLabel
                          connectionId={item.sourceConnectionId}
                          name={connectionNameById.get(item.sourceConnectionId) ?? null}
                          linkToDetail={false}
                          showCopy={false}
                        />
                      ),
                    },
                    {
                      id: 'opened',
                      label: RETURNS_ROW_COPY.openedLabel,
                      value: <ReturnOpenedCell item={item} />,
                    },
                    {
                      id: 'sourceStatus',
                      label: RETURNS_ROW_COPY.sourceStatusLabel,
                      value: <ReturnSourceStatus rawStatus={item.rawStatus} />,
                    },
                  ]}
                />
              ),
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {describeRange(offset + 1, Math.min(offset + appliedLimit, total), total)}
              {/* Adjacent to the range on purpose: the range counts what the
                  server says exists and the rows count what could be shown, so
                  the gap between them has to be readable in one glance. */}
              {droppedCount > 0 ? ` · ${describeUnreadableRows(droppedCount)}` : ''}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={offset <= 0}
                onClick={() => { goToOffset(Math.max(0, offset - appliedLimit)); }}
              >
                {RETURNS_PAGINATION_COPY.previous}
              </Button>
              <Button
                disabled={offset + appliedLimit >= total}
                onClick={() => { goToOffset(offset + appliedLimit); }}
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
