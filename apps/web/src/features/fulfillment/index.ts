/**
 * Fulfilment — public surface (#2411, widened by #2410, narrowed by the merge)
 *
 * Two consumers outside this folder: the order-detail panel's host, and the
 * one fulfilment screen at `/fulfillment`. The screen lives under `pages/`,
 * so everything it composes leaves the folder.
 *
 * The screen merge REMOVED exports rather than adding them.
 * `FulfillmentLaneSection` and `FulfillmentWorklistRow` went with the worklist
 * page that was their only consumer; `groupTasksIntoLanes` survives because
 * the merged screen still offers that grouping as its second axis, now behind
 * `?groupBy=` rather than behind a second URL.
 *
 * Deliberately NOT exported, per the start-narrow rule: the api module and the
 * query keys (the screen reaches transport through the hooks, and the action
 * mutation already invalidates the whole feature), and the task card and the
 * status/handshake labels, which have no consumer outside this folder. Adding
 * any of them back is one line on the day something needs it.
 *
 * @module apps/web/src/features/fulfillment
 */
export { OrderFulfillmentTasksPanel } from './components/order-fulfillment-tasks-panel';
export type { OrderFulfillmentTasksPanelProps } from './components/order-fulfillment-tasks-panel';

// The action set and its dialog — shared by the fulfilment screen and the
// order-detail panel.
export { FulfillmentTaskActions } from './components/fulfillment-task-actions';
export type { FulfillmentTaskActionsProps } from './components/fulfillment-task-actions';
export {
  FulfillmentTaskActionDialog,
  type FulfillmentTaskActionMode,
} from './components/fulfillment-task-action-dialog';

export {
  useFulfillmentTasksQuery,
  FULFILLMENT_WORKLIST_PAGE_SIZE,
} from './hooks/use-fulfillment-tasks-query';
export { useFulfillmentTaskActionMutation } from './hooks/use-fulfillment-task-action-mutation';
// #3257 — the one place a fulfilment action becomes a request. Every surface
// that offers an action uses this; nothing re-implements the 409 contract.
export { useFulfillmentTaskActionRunner } from './hooks/use-fulfillment-task-action-runner';
export type {
  FulfillmentPendingForm,
  FulfillmentTaskActionRunner,
} from './hooks/use-fulfillment-task-action-runner';

// #3340 — the fulfilment screen's own composition surface.
export { AssignPackingWorkLaneSection } from './components/assign-packing-work-lane-section';
export type { AssignPackingWorkLaneSectionProps } from './components/assign-packing-work-lane-section';
export { AssignPackingWorkActions } from './components/assign-packing-work-actions';
export { useUpdateFulfillmentAssignmentMutation } from './hooks/use-update-fulfillment-assignment-mutation';
export {
  groupTasksByPacker,
  lightestLoadLaneIds,
  // The location grouping, normalised into the shape the board renders — the
  // adapter for the merged screen's second axis.
  toBoardLanes,
  UNASSIGNED_LANE_ID,
} from './lib/assign-packing-work-lanes';
export type { AssignPackingWorkLane } from './lib/assign-packing-work-lanes';
export { ASSIGN_PACKING_WORK_COPY } from './lib/assign-packing-work.copy';
// #3424 — the "Oldest unassigned" metric's inputs; the badge's own use of
// this module stays internal to the card component.
export {
  formatUnassignedAge,
  oldestUnassignedSince,
} from './lib/assign-packing-work-duration';

export {
  describeFulfillmentActionError,
  readFulfillmentConflict,
} from './lib/fulfillment-conflict';
export { fulfillmentActionLabel, FULFILLMENT_ACTION_COPY } from './lib/fulfillment-task.copy';
export { FULFILLMENT_WORKLIST_COPY } from './lib/fulfillment-worklist.copy';
// The screen's second grouping axis (`?groupBy=location`), normalised for
// rendering by `toBoardLanes` above. `summariseLaneLines` stayed private and
// went unused when the lane section that read it was deleted.
export { groupTasksIntoLanes } from './lib/fulfillment-lanes';
export type { FulfillmentLane } from './lib/fulfillment-lanes';
export {
  clearFulfillmentFilters,
  hasActiveFulfillmentFilters,
  readFulfillmentFilters,
  readFulfillmentOffset,
  setFulfillmentFilterParam,
  setFulfillmentOffsetParam,
} from './lib/fulfillment-filters';

export type {
  ApplyFulfillmentTaskActionRequest,
  FulfillmentTask,
  FulfillmentTaskFilters,
  FulfillmentTaskHold,
  FulfillmentTaskLine,
  FulfillmentTaskPage,
} from './api/fulfillment.types';
