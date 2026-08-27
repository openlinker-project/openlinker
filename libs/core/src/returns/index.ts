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
export type {
  ReturnRepositoryPort,
  // #2370: the shape a `runLineWrite` callback returns. Exported alongside the
  // port because anyone typing an implementation of it needs the decision type.
  ReturnLineWriteDecision,
} from './domain/ports/return-repository.port';
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

// Custody transitions (#2367, `W2-30`): the rules that MOVE
// `ReturnLine.custodyState`, which Wave 1c declared and left undriven. Pure
// functions, no service — see the domain-service's header for why, and for the
// clock rule that keeps `in_transit` a source-reported fact. #2370 (`W2-33`)
// is the consumer: it persists the returned outcome inside its own transaction
// rather than assigning the column itself.
export {
  advanceReturnCustodyToInTransit,
  applyReturnCustodyReceipt,
  applyReturnCustodyDisposition,
  markReturnCustodyNotReturned,
  isReturnCustodyFinished,
} from './domain/domain-services/return-custody-transitions.domain-service';
export type {
  ReturnCustodyLineFacts,
  ReturnCustodyOutcome,
} from './domain/domain-services/return-custody-transitions.domain-service';
export {
  ReturnCustodyTransitionError,
  ReturnCustodyRefusalReasonValues,
} from './domain/exceptions/return-custody-transition.error';
export type { ReturnCustodyRefusalReason } from './domain/exceptions/return-custody-transition.error';

// Custody WRITES (#2370, `W2-33`): receive, dispose, and the operator
// attestation that resolves a refused restock — plus the append-only per-line
// ACT LEDGER those writes record themselves in. The ledger exists because a
// COUNTER cannot key an idempotent trigger firing: #2360 needs a three-parcel
// return to fire `return.received` three times, and `1 -> 2 -> 3` carries no
// per-arrival identity and is indistinguishable from a correction. The counters
// remain the invariant, still guarded by `CHK_return_lines_quantity_ordering`.
export * from './domain/types/return-line-event.types';
export { ReturnLineEvent } from './domain/entities/return-line-event.entity';
export {
  classifyRestockSuccess,
  classifyRestockFailure,
  blockedBeforeMaster,
} from './domain/domain-services/restock-outcome.domain-service';
export type { RestockOutcome } from './domain/domain-services/restock-outcome.domain-service';
export { ReturnLineNotFoundError } from './domain/exceptions/return-line-not-found.error';
export { ReturnRestockAttestationInvalidError } from './domain/exceptions/return-restock-attestation-invalid.error';
export { ReturnCustodyContendedError } from './domain/exceptions/return-custody-contended.error';
export {
  returnCustodyLockKey,
  RETURN_CUSTODY_LOCK_TTL_MS,
} from './application/services/return-custody-lock';
export type {
  IReturnCustodyService,
  ReceiveLineInput,
  ReceiveLineResult,
  DisposeLineInput,
  DisposeLineResult,
  AttestStockResult,
  RestockBlockedDetail,
} from './application/services/return-custody.service.interface';

// The money WRITE (#2371, `W2-34`, ADR-056): the refund trigger, the
// `in_doubt` block, and the observation that is the only path to `refunded`.
//
// Two properties a consumer must not undo. The attempted-predicate is persisted
// BEFORE the provider call and the persist IS the block (a single conditional
// UPDATE, so a lost lock cannot double-refund); and `in_doubt` is written only
// where a boundary was ACTUALLY crossed — the no-executor path, the only one
// reachable today, claims straight to `triggered` because asserting doubt about
// a call that never happened is a false statement about the operator's money.
//
// This service writes no `RefundRecord`: it REPORTS a `ReturnRefundRecordIntent`
// for the caller to write through `IOrderRefundService` (the #2100
// report-don't-persist seam), which is what keeps `OrdersModule` out of this
// context's graph.
export {
  REFUND_ATTEMPTABLE_MONEY_STATES,
  isRefundAttemptable,
  blocksRefundAttempt,
} from './domain/types/return-line.types';
export {
  classifyRefundOutcome,
  classifyRefundFailure,
  refundConfirmedOutOfBand,
} from './domain/domain-services/refund-outcome.domain-service';
export type { RefundOutcome } from './domain/domain-services/refund-outcome.domain-service';
export {
  ReturnRefundBlockedError,
  ReturnRefundBlockReasonValues,
} from './domain/exceptions/return-refund-blocked.error';
export type { ReturnRefundBlockReason } from './domain/exceptions/return-refund-blocked.error';
export { ReturnRefundContendedError } from './domain/exceptions/return-refund-contended.error';
export { ReturnRefundObservationInvalidError } from './domain/exceptions/return-refund-observation-invalid.error';
export {
  returnRefundLockKey,
  RETURN_REFUND_LOCK_TTL_MS,
} from './application/services/return-refund-lock';
export type {
  IReturnRefundService,
  TriggerRefundInput,
  TriggerRefundResult,
  ReturnRefundRecordIntent,
  RecordRefundObservationInput,
} from './application/services/return-refund.service.interface';

