/**
 * Packer swimlanes for the Assign Packing Work board (#3340)
 *
 * Pure grouping of the same #2406 worklist read the standalone worklist page
 * consumes — fetched with NO status filter, matching that page's own
 * precedent: `FulfillmentTaskFilters` deliberately carries no `status` axis
 * (see `fulfillment.types.ts`), so this board cannot ask the server for "only
 * open work" any more than the worklist can. It renders whatever the read
 * model returns.
 *
 * The `unassigned` lane is always first and always present, even when empty —
 * it is the board's landing zone, not a lane that can disappear. A lane for a
 * packer NOT in the active roster (deactivated, or moved off the `packer`
 * role since the task was assigned) is still rendered, under that user id,
 * rather than silently folding its tasks into `unassigned` — an operator
 * needs to see and re-route that work, not lose track of it.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import type { PackerSummary } from '../../users';
import type { FulfillmentTask } from '../api/fulfillment.types';

export interface AssignPackingWorkLane {
  /** `'unassigned'` for the pinned lane, otherwise the packer's user id. */
  id: string;
  /** `null` for the unassigned lane, or a packer no longer in the roster. */
  packer: PackerSummary | null;
  tasks: FulfillmentTask[];
}

const UNASSIGNED_LANE_ID = 'unassigned';

export function groupTasksByPacker(
  tasks: readonly FulfillmentTask[],
  packers: readonly PackerSummary[]
): AssignPackingWorkLane[] {
  const rosterById = new Map(packers.map((packer) => [packer.id, packer]));
  const tasksByUserId = new Map<string, FulfillmentTask[]>();
  const unassignedTasks: FulfillmentTask[] = [];

  for (const task of tasks) {
    if (task.assignedToUserId === null) {
      unassignedTasks.push(task);
      continue;
    }
    const existing = tasksByUserId.get(task.assignedToUserId);
    if (existing) {
      existing.push(task);
    } else {
      tasksByUserId.set(task.assignedToUserId, [task]);
    }
  }

  const lanes: AssignPackingWorkLane[] = [
    { id: UNASSIGNED_LANE_ID, packer: null, tasks: unassignedTasks },
  ];

  for (const packer of packers) {
    lanes.push({ id: packer.id, packer, tasks: tasksByUserId.get(packer.id) ?? [] });
  }

  // Off-roster assignees, in encounter order, after every real packer lane.
  for (const [userId, userTasks] of tasksByUserId) {
    if (!rosterById.has(userId)) {
      lanes.push({ id: userId, packer: null, tasks: userTasks });
    }
  }

  return lanes;
}
