/**
 * Returns — DI Tokens (#2327, widened by #2330, #2332, #2333 and #2370)
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