// The authorize WRITE, the orphan MATCH and the operator-authored CREATE
// (#2372, `W2-35`, ADR-060/ADR-044).
//
// Three rules a consumer must not undo. `return.authorize` is restricted to
// `origin: 'operator_authored'` — OL must never pretend to decide what a
// marketplace already decided, which is why the refusal is a named error rather
// than a no-op. Attribution is MONOTONIC and there is no unmatch, so a match is an
// irreversible operator act. And an operator-authored return writes
// `externalReturnId: null` — core never synthesises a source key, because the row
// would then claim a source it has not got (a source ADAPTER minting a
// deterministic key for its own platform is a different, established thing).
export {
  ReturnAuthorizeRefusedError,
  ReturnAuthorizeRefusalReasonValues,
} from './domain/exceptions/return-authorize-refused.error';
export type { ReturnAuthorizeRefusalReason } from './domain/exceptions/return-authorize-refused.error';
export {
  ReturnMatchRefusedError,
  ReturnMatchRefusalReasonValues,
} from './domain/exceptions/return-match-refused.error';
export type { ReturnMatchRefusalReason } from './domain/exceptions/return-match-refused.error';
export {
  ReturnRecordRefusedError,
  ReturnRecordRefusalReasonValues,
} from './domain/exceptions/return-record-refused.error';
export type { ReturnRecordRefusalReason } from './domain/exceptions/return-record-refused.error';
export { AuthorizeReturnOutcomeValues } from './application/services/return-authorize.service.interface';
export type {
  IReturnAuthorizeService,
  AuthorizeReturnInput,
  AuthorizeReturnOutcome,
  AuthorizeReturnResult,
} from './application/services/return-authorize.service.interface';
export type {
  MatchOrphanToOrderInput,
  RecordReturnInput,
  RecordReturnLineInput,
} from './application/services/returns.service.interface';
export type { ReturnAttributionMatch } from './domain/ports/return-repository.port';

// The credit-note correction PROPOSAL (#2374, `W2-38`, ADR-060/ADR-044).
//
// A proposal is DATA. Nothing behind this surface issues a correction, contacts
// a provider, or confers authority to issue one — auto-issue stays gated on
// `InvoiceLine` gaining a stable reference, which it has not got. The positional
// ambiguity is SHOWN (`ambiguous` lists every candidate and selects none) rather
// than resolved, because a correction transmitted to a tax authority cannot be
// withdrawn.
export {
  ReturnCorrectionLineStatusValues,
  ReturnCorrectionNoMatchReasonValues,
  ReturnCorrectionProposalOutcomeValues,
} from './domain/types/return-correction-proposal.types';
export type {
  ReturnCorrectionCandidate,
  ReturnCorrectionLineStatus,
  ReturnCorrectionNoMatchReason,
  ReturnCorrectionProposal,
  ReturnCorrectionProposalLine,
  ReturnCorrectionProposalOutcome,
  ReturnCorrectionProposalResult,
} from './domain/types/return-correction-proposal.types';
export {
  classifyReturnCorrectionLines,
  describeCorrectionNoMatchReason,
  normalizeCorrectionLineName,
} from './domain/domain-services/return-correction-matching.domain-service';
export type {
  CorrectionReturnLineInput,
  CorrectionSnapshotLine,
} from './domain/domain-services/return-correction-matching.domain-service';
export type {
  BuildReturnCorrectionProposalInput,
  IReturnCorrectionProposalService,
} from './application/services/return-correction-proposal.service.interface';
