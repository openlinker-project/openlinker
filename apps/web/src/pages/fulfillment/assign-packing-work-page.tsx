/**
 * Assign Packing Work (#3340, ADR-074)
 *
 * A supervisor's staffing board: every fulfilment task, grouped into one
 * swimlane per packer plus a pinned "Unassigned" lane, with click-only
 * controls to move a task, hold it, or toggle whether anyone may self-serve
 * it. No drag-and-drop — the "Move to" select IS the real interaction path
 * (the mockup's own accessibility argument, carried into this build as the
 * screen's whole scope).
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
  describeFulfillmentActionError,
  fulfillmentActionLabel,
  groupTasksByPacker,
  readFulfillmentConflict,
  useFulfillmentTaskActionMutation,
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
import { PageLayout } from '../../shared/ui/page-layout';
import { useToast } from '../../shared/ui/toast-provider';

/** The board's own ceiling — the server's hard max, so nothing is silently paged off. */
const BOARD_TASK_LIMIT = 100;

export function AssignPackingWorkPage(): ReactElement {
  const tasksQuery = useFulfillmentTasksQuery({ limit: BOARD_TASK_LIMIT });
  const packersQuery = usePackersQuery();
  const assignmentMutation = useUpdateFulfillmentAssignmentMutation();
  const actionMutation = useFulfillmentTaskActionMutation();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  // The same permission the worklist page resolves its write gate from
  // (#2411): `GET /users/packers` and the assignment PATCH are both
  // `@Roles('admin', 'operator')`, exactly who holds `orders:write`.
  const write = useWriteAccess('orders:write', demoMode);

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [holdTask, setHoldTask] = useState<FulfillmentTask | null>(null);
  const [holdError, setHoldError] = useState<unknown>(null);

  const packers: PackerSummary[] = packersQuery.data?.packers ?? [];
  const tasks = tasksQuery.data?.works ?? [];
  const lanes = useMemo(() => groupTasksByPacker(tasks, packers), [tasks, packers]);

  const setAssignment = (
    task: FulfillmentTask,
    body: { assignedToUserId?: string | null; selfServeEligible?: boolean }
  ): void => {
    setBusyTaskId(task.id);
    assignmentMutation.mutate(
      { workId: task.id, ...body },
      {
        onError: () => {
          showToast({ tone: 'error', description: ASSIGN_PACKING_WORK_COPY.row.moveFailed });
        },
        onSettled: () => {
          setBusyTaskId(null);
        },
      }
    );
  };

  const openHold = (task: FulfillmentTask): void => {
    setHoldError(null);
    setHoldTask(task);
  };

  const submitHold = (holdReason: string, note?: string): void => {
    if (!holdTask) return;
    const task = holdTask;
    setBusyTaskId(task.id);
    actionMutation.mutate(
      {
        workId: task.id,
        action: 'hold',
        orderId: task.orderId,
        expectedVersion: task.version,
        holdReason,
        note,
      },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: `${fulfillmentActionLabel('hold')} applied.` });
          setHoldTask(null);
        },
        onError: (error) => {
          const conflict = readFulfillmentConflict(error);
          if (conflict) {
            // A stale token or an illegal action — the server's own truth wins;
            // closing the form and letting the row re-render is the same rule
            // the worklist page follows.
            setHoldTask(null);
            showToast({
              tone: conflict.retryable ? 'warning' : 'error',
              description: describeFulfillmentActionError(
                error,
                `Could not ${fulfillmentActionLabel('hold').toLowerCase()} this fulfilment task.`
              ),
            });
            return;
          }
          setHoldError(error);
        },
        onSettled: () => {
          setBusyTaskId(null);
        },
      }
    );
  };

  const renderActions = (task: FulfillmentTask): ReactElement | null => (
    <AssignPackingWorkActions
      task={task}
      packers={packers}
      visible={write.visible}
      readOnly={write.demoReadOnly}
      busy={busyTaskId === task.id}
      onMoveTo={(userId) => {
        setAssignment(task, { assignedToUserId: userId });
      }}
      onToggleSelfServe={(selfServeEligible) => {
        setAssignment(task, { selfServeEligible });
      }}
      onHold={() => {
        openHold(task);
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
          <AssignPackingWorkLaneSection key={lane.id} lane={lane} renderActions={renderActions} />
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

      {body}

      {holdTask ? (
        <FulfillmentTaskActionDialog
          key={holdTask.id}
          open
          mode="hold"
          submitting={busyTaskId === holdTask.id}
          error={holdError}
          onOpenChange={(open) => {
            if (!open) setHoldTask(null);
          }}
          onSubmit={(actionBody) => {
            setHoldError(null);
            submitHold(actionBody.holdReason ?? '', actionBody.note);
          }}
        />
      ) : null}
    </PageLayout>
  );
}
