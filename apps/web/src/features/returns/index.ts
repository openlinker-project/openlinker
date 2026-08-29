/**
 * Returns — public surface
 *
 * Public barrel for the returns feature (#2335). Cross-feature and cross-plugin
 * consumers import only from here; the `/returns` page is the only consumer
 * today, and pages may deep-import feature internals, so nothing external needs
 * these yet. They are listed so the seam is stable for the order-detail returns
 * panel (returns spec §6) and the return detail (#2336).
 */
export type {
  PaginatedReturns,
  ReturnBucket,
  ReturnBucketCounts,
  ReturnFilters,
  ReturnIngestionAvailability,
  ReturnListItem,
  ReturnOrigin,
  ReturnPagination,
} from './api/returns.types';
export { RETURN_BUCKET_VALUES, RETURNS_PAGE_SIZE, isReturnBucket } from './api/returns.types';
export { createReturnsApi } from './api/returns.api';
export type { ReturnListResult, ReturnsApi } from './api/returns.api';
// Exported for the #2336 decline mutation, which has to invalidate this list
// after a write. The parse helpers deliberately are NOT exported: they are the
// api module's own internals, and a second caller parsing the envelope would be
// a second place that decides what an unreadable row means.
export { returnsQueryKeys } from './api/returns.query-keys';
export { useReturnsQuery } from './hooks/use-returns-query';
export { useReturnIngestionAvailabilityQuery } from './hooks/use-return-ingestion-availability-query';
export { ReturnCustodyPanel } from './components/return-custody-panel';
export { ReturnMoneyPanel } from './components/return-money-panel';
export { ReturnProposalPanel } from './components/return-proposal-panel';
export { useReturnProposalQuery } from './hooks/use-return-proposal-query';
// #2381 — the single home for every refused-restock string (returns spec § 5.4).
// Exported here because the barrel is the ONLY way a cross-feature consumer can
// reach it: `.eslintrc.js` hard-blocks deep imports of `features/returns/lib/**`.
// #2357 (`W2-20`) and the split-out order-panel issue both consume it from here.
export {
  RETURN_RESTOCK_ATTESTED_COPY,
  RETURN_RESTOCK_BLOCKED_COPY,
  RETURN_RESTOCK_BLOCKED_EXPLAINER,
} from './lib/restock-blocked.copy';
export { ReturnIdentityCell, returnIdentitySummary } from './components/return-identity-cell';
export { ReturnOrderCell, returnOrderSummary } from './components/return-order-cell';
export { ReturnOpenedCell } from './components/return-opened-cell';
export { ReturnSourceStatus } from './components/return-source-status';
// #2377 replaced `ReturnStatusCell` (which could render only `Declined`, for
// want of counters) with the derived stage. `declined` survives as stage #1.
export { ReturnStageCell } from './components/return-stage-cell';
export {
  RETURN_STAGE_LABELS,
  RETURN_STAGE_TONES,
  deriveReturnStage,
  returnCounterLine,
} from './lib/return-row';
export { RETURN_STAGE_VALUES, isReturnStage } from './lib/return-stage.types';
export type { ReturnStage } from './lib/return-stage.types';

// ── Return detail (#2336) ────────────────────────────────────────────────────
export type {
  DeclineReturnInput,
  DeclineReturnOutcome,
  DeclineReturnResult,
  ReturnCustodyState,
  ReturnDeclineAvailability,
  ReturnDeclineUnsupportedReason,
  ReturnDetail,
  ReturnDisposition,
  ReturnLine,
  ReturnLineReason,
  ReturnMoneyState,
} from './api/returns.types';
export {
  DECLINE_RETURN_OUTCOME_VALUES,
  RETURN_CUSTODY_STATE_VALUES,
  RETURN_DECLINE_UNSUPPORTED_REASON_VALUES,
  RETURN_DISPOSITION_VALUES,
  RETURN_LINE_REASON_VALUES,
  RETURN_MONEY_STATE_VALUES,
} from './api/returns.types';
// The error type is public because the PAGE branches on it — telling "this
// build could not read the record" apart from a network failure is the whole
// reason it exists. The parse functions themselves stay private, as above.
export { ReturnDetailUnreadableError } from './api/return-detail.schema';
export { useReturnQuery } from './hooks/use-return-query';
export { useDeclineReturnMutation } from './hooks/use-decline-return-mutation';
export { ReturnDeclineAction } from './components/return-decline-action';
export { ReturnLineStateChip } from './components/return-line-state-chips';
export { ReturnLinesTable } from './components/return-lines-table';
export { ReturnOrphanBanner } from './components/return-orphan-banner';
export {
  RETURN_DECLINE_COPY,
  RETURN_DECLINE_ERROR_COPY,
  RETURN_DECLINE_OUTCOME_COPY,
  RETURN_DETAIL_COPY,
  RETURN_DETAIL_HEADER_COPY,
  RETURN_LINES_COPY,
  RETURN_ORPHAN_BANNER_COPY,
  RETURN_SOURCE_PANEL_COPY,
  describeLineQuantity,
  describeUnreadableLines,
} from './lib/return-detail.copy';
export { describeDeclineError, readBlockedTrigger } from './lib/decline-error';
export {
  RETURNS_EMPTY_COPY,
  RETURNS_ERROR_COPY,
  RETURNS_FILTER_COPY,
  RETURNS_ORPHAN_COPY,
  RETURNS_PAGE_COPY,
  RETURNS_PAGINATION_COPY,
  RETURNS_ROW_COPY,
  RETURNS_SOURCE_STATUS_COPY,
  describeRange,
  describeUnreadableRows,
} from './lib/returns-list.copy';
export {
  RETURN_FILTER_PARAMS,
  RETURN_OFFSET_PARAM,
  clearReturnFilters,
  hasActiveReturnFilters,
  readReturnFilters,
  readReturnOffset,
  setReturnFilterParam,
  setReturnOffsetParam,
} from './lib/returns-filters';

// The worklist strip and the two rails (#2378, `W2-41`).
//
// Segments OVERLAP — their counts do not sum to `All returns`, and the strip has
// SEVEN cards because `All open` is a filter, not the cleared state.
export { ReturnSegmentStrip } from './components/return-segment-strip';
export { ReturnRailsNote } from './components/return-line-state-chips';
export {
  RETURN_SEGMENT_VALUES,
  RETURN_SEGMENT_LABELS,
  RETURN_SEGMENT_TONES,
  ATTENTION_WORTHY_RETURN_SEGMENTS,
  isReturnSegment,
} from './lib/return-segments';
export type { ReturnSegment, ReturnSegmentCounts } from './lib/return-segments';

// Returns activity on the ORDER timeline (#2383, `W2-45`).
//
// The mapper is exported, the timeline component is not: `features/orders` owns
// the timeline and this feature only contributes rows to it.
export { useOrderReturnEventsQuery } from './hooks/use-order-return-events-query';
export { mapReturnEventsToTimeline } from './lib/return-timeline-events';
export { RETURN_TIMELINE_COPY } from './lib/return-timeline.copy';
export type { ReturnTimelineEntry } from './api/returns.types';
