/**
 * Assign Packing Work (#3340, ADR-074; mockup parity #3096)
 *
 * A supervisor's staffing board: every fulfilment task with work left in it,
 * grouped into one swimlane per packer plus a pinned "Unassigned" lane, with
 * click-only controls to move a task, act on it, or toggle whether anyone may
 * self-serve it, PLUS native drag-and-drop between lanes (#3426) as a
 * mouse-only shortcut. The `Assign to…` / `Move to…` menu stays the primary,
 * keyboard-reachable path — the mockup's own accessibility argument — and drag
 * is purely additive. Design of record: `docs/plans/mockups/assign-packing-work.html`.
 *
 * ## Admin and operator only (#3096)
 *
 * The roster read and every write here are `@Roles('admin', 'operator')` —
 * exactly who holds `orders:write`. A viewer used to reach the board by URL
 * and meet a 403'd roster rendered as a lane of "No longer a packer". The page
 * is now gated on the permission and renders an access-denied state for
 * anyone else; nothing below the gate mounts, so no request is made only to
 * be refused.
 *
 * ## Only work that is still to be done, by default
 *
 * The read asks for `active=true` — a server-resolved alias for "every status
 * outside the domain's terminal set". Closed and cancelled parcels used to sit
 * in the Unassigned lane beside work that needed hands. The FE may not mirror
 * the status vocabulary (see `fulfillment.types.ts`), which is exactly why the
 * filter is an alias the server owns rather than a list sent from here.
 *
 * ## Dragged-task identity lives in React state, not a module-level var
 *
 * The mockup's own script uses a plain mutable variable; that is not safe
 * across React re-renders, so it is lifted to `useState` here.
 *
 * ## The roster read can fail independently of the task read
 *
 * A failed `usePackersQuery` does not block the board — a supervisor can still
 * act on a task or leave it unassigned with no roster at all. Only the menu
 * degrades, with a stated reason rather than a silently empty dropdown.
 *
 * ## This file carries no user-visible string literals
 *
 * Every one lives in `features/fulfillment/lib/assign-packing-work.copy.ts` —
 * see that file's own docblock for why the copy has to live under `features`.
 *
 * @module apps/web/src/pages/fulfillment
 */
import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ASSIGN_PACKING_WORK_COPY,
  AssignPackingWorkActions,
  AssignPackingWorkLaneSection,
  AssignPackingWorkSkeleton,
  FULFILLMENT_WORKLIST_COPY,
  FULFILLMENT_WORKLIST_PAGE_SIZE,
  FulfillmentAccessDenied,
  FulfillmentTaskActionDialog,
  UNASSIGNED_LANE_ID,
  clearFulfillmentFilters,
  countTasksByPacker,
  formatUnassignedAge,
  fulfillmentWorkDetailPath,
  groupTasksByPacker,
  groupTasksIntoLanes,
  hasActiveFulfillmentFilters,
  lightestLoadLaneIds,
  oldestUnassignedSince,
  readFulfillmentFilters,
  readFulfillmentOffset,
  setFulfillmentFilterParam,
  setFulfillmentOffsetParam,
  toBoardLanes,
  useFulfillmentAssignmentRunner,
  useFulfillmentTaskActionRunner,
  useFulfillmentTasksQuery,
  useHasMultipleLocations,
  type FulfillmentTask,
} from '../../features/fulfillment';
import { usePackersQuery, type PackerSummary } from '../../features/users';
import { useDemoMode } from '../../features/system';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { AccessGate } from '../../shared/ui/access-gate';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyValue } from '../../shared/ui/empty-value';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { Input } from '../../shared/ui/input';
import { KpiCard, KpiGrid } from '../../shared/ui/kpi-card';
import { ListPagination } from '../../shared/ui/list-pagination';
import { PageLayout } from '../../shared/ui/page-layout';
import { SegmentedControl } from '../../shared/ui/segmented-control';

/**
 * Which question the lanes answer.
 *
 * `packer` is "who packs this" — the staffing axis this screen was built on.
 * `location` is "where is it packed from", the execution axis the worklist
 * this screen absorbed was grouped by. One read, two readings of it — and the
 * second is offered only where there is more than one place to read (#3096).
 */
type BoardGroupBy = 'packer' | 'location';
const GROUP_BY_PARAM = 'groupBy';
const DEFAULT_GROUP_BY: BoardGroupBy = 'packer';

function readGroupBy(params: URLSearchParams, locationAxisOffered: boolean): BoardGroupBy {
  return locationAxisOffered && params.get(GROUP_BY_PARAM) === 'location'
    ? 'location'
    : DEFAULT_GROUP_BY;
}

