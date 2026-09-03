/**
 * Fulfilment worklist lanes (#2410)
 *
 * Groups the tasks on the CURRENT PAGE by the pair an operator actually works
 * to: where the goods are and how they leave. Pure — it groups what it is
 * handed and reads nothing else.
 *
 * ## A lane spans one page, never the whole worklist
 *
 * The rows are a server-paged slice, so a lane here is "the tasks for this
 * location and method **on this page**". The page says so in the lane caption;
 * this module simply must not be read as producing a complete lane, because a
 * second page can add rows to a lane already rendered.
 *
 * ## `null` gets a stable label, not a dropped row
 *
 * `locationId` and `deliveryMethod` are both independently nullable in the read
 * model (an unrouted task has neither). Skipping those rows would hide exactly
 * the tasks that need an operator most, so each `null` axis gets its own lane
 * with a fixed label — and the label is a copy string, so the vocabulary gate
 * covers it.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import type { FulfillmentTask } from '../api/fulfillment.types';
import { FULFILLMENT_WORKLIST_COPY } from './fulfillment-worklist.copy';

export interface FulfillmentLane {
  /** Stable within one render — `locationId` and `deliveryMethod` joined. */
  id: string;
  /** Raw location id, or `null` when the task carries none. */
  locationId: string | null;
  /** Raw delivery method, or `null`. */
  deliveryMethod: string | null;
  /** What to show as the lane's location. */
  locationLabel: string;
  /** What to show as the lane's delivery method. */
  deliveryMethodLabel: string;
  tasks: FulfillmentTask[];
}

/**
 * NUL — a byte no id or delivery method can contain — rather than `:`, so a
 * location literally named `a:b` cannot collide with location `a` plus method
 * `b`. A key collision would merge two genuinely different lanes into one and
 * render them under a single heading.
 */
const LANE_KEY_SEPARATOR = '\u0000';

function laneKey(locationId: string | null, deliveryMethod: string | null): string {
  return `${locationId ?? ''}${LANE_KEY_SEPARATOR}${deliveryMethod ?? ''}`;
}

/**
 * Group tasks into lanes, preserving the server's ordering.
 *
 * Lane order is FIRST APPEARANCE of the lane in the incoming rows, and within a
 * lane the rows keep their incoming order. The server already ordered this
 * page; re-sorting here would silently override an ordering decision made where
 * the data is, and would make the visible order depend on which page you are on.
 */
export function groupTasksIntoLanes(tasks: readonly FulfillmentTask[]): FulfillmentLane[] {
  const lanes = new Map<string, FulfillmentLane>();

  for (const task of tasks) {
    const key = laneKey(task.locationId, task.deliveryMethod);
    const existing = lanes.get(key);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    lanes.set(key, {
      id: key,
      locationId: task.locationId,
      deliveryMethod: task.deliveryMethod,
      locationLabel: task.locationId ?? FULFILLMENT_WORKLIST_COPY.lane.noLocation,
      deliveryMethodLabel: task.deliveryMethod ?? FULFILLMENT_WORKLIST_COPY.lane.noDeliveryMethod,
      tasks: [task],
    });
  }

  return [...lanes.values()];
}

/**
 * How many of a lane's lines are reported done, as `{ fulfilled, total }`.
 *
 * Both numbers come from the DISPLAY-ONLY counters (#2400 moves them without
 * bumping `version`), so this is a progress hint and never an input to whether
 * an action is offered.
 */
export function summariseLaneLines(lane: FulfillmentLane): { fulfilled: number; total: number } {
  let fulfilled = 0;
  let total = 0;
  for (const task of lane.tasks) {
    for (const line of task.lines) {
      fulfilled += line.fulfilledQuantity;
      total += line.totalQuantity;
    }
  }
  return { fulfilled, total };
}
