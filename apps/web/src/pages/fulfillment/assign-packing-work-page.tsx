/**
 * Assign Packing Work (#3340, ADR-074)
 *
 * A supervisor's staffing board: every fulfilment task, grouped into one
 * swimlane per packer plus a pinned "Unassigned" lane, with click-only
 * controls to move a task, hold it, or toggle whether anyone may self-serve
 * it, PLUS native drag-and-drop between lanes (#3426) as a mouse-only
 * shortcut. The "Move to" select stays the primary, keyboard-reachable path
 * — the mockup's own accessibility argument — and is never removed; drag is
 * purely additive.
 *
 * ## Dragged-task identity lives in React state, not a module-level var
 *
 * The mockup's own script uses a plain mutable variable; that is not safe
 * across React re-renders (a stale closure could read the wrong task after
 * an unrelated state update), so it is lifted to `useState` here, on the one
 * component that already owns every other piece of staffing state.
 *
 * ## Not the worklist page, and not built on top of it
 *
 * `/fulfillment` groups by (location, delivery method) — an execution axis.
 * This groups by WHO — a staffing axis, orthogonal to it (ADR-074). Both read
 * the same `GET /fulfillment/works`, unfiltered by status for the same reason
 * the worklist is: the FE may not mirror the `status` vocabulary (see
 * `fulfillment.types.ts`), so there is nothing safe to filter server-side by.
 *
 * ## The roster read can fail independently of the task read
 *
 * A failed `usePackersQuery` does not block the board — a supervisor can still
 * hold a task or leave it unassigned with no roster at all. Only the "Move to"
 * select degrades, to just the Unassigned option, with a stated reason rather
 * than a silently empty dropdown.
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
  FULFILLMENT_WORKLIST_COPY,
  FULFILLMENT_WORKLIST_PAGE_SIZE,
  FulfillmentTaskActionDialog,
  UNASSIGNED_LANE_ID,
  clearFulfillmentFilters,
  formatUnassignedAge,
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
  useFulfillmentTaskActionRunner,
  useFulfillmentTasksQuery,
  useUpdateFulfillmentAssignmentMutation,
  type FulfillmentTask,
} from '../../features/fulfillment';
import { usePackersQuery, type PackerSummary } from '../../features/users';
import { useDemoMode } from '../../features/system';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { ApiError } from '../../shared/api/api-error';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyValue } from '../../shared/ui/empty-value';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { Input } from '../../shared/ui/input';
import { MetricCard } from '../../shared/ui/metric-card';
import { PageLayout } from '../../shared/ui/page-layout';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { useToast } from '../../shared/ui/toast-provider';

/**
 * Which question the lanes answer.
 *
 * `packer` is "who packs this" — the staffing axis this screen was built on.
 * `location` is "where is it packed from", the execution axis the worklist
 * this screen absorbed was grouped by. One read, two readings of it.
 */
type BoardGroupBy = 'packer' | 'location';
const GROUP_BY_PARAM = 'groupBy';
const DEFAULT_GROUP_BY: BoardGroupBy = 'packer';

function readGroupBy(params: URLSearchParams): BoardGroupBy {
  return params.get(GROUP_BY_PARAM) === 'location' ? 'location' : DEFAULT_GROUP_BY;
}

