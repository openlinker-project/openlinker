/**
 * Returns — public barrel (#2327)
 *
 * ADR-060: returns are an OL-owned aggregate ABOVE the source projection, in a
 * context of their own. Folding them into `orders` — already the most
 * outbound-coupled context in the tree — would have made that context worse,
 * and returns carry authority questions (custody, disposition, restock) that
 * are the operator's, not the source's.
 *
 * #2327 shipped the model and its schema; #2328 added ingestion's idempotent
 * update-or-create and the service that owns it; #2330 adds the two passes that
 * feed it from a source. Still no transitions, no restock and no API. See `ReturnRepositoryPort` for the map of what widens
 * this barrel and when.
 *
 * A sibling context consumes `IReturnsService` + `RETURNS_SERVICE_TOKEN`, never
 * `ReturnRepositoryPort` — the cross-context contract is service interfaces.
 *
 * NOT re-exported from the aggregating root barrel (`libs/core/src/index.ts`) —
 * the `sales-documents` posture; the root barrel is not an inventory of
 * contexts, and this one is reached at its own `@openlinker/core/returns`
 * subpath.
 *
 * @module libs/core/src/returns
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */
export * from './domain/types/return.types';
export * from './domain/types/return-line.types';
export { ReturnRecord } from './domain/entities/return-record.entity';
export { ReturnLine } from './domain/entities/return-line.entity';
export type { ReturnRepositoryPort } from './domain/ports/return-repository.port';
export { ReturnsModule } from './returns.module';
export * from './returns.tokens';

// Source projection (#2329): the neutral read-only shapes a `ReturnSourceReader`
// reports. Non-authoritative — custody/disposition/restock stay with ReturnRecord.
export type { IncomingReturn, IncomingReturnLine } from './domain/types/incoming-return.types';
export type {
  ReturnFeedInput,
  ReturnFeedItem,
  ReturnFeedOutput,
} from './domain/types/return-feed.types';

// Ingestion (#2328): the idempotent update-or-create and its service seam.
export * from './domain/types/return-upsert.types';
export { narrowRefundReason, toRefundReasonOrOther } from './domain/return-reason.mapper';
export { ReturnObservationMissingExternalIdError } from './domain/exceptions/return-observation-missing-external-id.error';
export { ReturnPersistenceError } from './domain/exceptions/return-persistence.error';
export type {
  IReturnsService,
  UpsertReturnObservationResult,
} from './application/services/returns.service.interface';

// Ingestion passes (#2330): discovery + fan-out, and the bounded lifecycle
// re-read that is the only channel through which OL ever observes a return
// moving. See `ReturnSourceReader`'s docblock for why there must be two.
export type {
  ReturnSourceSweepFilter,
  ReturnSourceSweepPage,
  ReturnSweepCandidate,
} from './domain/types/return-sweep.types';
export type {
  IReturnIngestionService,
  ReturnIngestionOptions,
  ReturnIngestionResult,
  ReturnSyncResult,
} from './application/services/return-ingestion.service.interface';
export type {
  IReturnStatusSyncService,
  ReturnStatusSyncOptions,
  ReturnStatusSyncResult,
} from './application/services/return-status-sync.service.interface';

// The one return WRITE (#2333, ADR-060/ADR-044): `return.decline` as an ADR-044
// proposal against the `order_changes` table this slice lands. The neutral
// command/result live HERE (the returns vocabulary is owned by returns); the
// capability interface + guard that consume them live beside their read-only
// sibling in `@openlinker/core/orders`.
//
// NOTE the two refusals a decline shares with every other downstream trigger —
// `ReturnNotFoundError` and `ReturnNotAttributedError` — are NOT exported from
// here. They are the #2332 orphan-guard vocabulary below, and there is exactly
// one definition of each in the tree (see the merge note in
// `return-decline-unsupported.error.ts`).
export type {
  ReturnDeclineCommand,
  ReturnDeclineResult,
} from './domain/types/return-decline.types';
export { ReturnDeclineUnsupportedError } from './domain/exceptions/return-decline-unsupported.error';
export { ReturnDeclineRejectedBySourceError } from './domain/exceptions/return-decline-rejected-by-source.error';
export { ReturnDeclineInvalidRequestError } from './domain/exceptions/return-decline-invalid-request.error';
export { DeclineReturnOutcomeValues } from './application/services/return-decline.service.interface';
export type {
  IReturnDeclineService,
  DeclineReturnInput,
  DeclineReturnOutcome,
  DeclineReturnResult,
} from './application/services/return-decline.service.interface';

// Orphan bucket, downstream-trigger block and re-attribution reconcile (#2332).
// `ReturnBucket` is the vocabulary #2334's `?bucket=` validates against;
// `ReturnDownstreamTrigger` + the two errors are what a Wave-2 trigger imports so it can
// call the guard and catch its refusal — including the `return.decline` write above,
// which asserts attribution through the same seam rather than its own null check.
export * from './domain/types/return-bucket.types';
export * from './domain/types/return-trigger.types';
export type {
  ReturnReattributionCandidate,
  ReturnReattributionOptions,
  ReturnReattributionPage,
  ReturnReattributionResult,
} from './domain/types/return-reattribution.types';
export { ReturnNotAttributedError } from './domain/exceptions/return-not-attributed.error';
export { ReturnNotFoundError } from './domain/exceptions/return-not-found.error';
export type { IReturnReattributionService } from './application/services/return-reattribution.service.interface';

// The read API's vocabulary (#2334): the list filter, the bucket partition the
// frontend's chips render, and the two capability facts a read surface needs —
// "can anything here ingest returns at all" and "may the decline action be
// offered for this return". `ReturnDeclineUnsupportedReasonValues` is exported
// as a value because it is the reason vocabulary a response DTO enumerates.
export * from './domain/types/return-query.types';
