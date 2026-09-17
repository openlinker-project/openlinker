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
export { CorrectionProposalPanel } from './components/correction-proposal-panel';
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
export { ReturnOrderCell, ReturnOrphanBadge, returnOrderSummary } from './components/return-order-cell';
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

// ── Orphan/manual-return writes (#2372/#2376, #3079/#3080) ──────────────────
export type {
  AuthorizeReturnOutcome,
  AuthorizeReturnResult,
  MatchReturnToOrderInput,
  MatchReturnToOrderResult,
  RecordReturnInput,
  RecordReturnLineInput,
  RecordReturnResult,
} from './api/returns.types';
export { AUTHORIZE_RETURN_OUTCOME_VALUES, isAuthorizeReturnOutcome } from './api/returns.types';
// Public for the same reason `ReturnDetailUnreadableError` is above: a caller
// needs to tell "the write may have landed, we just could not read the
// result" apart from an ordinary network/validation failure.
export { ReturnWriteResultUnreadableError } from './api/return-write.schema';
export { useAuthorizeReturnMutation } from './hooks/use-authorize-return-mutation';
export { useMatchReturnToOrderMutation } from './hooks/use-match-return-to-order-mutation';
export { useRecordReturnMutation } from './hooks/use-record-return-mutation';
// The worklist itself (#3081) — two labelled groups, one primary action per
// row, each routing to the return's own detail page rather than opening a
// dialog here (see the component docblock for why).
export { OrphanReturnsWorklist } from './components/orphan-returns-worklist';
export { ORPHAN_RETURNS_WORKLIST_COPY } from './lib/orphan-returns-worklist.copy';
// The match-to-order dialog (#3082) — the destination the worklist's
// "Match to an order" link routes toward. Mounted on the return detail
// page's orphan banner (#3085).
export { MatchReturnDialog } from './components/match-return-dialog';
export { MATCH_RETURN_DIALOG_COPY } from './lib/match-return-dialog.copy';
// The approve dialog (#3083) — mounted inline by the worklist itself, since
// this write carries no form to defer to a detail-page destination for.
export { AuthorizeReturnDialog } from './components/authorize-return-dialog';
export { AUTHORIZE_RETURN_DIALOG_COPY } from './lib/authorize-return-dialog.copy';
// The record-a-return-by-hand dialog (#3084) — for a channel with no
// returns feed at all. Standalone entry point (#3078's own list of
// sub-issues has it opened from the returns list, not from a row).
export { RecordReturnDialog } from './components/record-return-dialog';
export { RECORD_RETURN_DIALOG_COPY } from './lib/record-return-dialog.copy';
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
export { RETURN_PROPOSAL_COPY } from './lib/return-proposal.copy';
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

// The order-detail returns panel (#2640, returns spec § 5.4 surface 3).
//
// It lives in THIS feature rather than `features/orders` — see the component's
// own docblock: `features/returns` already value-imports the orders barrel, so
// the reverse edge would close a runtime cycle.
export { OrderReturnsPanel } from './components/order-returns-panel';
export { ORDER_RETURNS_PANEL_COPY } from './lib/order-returns-panel.copy';

// Returns activity on the ORDER timeline (#2383, `W2-45`).
//
// The mapper is exported, the timeline component is not: `features/orders` owns
// the timeline and this feature only contributes rows to it.
export { useOrderReturnEventsQuery } from './hooks/use-order-return-events-query';

// The RETURN-detail activity timeline (#2646). Same acts, same mapper, same
// `by` table as the order timeline above — re-projected at the return grain,
// which is the only grain an ORPHAN return has.
export { useReturnEventsQuery } from './hooks/use-return-events-query';
export { ReturnActivityTimeline } from './components/return-activity-timeline';
export { RETURN_ACTIVITY_COPY } from './lib/return-activity.copy';
export { mapReturnEventsToTimeline } from './lib/return-timeline-events';
export { RETURN_TIMELINE_COPY } from './lib/return-timeline.copy';
export type { ReturnTimelineEntry } from './api/returns.types';
