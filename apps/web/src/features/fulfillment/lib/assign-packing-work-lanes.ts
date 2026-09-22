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

/** The pinned lane's id — also `AssignPackingWorkLane['id']`'s special value. */
export const UNASSIGNED_LANE_ID = 'unassigned';

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

/**
 * Load bar fill (#3427) — each task is 20% of the bar's width, capped at
 * 100%, and the mockup's own `updateLaneCount` formula (`n * 20`, `min(100,
 * …)`). Not derived from a configured capacity anywhere in this system —
 * there is none — so this is a purely relative visual, not a claim about
 * how many tasks a packer *should* carry.
 */
export function laneLoadPercent(taskCount: number): number {
  return Math.min(100, taskCount * 20);
}

export type LaneLoadTone = 'normal' | 'busy' | 'over';

/** Same thresholds as the fill width — `n >= 5` over, `n >= 3` busy. */
export function laneLoadTone(taskCount: number): LaneLoadTone {
  if (taskCount >= 5) return 'over';
  if (taskCount >= 3) return 'busy';
  return 'normal';
}

/**
 * Which packer lanes should carry the "lightest load" tag (#3427).
 *
 * Pure client computation over `lane.tasks.length`, per the issue's own
 * instruction — the mockup's tag is static demo markup, never recomputed by
 * its own script. Two rules keep the tag meaningful rather than decorative:
 *
 * - The `unassigned` lane is never a candidate — it isn't a packer, so
 *   "lightest load" would be comparing a person against a queue.
 * - The tag is suppressed entirely when every packer lane carries the SAME
 *   count (including the trivial case of zero or one packer lane) — there
 *   is no meaningful "lightest" when nothing is lighter than anything else,
 *   and tagging every lane at once would read as a broken feature rather
 *   than a fact.
 * - A TIE at the minimum tags every tied lane, never an arbitrarily "first"
 *   one — picking one winner among equals would assert a distinction the
 *   data does not support.
 */
export function lightestLoadLaneIds(lanes: readonly AssignPackingWorkLane[]): ReadonlySet<string> {
  const packerLanes = lanes.filter((lane) => lane.id !== UNASSIGNED_LANE_ID);
  if (packerLanes.length < 2) return new Set();

  const counts = packerLanes.map((lane) => lane.tasks.length);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  if (min === max) return new Set();

  return new Set(
    packerLanes.filter((lane) => lane.tasks.length === min).map((lane) => lane.id)
  );
}

/**
 * "Pulled out of self-serve" (#3429, mockup's own `.lane-card--assignment-only`)
 *
 * True only for a task that is BOTH still in the Unassigned pool AND marked
 * `selfServeEligible: false` — the mockup's own `makeCard`/`wirePickable`
 * pairing: the muted treatment and the checkbox that drives it exist only
 * on Unassigned-lane cards, so a task a supervisor has already NAMED a
 * packer for never renders muted here, whatever `selfServeEligible` says —
 * that field still means something once assigned (whether a packer other
 * than the named one could later pick it up), but the mockup surfaces it
 * nowhere on an assigned card, so this stays silent there too.
 */
export function isAssignmentOnlyCard(task: FulfillmentTask): boolean {
  return task.assignedToUserId === null && !task.selfServeEligible;
}
