/**
 * Fulfilment — public surface (#2411, widened by #2410, narrowed by the
 * merge, widened again by #3096's routed detail page)
 *
 * Three consumers outside this folder: the order-detail panel's host, the
 * `/fulfillment` screen, and `/fulfillment/works/:workId`'s detail page. Both
 * pages live under `pages/`, so everything either composes leaves the
 * folder.
 *
 * The screen merge REMOVED exports rather than adding them.
 * `FulfillmentLaneSection` and `FulfillmentWorklistRow` went with the worklist
 * page that was their only consumer; `groupTasksIntoLanes` survives because
 * the merged screen still offers that grouping as its second axis, now behind
 * `?groupBy=` rather than behind a second URL. #3096 re-widened the surface:
 * the status/handshake labels and `FULFILLMENT_EXPEDITED_BADGE` left the
 * folder because the detail hero is now a second consumer of both.
 *
 * Deliberately NOT exported, per the start-narrow rule: the api module and
 * the query keys beyond `detail` (the pages reach transport through the
 * hooks, and the action mutation already invalidates the whole feature), and
 * the task card, which still has no consumer outside this folder. Adding it
 * back is one line on the day something needs it.
 *
 * @module apps/web/src/features/fulfillment
 */
export { OrderFulfillmentTasksPanel } from './components/order-fulfillment-tasks-panel';
export type { OrderFulfillmentTasksPanelProps } from './components/order-fulfillment-tasks-panel';

// #3098 — the two sections the routed detail page mounts, plus #3291's
// holder panel folded into the body. Exported so `pages/fulfillment` can
// compose them without reaching past the barrel.
export {
  FulfillmentWorkDetailBody,
  type FulfillmentWorkDetailBodyProps,
} from './components/fulfillment-work-detail-body';
export {
  FulfillmentVsOrdersExplainer,
  type FulfillmentVsOrdersExplainerProps,
} from './components/fulfillment-vs-orders-explainer';

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
// #3097 — one task by id, for the detail page. Its key sits under the
// `['fulfillment', ...]` prefix, so the action mutation below refreshes it.
export { useFulfillmentWorkQuery } from './hooks/use-fulfillment-work-query';
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
// #3098 — the detail hero renders BOTH axes verbatim, exactly as the card
// does: heldness lives in `activeHolds`, not in `status`, so neither label
// may be dropped or merged. Previously private because only the lane
// sections read them; the page is the second consumer.
export {
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
  FULFILLMENT_EXPEDITED_BADGE,
} from './lib/fulfillment-task.copy';
export { FULFILLMENT_WORKLIST_COPY } from './lib/fulfillment-worklist.copy';
// #3096 — the detail page lives in `pages/`, which `check-ui-vocabulary.mjs`
// does not scan, so every sentence it renders is read from here.
export { FULFILLMENT_WORK_DETAIL_COPY } from './lib/fulfillment-work-detail.copy';
// #3099 — the plain-language sentence under the hero's two raw axis labels.
// Pure, and takes a narrow struct rather than the task: a function handed
// the task could reach `supportedActions`, which is the client-side state
// machine `check-no-supported-actions-mirror.mjs` cannot catch.
export {
  summariseFulfillmentWork,
  type FulfillmentWorkSummaryInput,
} from './lib/fulfillment-work-summary';
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
  // #3259 — the one place both directions of the worklist<->detail link are
  // built, so the two can never disagree about which params travel.
  fulfillmentWorkDetailPath,
  fulfillmentWorklistPath,
} from './lib/fulfillment-filters';

export type {
  ApplyFulfillmentTaskActionRequest,
  FulfillmentTask,
  FulfillmentTaskFilters,
  FulfillmentTaskHold,
  FulfillmentTaskLine,
  FulfillmentTaskPage,
} from './api/fulfillment.types';
