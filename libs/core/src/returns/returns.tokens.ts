/**
 * Returns — DI Tokens (#2327, widened by #2330, #2332, #2333, #2370, #2371, #2372 and #2374)
 *
 * @module libs/core/src/returns
 */
export const RETURN_REPOSITORY_TOKEN = Symbol('ReturnRepositoryPort');
export const RETURNS_SERVICE_TOKEN = Symbol('IReturnsService');
export const RETURN_INGESTION_SERVICE_TOKEN = Symbol('IReturnIngestionService');
export const RETURN_STATUS_SYNC_SERVICE_TOKEN = Symbol('IReturnStatusSyncService');
// The one return WRITE (#2333) — the ADR-044 `return.decline` action.
export const RETURN_DECLINE_SERVICE_TOKEN = Symbol('IReturnDeclineService');
export const RETURN_REATTRIBUTION_SERVICE_TOKEN = Symbol('IReturnReattributionService');
// The custody WRITES (#2370) — receive, dispose, and the operator attestation.
export const RETURN_CUSTODY_SERVICE_TOKEN = Symbol('IReturnCustodyService');
// The money WRITE (#2371) — the refund trigger and its observation.
export const RETURN_REFUND_SERVICE_TOKEN = Symbol('IReturnRefundService');
// The authorize WRITE (#2372) — restricted to operator-authored returns.
export const RETURN_AUTHORIZE_SERVICE_TOKEN = Symbol('IReturnAuthorizeService');
// The credit-note correction PROPOSAL (#2374). A proposal is data: this service
// issues nothing and confers no authority to issue. Note the name deliberately
// says "proposal" — `no-second-proposal-mechanism.spec.ts` bans a proposal
// *store* token, which this is not (it persists through IOrderChangeService).
export const RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN = Symbol(
  'IReturnCorrectionProposalService'
);
