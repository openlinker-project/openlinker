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
import { useMemo, useState, type ReactElement } from 'react';

import {
  ASSIGN_PACKING_WORK_COPY,
  AssignPackingWorkActions,
  AssignPackingWorkLaneSection,
  FulfillmentTaskActionDialog,
  UNASSIGNED_LANE_ID,
  groupTasksByPacker,
  lightestLoadLaneIds,
  useFulfillmentTaskActionRunner,
  useFulfillmentTasksQuery,
  useUpdateFulfillmentAssignmentMutation,
  type FulfillmentTask,
} from '../../features/fulfillment';
import { usePackersQuery, type PackerSummary } from '../../features/users';
import { useDemoMode } from '../../features/system';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { MetricCard } from '../../shared/ui/metric-card';
import { PageLayout } from '../../shared/ui/page-layout';
import { useToast } from '../../shared/ui/toast-provider';

/** The board's own ceiling — the server's hard max, so nothing is silently paged off. */
const BOARD_TASK_LIMIT = 100;

export function AssignPackingWorkPage(): ReactElement {
  const tasksQuery = useFulfillmentTasksQuery({ limit: BOARD_TASK_LIMIT });
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
   * action and carries no `expectedVersion` (ADR-074 puts it outside the
   * legality matrix), so it has neither the runner's 409 contract nor its
   * dialog. Two writes, two busy flags, one disabled state at the control.
   */
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  // Every ACTION goes through the shared runner (#3257): the 409 contract, the
  // busy task and the dialog form all live there, so this screen cannot grow
  // its own dialect of them.
  const actions = useFulfillmentTaskActionRunner();

  /** #3426 — the task currently being dragged, lifted here for the reason stated above. */
  const [draggedTask, setDraggedTask] = useState<FulfillmentTask | null>(null);

  const packers: PackerSummary[] = packersQuery.data?.packers ?? [];
  const tasks = tasksQuery.data?.works ?? [];
  const lanes = useMemo(() => groupTasksByPacker(tasks, packers), [tasks, packers]);
  // #3427 — computed once over every lane, not per lane: the tag is a
  // comparison ACROSS packers, which a single lane cannot make about itself.
  const lightestLanes = useMemo(() => lightestLoadLaneIds(lanes), [lanes]);
  // #3428 — the pinned lane IS the unassigned count; no separate read needed.
  const unassignedCount = lanes.find((lane) => lane.id === UNASSIGNED_LANE_ID)?.tasks.length ?? 0;

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
    assignmentMutation.mutate(
      { workId: task.id, ...body },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: successMessage });
        },
        onError: () => {
          showToast({ tone: 'error', description: ASSIGN_PACKING_WORK_COPY.row.moveFailed });
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
      return (
        <EmptyState
          title={ASSIGN_PACKING_WORK_COPY.empty.title}
          message={ASSIGN_PACKING_WORK_COPY.empty.message}
        />
      );
    }
    return (
      <div className="assign-packing-work-board">
        {lanes.map((lane) => (
          <AssignPackingWorkLaneSection
            key={lane.id}
            lane={lane}
            renderActions={renderActions}
            dragEnabled={write.canWrite}
            onTaskDragStart={setDraggedTask}
            onDropOnLane={handleDropOnLane}
            lightestLoad={lightestLanes.has(lane.id)}
          />
        ))}
      </div>
    );
  })();

  return (
    <PageLayout
      eyebrow={ASSIGN_PACKING_WORK_COPY.page.eyebrow}
      title={ASSIGN_PACKING_WORK_COPY.page.title}
      description={ASSIGN_PACKING_WORK_COPY.page.description}
    >
      {packersQuery.isError ? (
        <Alert tone="warning">{ASSIGN_PACKING_WORK_COPY.rosterError.message}</Alert>
      ) : null}

      {/* #3428 — one card shipped ("Unassigned right now"), a pure count over
          lanes already read for the board. "Oldest unassigned" and "Packers
          at their benches" are not rendered — see the copy module's own
          docblock for why. Only shown once the board has real data to
          summarise. */}
      {tasksQuery.isPending || tasksQuery.isError ? null : (
        <div className="assign-packing-work-metrics">
          <MetricCard
            label={ASSIGN_PACKING_WORK_COPY.metrics.unassignedLabel}
            value={unassignedCount}
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
