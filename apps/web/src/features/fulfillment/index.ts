/**
 * Fulfilment — public surface (#2411, widened by #2410)
 *
 * #2411 exported only the order-detail panel and recorded that #2410's
 * standalone worklist would be the second consumer of this slice's api / hooks
 * / lib, adding its line when it landed. This is that line: the worklist page
 * lives under `pages/`, so everything it composes has to leave the folder.
 *
 * Deliberately NOT exported, per the start-narrow rule: the api module and the
 * query keys (the page reaches transport through the hooks, and the action
 * mutation already invalidates the whole feature); and the row, the card, the
 * lane grouping and the status/handshake labels, which are composed by
 * `FulfillmentLaneSection` INSIDE this folder and have no consumer outside it
 * (the page composes lanes, so `groupTasksIntoLanes` itself does leave).
 * Adding any of them back is one line on the day something needs it.
 *
 * @module apps/web/src/features/fulfillment
 */
export { OrderFulfillmentTasksPanel } from './components/order-fulfillment-tasks-panel';
export type { OrderFulfillmentTasksPanelProps } from './components/order-fulfillment-tasks-panel';

// #2410 — the standalone worklist's composition surface.
export { FulfillmentLaneSection } from './components/fulfillment-lane-section';
export type { FulfillmentLaneSectionProps } from './components/fulfillment-lane-section';
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

export {
  describeFulfillmentActionError,
  readFulfillmentConflict,
} from './lib/fulfillment-conflict';
export { fulfillmentActionLabel, FULFILLMENT_ACTION_COPY } from './lib/fulfillment-task.copy';
export { FULFILLMENT_WORKLIST_COPY } from './lib/fulfillment-worklist.copy';
// The page groups the page's rows into lanes and maps them; `summariseLaneLines`
// stays private because only `FulfillmentLaneSection` reads it.
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