export function AssignPackingWorkPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFulfillmentFilters(searchParams), [searchParams]);
  const offset = readFulfillmentOffset(searchParams);
  const isFiltered = hasActiveFulfillmentFilters(filters);
  const groupBy = readGroupBy(searchParams);
  const byPacker = groupBy === 'packer';

  // Paged, not a flat ceiling. This screen used to ask for a fixed 100 and
  // show whatever came back, so past that it silently displayed a slice —
  // and grouped by packer, a slice means somebody's lane looks empty when it
  // is not. The page size is the server's own default, which it clamps to
  // anyway.
  const tasksQuery = useFulfillmentTasksQuery({
    ...filters,
    limit: FULFILLMENT_WORKLIST_PAGE_SIZE,
    offset,
  });
  const packersQuery = usePackersQuery();
  const assignmentMutation = useUpdateFulfillmentAssignmentMutation();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  // The same permission the worklist page resolves its write gate from
  // (#2411): `GET /users/packers` and the assignment PATCH are both
  // `@Roles('admin', 'operator')`, exactly who holds `orders:write`.
  const write = useWriteAccess('orders:write', demoMode);

  /**
   * Which task has an ASSIGNMENT write in flight.
   *
   * Deliberately separate from `actions.busyTaskId`: assignment is not an
   * action (ADR-074 puts WHO-may-assign outside the legality matrix
   * `applyAction` enforces), so a 409 here is only ever the orthogonal
   * lost-update guard, never `action_not_legal` — it has neither the
   * runner's two-code 409 contract nor its dialog. Two writes, two busy
   * flags, one disabled state at the control.
   */
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  // Every ACTION goes through the shared runner (#3257): the 409 contract, the
  // busy task and the dialog form all live there, so this screen cannot grow
  // its own dialect of them.
  const actions = useFulfillmentTaskActionRunner();

  /** #3426 — the task currently being dragged, lifted here for the reason stated above. */
  const [draggedTask, setDraggedTask] = useState<FulfillmentTask | null>(null);

  const packers: PackerSummary[] = packersQuery.data?.packers ?? [];
  const page = tasksQuery.data;
  const tasks = page?.works ?? [];
  // The APPLIED page, not the requested one — the server clamps, and a pager
  // that reports what it asked for rather than what it got is a pager that
  // lies about which rows are on screen.
  const appliedLimit = page?.limit ?? FULFILLMENT_WORKLIST_PAGE_SIZE;
  const appliedOffset = page?.offset ?? offset;
  const total = page?.total ?? 0;
  const lanes = useMemo(
    () => (byPacker ? groupTasksByPacker(tasks, packers) : toBoardLanes(groupTasksIntoLanes(tasks))),
    [byPacker, tasks, packers]
  );
  // #3427 — computed once over every lane, not per lane: the tag is a
  // comparison ACROSS packers, which a single lane cannot make about itself.
  // Empty off the packer axis: a location lane is not a workload, and the
  // helper reads lane ids as packer ids.
  const lightestLanes = useMemo(
    () => (byPacker ? lightestLoadLaneIds(lanes) : new Set<string>()),
    [byPacker, lanes]
  );
  // #3428 — counted from the TASKS, not from the pinned lane.
  //
  // Reading the lane was correct while packer was the only axis; on the
  // location axis no lane carries that id, so it answered a confident `0`
  // over a page with four unassigned tasks on it. A metric that is wrong on
  // one axis is worse than one that is absent, and the tasks answer the same
  // question on every axis.
  const unassignedCount = tasks.filter((task) => task.assignedToUserId === null).length;
  // #3424 — same "counted from the TASKS" rule as `unassignedCount` just
  // above: the oldest wait in the pool is a fact about this page's tasks,
  // not about any one lane, and reads correctly on both grouping axes.
  const oldestUnassignedAge = formatUnassignedAge(oldestUnassignedSince(tasks));

  const setFilter = (key: 'orderId' | 'locationId', value: string): void => {
    setSearchParams(setFulfillmentFilterParam(searchParams, key, value));
  };
  const clearFilters = (): void => {
    setSearchParams(clearFulfillmentFilters(searchParams));
  };
  const setGroupBy = (next: BoardGroupBy): void => {
    const params = new URLSearchParams(searchParams);
    // The default is not written, so a plain `/fulfillment` stays clean and a
    // shared link only ever carries an axis somebody actually chose.
    if (next === DEFAULT_GROUP_BY) params.delete(GROUP_BY_PARAM);
    else params.set(GROUP_BY_PARAM, next);
    // Offset goes with it: row 26 of the packer grouping is not row 26 of the
    // location grouping — the same reason `setFulfillmentFilterParam` drops it.
    params.delete('offset');
    setSearchParams(params);
  };
  const goToOffset = (next: number): void => {
    setSearchParams(setFulfillmentOffsetParam(searchParams, next));
  };
  /**
   * Enter commits the filter, because a box that only reacts to blur reads as
   * broken to anyone who types and presses Enter.
   */
  const commitOnEnter = (
    event: KeyboardEvent<HTMLInputElement>,
    key: 'orderId' | 'locationId'
  ): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    setFilter(key, event.currentTarget.value.trim());
  };

  /**
   * Which failure sentence a staffing write gets (#3415).
   *
   * Four unrelated failures used to share one, and its "Nothing has changed"
   * half is a claim rather than a hedge - true of a refusal, false of a 409,
   * and unknowable on a 5xx or a dropped connection, which is precisely when
   * a supervisor most needs to be told to go and look.
   *
   * A 401 is deliberately absent: the session layer already redirects, so a
   * toast about it would talk over a page that is on its way out.
   */
  const staffingFailureMessage = (error: unknown, isMove: boolean): string => {
    if (error instanceof ApiError) {
      if (error.isForbidden()) return ASSIGN_PACKING_WORK_COPY.row.moveForbidden;
      if (error.isNotFound()) return ASSIGN_PACKING_WORK_COPY.row.moveNotFound;
      if (error.isConflict()) return ASSIGN_PACKING_WORK_COPY.row.moveConflict;
      if (error.isServerError() || error.isNetworkError()) {
        return ASSIGN_PACKING_WORK_COPY.row.moveUnknown;
      }
      // A 4xx we do recognise as deterministic: the server refused, so
      // nothing changed and saying so is honest.
      return isMove
        ? ASSIGN_PACKING_WORK_COPY.row.moveFailed
        : ASSIGN_PACKING_WORK_COPY.row.selfServeFailed;
    }
    return ASSIGN_PACKING_WORK_COPY.row.moveUnknown;
  };

  const setAssignment = (
    task: FulfillmentTask,
    body: { assignedToUserId?: string | null; selfServeEligible?: boolean }
  ): void => {
    setBusyTaskId(task.id);
    // #3429 — only the failure path toasted before; a successful staffing
    // change said nothing at all. The two success messages are told apart
    // by which field the CALLER set, never guessed from the task's new
    // state (a self-serve toggle on an already-unassigned task could
    // otherwise be misread as a move).
    const successMessage =
      'assignedToUserId' in body
        ? ASSIGN_PACKING_WORK_COPY.row.moveSucceeded
        : ASSIGN_PACKING_WORK_COPY.row.selfServeUpdated;
    // `task.version` is the one this control was RENDERED with, never a
    // fresher value re-read at click time — see
    // `UpdateFulfillmentWorkAssignmentRequest`'s own docblock for why: a
    // fresher token would make the 409 this guard exists to raise
    // unreachable and hand the last writer the win.
    assignmentMutation.mutate(
      { workId: task.id, expectedVersion: task.version, ...body },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: successMessage });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            description: staffingFailureMessage(error, 'assignedToUserId' in body),
          });
        },
        onSettled: () => {
          setBusyTaskId(null);
        },
      }
    );
  };

  /**
   * #3426 — fires on ANY drop, whatever lane it lands in. Dropping onto the
   * dragged task's own CURRENT lane is a no-op (matching the mockup's own
   * `drop` handler), and routes through the SAME `setAssignment` the "Move
   * to" select already uses — no new endpoint, no parallel mutation path.
   */
  const handleDropOnLane = (destinationLaneId: string): void => {
    const task = draggedTask;
    setDraggedTask(null);
    if (!task) return;

    const currentLaneId = task.assignedToUserId ?? UNASSIGNED_LANE_ID;
    if (currentLaneId === destinationLaneId) return;

    setAssignment(task, {
      assignedToUserId: destinationLaneId === UNASSIGNED_LANE_ID ? null : destinationLaneId,
    });
  };

  const renderActions = (task: FulfillmentTask): ReactElement | null => (
    <AssignPackingWorkActions
      task={task}
      packers={packers}
      visible={write.visible}
      readOnly={write.demoReadOnly}
      busy={busyTaskId === task.id || actions.busyTaskId === task.id}
      onMoveTo={(userId) => {
        setAssignment(task, { assignedToUserId: userId });
      }}
      onToggleSelfServe={(selfServeEligible) => {
        setAssignment(task, { selfServeEligible });
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

  const body = ((): ReactElement => {
    if (tasksQuery.isPending) {
      return <p className="text-muted">{ASSIGN_PACKING_WORK_COPY.loading.message}</p>;
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
        {/* Once, not per lane. Now that the board is paged, a lane holds only
            the tasks on THIS page — so a packer's lane can look empty while
            they have plenty. That is a fact about the board, and repeating it
            on every lane would state N times something true once. */}
        <p className="text-muted assign-packing-work-scope-note">
          {FULFILLMENT_WORKLIST_COPY.lane.pageScopeNote}
        </p>

      <div className="assign-packing-work-board">
        {lanes.map((lane) => (
          <AssignPackingWorkLaneSection
            key={lane.id}
            lane={lane}
            renderActions={renderActions}
            // Only on the packer axis. `handleDropOnLane` sends a lane id
            // straight into `assignedToUserId`; on any other axis that would
            // PATCH a location key as a user id. The drop handler has no way
            // to tell — a lane id is an opaque string — so the gate is here.
            dragEnabled={write.canWrite && byPacker}
            onTaskDragStart={setDraggedTask}
            onDropOnLane={handleDropOnLane}
            lightestLoad={lightestLanes.has(lane.id)}
          />
        ))}
      </div>

        <div className="pagination">
          <span className="text-muted tabular">
            {FULFILLMENT_WORKLIST_COPY.pagination.range(
              appliedOffset + 1,
              Math.min(appliedOffset + appliedLimit, total),
              total
            )}
          </span>
          <div className="pagination__actions">
            <Button
              disabled={appliedOffset <= 0}
              onClick={() => {
                goToOffset(Math.max(0, appliedOffset - appliedLimit));
              }}
            >
              {FULFILLMENT_WORKLIST_COPY.pagination.previous}
            </Button>
            <Button
              disabled={appliedOffset + appliedLimit >= total}
              onClick={() => {
                goToOffset(appliedOffset + appliedLimit);
              }}
            >
              {FULFILLMENT_WORKLIST_COPY.pagination.next}
            </Button>
          </div>
        </div>
      </>
    );
  })();

  return (
    <PageLayout
      eyebrow={ASSIGN_PACKING_WORK_COPY.page.eyebrow}
      title={ASSIGN_PACKING_WORK_COPY.page.title}
      description={ASSIGN_PACKING_WORK_COPY.page.description}
    >
      <div className="assign-packing-work-groupby">
        <SegmentedControl
          aria-label={ASSIGN_PACKING_WORK_COPY.groupBy.label}
          value={groupBy}
          options={[
            { value: 'packer', label: ASSIGN_PACKING_WORK_COPY.groupBy.packer },
            { value: 'location', label: ASSIGN_PACKING_WORK_COPY.groupBy.location },
          ]}
          onChange={setGroupBy}
        />
        {/* Said in place rather than left to be discovered: the cards simply
            stop being draggable on the other axis, and a control that quietly
            stops working reads as a bug. Only shown to someone who had drag
            in the first place. */}
        {write.canWrite && !byPacker ? (
          <span className="text-muted assign-packing-work-groupby__note">
            {ASSIGN_PACKING_WORK_COPY.groupBy.dragUnavailable}
          </span>
        ) : null}
      </div>

      <div
        className="toolbar assign-packing-work-filters"
        role="group"
        aria-label={FULFILLMENT_WORKLIST_COPY.filter.groupLabel}
      >
        {/* `key` is the URL's own value, so the box REMOUNTS whenever the
            filter changes from outside it — which is what makes `Clear
            filters` clear the text as well as the list. An uncontrolled input
            ignores a changed `defaultValue`, so without this the page shows a
            filter box reading `ol_order_7` over an unfiltered board and the
            remedy appears to do nothing. Typing stays uncontrolled; the key
            only moves when the committed value does. */}
        <Input
          key={`orderId:${filters.orderId ?? ''}`}
          aria-label={FULFILLMENT_WORKLIST_COPY.filter.orderLabel}
          placeholder={FULFILLMENT_WORKLIST_COPY.filter.orderPlaceholder}
          defaultValue={filters.orderId ?? ''}
          onBlur={(event) => {
            setFilter('orderId', event.target.value.trim());
          }}
          onKeyDown={(event) => {
            commitOnEnter(event, 'orderId');
          }}
        />
        <Input
          key={`locationId:${filters.locationId ?? ''}`}
          aria-label={FULFILLMENT_WORKLIST_COPY.filter.locationLabel}
          placeholder={FULFILLMENT_WORKLIST_COPY.filter.locationPlaceholder}
          defaultValue={filters.locationId ?? ''}
          onBlur={(event) => {
            setFilter('locationId', event.target.value.trim());
          }}
          onKeyDown={(event) => {
            commitOnEnter(event, 'locationId');
          }}
        />
        {isFiltered ? (
          <Button onClick={clearFilters}>{FULFILLMENT_WORKLIST_COPY.filter.clear}</Button>
        ) : null}
      </div>

      {packersQuery.isError ? (
        <Alert tone="warning">{ASSIGN_PACKING_WORK_COPY.rosterError.message}</Alert>
      ) : null}

      {/* #3428 shipped "Unassigned right now". #3424 adds "Oldest
          unassigned", now that `unassignedSince` exists. "Packers at their
          benches" is still not rendered — see the copy module's own
          docblock for why. Only shown once the board has real data to
          summarise. */}
      {tasksQuery.isPending || tasksQuery.isError ? null : (
        <div className="assign-packing-work-metrics">
          <MetricCard
            label={ASSIGN_PACKING_WORK_COPY.metrics.unassignedLabel}
            value={unassignedCount}
          />
          <MetricCard
            label={ASSIGN_PACKING_WORK_COPY.metrics.oldestUnassignedLabel}
            value={
              oldestUnassignedAge ?? (
                <EmptyValue label={ASSIGN_PACKING_WORK_COPY.metrics.oldestUnassignedEmptyLabel} />
              )
            }
          />
        </div>
      )}

      {body}

      {actions.pendingForm ? (
        <FulfillmentTaskActionDialog
          // Remount per (task, mode, hold) so a draft never carries across.
          // The old key was the task id alone, which was enough while `hold`
          // was the only mode this screen had.
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
