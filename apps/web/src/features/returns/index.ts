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
export { ReturnIdentityCell, returnIdentitySummary } from './components/return-identity-cell';
export { ReturnOrderCell, returnOrderSummary } from './components/return-order-cell';
export { ReturnOpenedCell } from './components/return-opened-cell';
export { ReturnSourceStatus } from './components/return-source-status';
export { ReturnStatusCell } from './components/return-status-cell';
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