export function AssignPackingWorkPage(): ReactElement {
  return (
    <AccessGate
      require="orders:write"
      fallback={
        <PageLayout
          eyebrow={ASSIGN_PACKING_WORK_COPY.page.eyebrow}
          title={ASSIGN_PACKING_WORK_COPY.page.title}
        >
          <FulfillmentAccessDenied copy={ASSIGN_PACKING_WORK_COPY.denied} />
        </PageLayout>
      }
    >
      <AssignPackingWorkBoard />
    </AccessGate>
  );
}

function AssignPackingWorkBoard(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFulfillmentFilters(searchParams), [searchParams]);
  const offset = readFulfillmentOffset(searchParams);
  const isFiltered = hasActiveFulfillmentFilters(filters);
  const hasMultipleLocations = useHasMultipleLocations();
  const groupBy = readGroupBy(searchParams, hasMultipleLocations);
  const byPacker = groupBy === 'packer';

  // Paged, not a flat ceiling: past a fixed 100 the board silently displayed a
  // slice, and grouped by packer a slice makes somebody's lane look empty. The
  // page size is the server's own default, which it clamps to anyway.
  const tasksQuery = useFulfillmentTasksQuery({
    ...filters,
    active: true,
    limit: FULFILLMENT_WORKLIST_PAGE_SIZE,
    offset,
  });
  const packersQuery = usePackersQuery();
  const demoMode = useDemoMode();
  // `GET /users/packers` and the assignment PATCH are both
  // `@Roles('admin', 'operator')`, exactly who holds `orders:write`.
  const write = useWriteAccess('orders:write', demoMode);

  // Two writes, two busy flags, one disabled state at the control: an
  // assignment is not an action (ADR-074), so it has its own runner.
  const assignment = useFulfillmentAssignmentRunner();
  const actions = useFulfillmentTaskActionRunner();

  /** #3426 — the task currently being dragged. */
  const [draggedTask, setDraggedTask] = useState<FulfillmentTask | null>(null);

  const packers: PackerSummary[] = packersQuery.data?.packers ?? [];
  const page = tasksQuery.data;
  const tasks = page?.works ?? [];
  // The APPLIED page, not the requested one — the server clamps.
  const appliedLimit = page?.limit ?? FULFILLMENT_WORKLIST_PAGE_SIZE;
  const appliedOffset = page?.offset ?? offset;
  const total = page?.total ?? 0;
  const lanes = useMemo(
    () => (byPacker ? groupTasksByPacker(tasks, packers) : toBoardLanes(groupTasksIntoLanes(tasks))),
    [byPacker, tasks, packers]
  );
  const lightestLanes = useMemo(
    () => (byPacker ? lightestLoadLaneIds(lanes) : new Set<string>()),
    [byPacker, lanes]
  );
  // "Marta Kowalczyk (2)" in the assignment menu — counted from THIS page's
  // tasks, the same scope the lanes are drawn from (#3096).
  const queueCounts = useMemo(() => countTasksByPacker(tasks, packers), [tasks, packers]);
  // #3428 — counted from the TASKS, not from the pinned lane, so the number
  // reads the same on either grouping axis.
  const unassignedCount = tasks.filter((task) => task.assignedToUserId === null).length;
  const oldestUnassignedAge = formatUnassignedAge(oldestUnassignedSince(tasks));

  const setOrderFilter = (value: string): void => {
    setSearchParams(setFulfillmentFilterParam(searchParams, 'orderId', value));
  };
  const clearFilters = (): void => {
    setSearchParams(clearFulfillmentFilters(searchParams));
  };
  const setGroupBy = (next: BoardGroupBy): void => {
    const params = new URLSearchParams(searchParams);
    // The default is not written, so a plain `/fulfillment` stays clean.
    if (next === DEFAULT_GROUP_BY) params.delete(GROUP_BY_PARAM);
    else params.set(GROUP_BY_PARAM, next);
    // Row 26 of the packer grouping is not row 26 of the location grouping.
    params.delete('offset');
    setSearchParams(params);
  };
  const goToOffset = (next: number): void => {
    setSearchParams(setFulfillmentOffsetParam(searchParams, next));
  };
  /** Enter commits the filter, because a box that only reacts to blur reads as broken. */
  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    setOrderFilter(event.currentTarget.value.trim());
  };

  /**
   * #3426 — fires on ANY drop. Dropping onto the dragged task's own CURRENT
   * lane is a no-op, and the move routes through the SAME runner the menu
   * uses — no new endpoint, no parallel mutation path.
   */
  const handleDropOnLane = (destinationLaneId: string): void => {
    const task = draggedTask;
    setDraggedTask(null);
    if (!task) return;

    const currentLaneId = task.assignedToUserId ?? UNASSIGNED_LANE_ID;
    if (currentLaneId === destinationLaneId) return;

    assignment.setAssignment(task, {
      assignedToUserId: destinationLaneId === UNASSIGNED_LANE_ID ? null : destinationLaneId,
    });
  };

  const renderActions = (task: FulfillmentTask): ReactElement | null => (
    <AssignPackingWorkActions
      task={task}
      packers={packers}
      queueCounts={queueCounts}
      visible={write.visible}
      readOnly={write.demoReadOnly}
      busy={assignment.busyTaskId === task.id || actions.busyTaskId === task.id}
      onMoveTo={(userId) => {
        assignment.setAssignment(task, { assignedToUserId: userId });
      }}
      onToggleSelfServe={(selfServeEligible) => {
        assignment.setAssignment(task, { selfServeEligible });
      }}
      onInvoke={(action) => {
        actions.run(task, action, {});
      }}
      onHold={() => {
        actions.openForm({ mode: 'hold', task });
      }}
      onReleaseHold={(hold) => {
        actions.openForm({ mode: 'release_hold', task, hold });
      }}
      onForceCancel={() => {
        actions.openForm({ mode: 'force_cancel', task });
      }}
    />
  );

  // #3259 — the task's own detail-page address, carrying this screen's own
  // state forward so the detail page's back link can restore it.
  const detailHref = (task: FulfillmentTask): string =>
    fulfillmentWorkDetailPath(task.id, searchParams);

  // #3428's three cards, in the mockup's order: Unassigned, Packers, Oldest.
  // A grid, not a wrapped flex row — see `.kpi-grid`. Only once the board has
  // real data to summarise; the skeleton draws their shape until then.
  const metrics = (
    <KpiGrid className="assign-packing-work-metrics">
      <KpiCard
        density="compact"
        label={ASSIGN_PACKING_WORK_COPY.metrics.unassignedLabel}
        value={unassignedCount}
      />
      {/* A FAILED roster read renders "Not known", never `0`: the page keeps
          working without a roster, and a zero would report an empty warehouse
          when the truth is that the question was never answered. */}
      <KpiCard
        density="compact"
        label={ASSIGN_PACKING_WORK_COPY.metrics.packersAtBenchesLabel}
        value={
          packersQuery.isError || packersQuery.isPending ? (
            <EmptyValue label={ASSIGN_PACKING_WORK_COPY.metrics.packersAtBenchesUnknownLabel} />
          ) : (
            packers.filter((packer) => packer.online).length
          )
        }
      />
      <KpiCard
        density="compact"
        label={ASSIGN_PACKING_WORK_COPY.metrics.oldestUnassignedLabel}
        value={
          oldestUnassignedAge ?? (
            <EmptyValue label={ASSIGN_PACKING_WORK_COPY.metrics.oldestUnassignedEmptyLabel} />
          )
        }
      />
    </KpiGrid>
  );

  const body = ((): ReactElement => {
    if (tasksQuery.isPending) {
      return <AssignPackingWorkSkeleton />;
    }
    if (tasksQuery.isError) {
      return (
        <ErrorState
          title={ASSIGN_PACKING_WORK_COPY.error.title}
          message={ASSIGN_PACKING_WORK_COPY.error.message}
          action={
            <Button
              onClick={() => {
                void tasksQuery.refetch();
              }}
            >
              {ASSIGN_PACKING_WORK_COPY.error.retry}
            </Button>
          }
        />
      );
    }
    if (tasks.length === 0) {
      // Three situations, three sentences. Collapsing them tells an operator
      // there is no work when in fact they typed an id that matches nothing,
      // or paged past the end of a list that has plenty.
      if (appliedOffset > 0 && total > 0) {
        return (
          <EmptyState
            liveRegion="off"
            title={FULFILLMENT_WORKLIST_COPY.empty.pastEnd.title}
            message={FULFILLMENT_WORKLIST_COPY.empty.pastEnd.message}
            action={
              <Button
                onClick={() => {
                  goToOffset(0);
                }}
              >
                {FULFILLMENT_WORKLIST_COPY.empty.pastEnd.action}
              </Button>
            }
          />
        );
      }
      if (isFiltered) {
        return (
          <EmptyState
            liveRegion="off"
            title={FULFILLMENT_WORKLIST_COPY.empty.filtered.title}
            message={FULFILLMENT_WORKLIST_COPY.empty.filtered.message}
            action={
              <Button onClick={clearFilters}>{FULFILLMENT_WORKLIST_COPY.filter.clear}</Button>
            }
          />
        );
      }
      return (
        <EmptyState
          liveRegion="off"
          title={ASSIGN_PACKING_WORK_COPY.empty.title}
          message={ASSIGN_PACKING_WORK_COPY.empty.message}
        />
      );
    }
    return (
      <>
        {/* Once, not per lane — and only when the board is really paged: a
            lane holds only the tasks on THIS page, so a packer's lane can look
            empty while they have plenty. On a single page it is true of
            nothing, and an always-on sentence is one an operator learns to
            skip (#3096). */}
        {total > appliedLimit ? (
          <p className="text-muted assign-packing-work-scope-note">
            {FULFILLMENT_WORKLIST_COPY.lane.pageScopeNote}
          </p>
        ) : null}

        <div className="assign-packing-work-board">
          {lanes.map((lane) => (
            <AssignPackingWorkLaneSection
              key={lane.id}
              lane={lane}
              renderActions={renderActions}
              // Only on the packer axis. `handleDropOnLane` sends a lane id
              // straight into `assignedToUserId`; on any other axis that would
              // PATCH a location key as a user id.
              dragEnabled={write.canWrite && byPacker}
              onTaskDragStart={setDraggedTask}
              onDropOnLane={handleDropOnLane}
              lightestLoad={lightestLanes.has(lane.id)}
              detailHref={detailHref}
              showLocation={hasMultipleLocations}
            />
          ))}
        </div>

        <ListPagination
          className="assign-packing-work-pagination"
          offset={appliedOffset}
          limit={appliedLimit}
          rowCount={tasks.length}
          total={total}
          totalState="known"
          showTotalLoader={false}
          onOffsetChange={goToOffset}
        />
      </>
    );
  })();

  return (
    <PageLayout
      eyebrow={ASSIGN_PACKING_WORK_COPY.page.eyebrow}
      title={ASSIGN_PACKING_WORK_COPY.page.title}
      description={ASSIGN_PACKING_WORK_COPY.page.description}
    >
      <div
        className="assign-packing-work-toolbar"
        role="group"
        aria-label={FULFILLMENT_WORKLIST_COPY.filter.groupLabel}
      >
        {/* The second axis only where there is a second place (#3096). */}
        {hasMultipleLocations ? (
          <SegmentedControl
            aria-label={ASSIGN_PACKING_WORK_COPY.groupBy.label}
            value={groupBy}
            options={[
              { value: 'packer', label: ASSIGN_PACKING_WORK_COPY.groupBy.packer },
              { value: 'location', label: ASSIGN_PACKING_WORK_COPY.groupBy.location },
            ]}
            onChange={setGroupBy}
          />
        ) : null}
        {/* `key` is the URL's own value, so the box REMOUNTS whenever the
            filter changes from outside it — which is what makes `Clear
            filters` clear the text as well as the list. */}
        <Input
          key={`orderId:${filters.orderId ?? ''}`}
          className="assign-packing-work-toolbar__filter"
          aria-label={FULFILLMENT_WORKLIST_COPY.filter.orderLabel}
          placeholder={FULFILLMENT_WORKLIST_COPY.filter.orderPlaceholder}
          defaultValue={filters.orderId ?? ''}
          onBlur={(event) => {
            setOrderFilter(event.target.value.trim());
          }}
          onKeyDown={commitOnEnter}
        />
        {isFiltered ? (
          <Button tone="secondary" onClick={clearFilters}>
            {FULFILLMENT_WORKLIST_COPY.filter.clear}
          </Button>
        ) : null}
        {/* Said in place: the cards stop being draggable on the other axis,
            and a control that quietly stops working reads as a bug. */}
        {write.canWrite && !byPacker ? (
          <span className="text-muted assign-packing-work-groupby__note">
            {ASSIGN_PACKING_WORK_COPY.groupBy.dragUnavailable}
          </span>
        ) : null}
      </div>

      {packersQuery.isError ? (
        <Alert tone="warning">{ASSIGN_PACKING_WORK_COPY.rosterError.message}</Alert>
      ) : null}

      {tasksQuery.isPending || tasksQuery.isError ? null : metrics}

      {body}

      {actions.pendingForm ? (
        <FulfillmentTaskActionDialog
          // Remount per (task, mode, hold) so a draft never carries across.
          key={`${actions.pendingForm.task.id}:${actions.pendingForm.mode}:${actions.pendingForm.hold?.id ?? ''}`}
          open
          mode={actions.pendingForm.mode}
          holdId={actions.pendingForm.hold?.id}
          submitting={actions.busyTaskId === actions.pendingForm.task.id}
          error={actions.pendingForm.error ?? null}
          onOpenChange={(open) => {
            if (!open) actions.closeForm();
          }}
          onSubmit={actions.submitForm}
        />
      ) : null}
    </PageLayout>
  );
}
