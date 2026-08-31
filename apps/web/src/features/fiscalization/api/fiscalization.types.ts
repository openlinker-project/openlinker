/**
 * Fiscalization API types (#1909)
 *
 * Mirrors `FiscalRegistrationResponseDto` (apps/api/src/fiscalization/http/dto)
 * field-for-field. Kept as a distinct FE type rather than importing the DTO
 * class, matching every other feature's `api/*.types.ts` convention (the FE
 * never imports `@openlinker/core/*` or an API DTO directly).
 *
 * @module apps/web/src/features/fiscalization/api
 */

export type FiscalRegistrationStatus = 'pending' | 'registering' | 'registered' | 'failed';

export type FiscalRegistrationFailureMode = 'rejected' | 'in-doubt';

export type FiscalArtefactMedium = 'document' | 'markup' | 'code' | 'link' | 'text';

export type FiscalArtefactDisposition = 'print' | 'display' | 'send' | 'retain';

export interface FiscalArtefact {
  medium: FiscalArtefactMedium;
  disposition: FiscalArtefactDisposition;
  content: string;
  contentType: string | null;
  label: string | null;
}

export interface FiscalRegistrationRecord {
  id: string;
  connectionId: string;
  orderId: string;
  providerType: string;
  idempotencyKey: string;
  status: FiscalRegistrationStatus;
  providerReference: string | null;
  documentReference: string | null;
  signingIdentity: string | null;
  registeredAt: string | null;
  regimeExtras: Record<string, string> | null;
  artefacts: FiscalArtefact[] | null;
  failureMode: FiscalRegistrationFailureMode | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mirrors `FiscalReconcileOutcomeValues` in
 * `libs/core/src/fiscalization/domain/types/fiscalization.types.ts`.
 *
 * The browser bundle cannot import `@openlinker/core`, so this is a hand-written
 * copy and it drifts silently in both directions - a value added only to core
 * never reaches the browser, and one added only here type-checks against
 * something the API will never send. `scripts/check-fiscal-reconcile-outcome-mirror.mjs`
 * enforces the equality under `pnpm check:invariants`; this comment is not the
 * enforcement.
 *
 * Only `resolved` changes the record. The other three leave it exactly as it
 * was, and none of them licenses a resend.
 */
export type FiscalReconcileOutcome =
  | 'resolved'
  | 'not-found'
  | 'unsupported'
  | 'still-unknown';

export interface ReconcileFiscalRegistrationResult {
  outcome: FiscalReconcileOutcome;
  record: FiscalRegistrationRecord;
}

/**
 * Mirrors `AcceptedFiscalRegistrationResponseDto`.
 *
 * The answer to asking for a registration. It carries no status and no record,
 * because when it is sent a job exists and no provider has been called. Nothing
 * may read an outcome out of it.
 */
export interface AcceptedFiscalRegistration {
  orderId: string;
  connectionId: string;
  idempotencyKey: string;
  jobId: string;
  /** The request restarted a job that had given up, rather than joining a live one. */
  redrivenFromDead: boolean;
}

export interface RegisterFiscalTransactionInput {
  connectionId: string;
  orderId: string;
}

/**
 * Mirrors `FiscalRegistrationProgressValues` in
 * `libs/core/src/fiscalization/domain/types/fiscal-registration-progress.types.ts`.
 *
 * The browser bundle cannot import `@openlinker/core` (#591), so this is a
 * hand-written copy and it drifts silently in both directions.
 * `scripts/check-fiscal-registration-progress-mirror.mjs` enforces the equality
 * under `pnpm check:invariants`; this comment is not the enforcement.
 *
 * `stalled` is not a failure: intent was recorded and nothing is running, and
 * asking again is what moves it. `rejected` and `in-doubt` must stay apart -
 * only a rejection may be re-attempted, because an in-doubt outcome means the
 * sale may already be registered.
 */
export type FiscalRegistrationProgress =
  | 'not-requested'
  | 'queued'
  | 'running'
  | 'stalled'
  | 'registered'
  | 'rejected'
  | 'in-doubt';

/**
 * A sales document being produced for this order right now, on any connection.
 *
 * `since` is a LOWER BOUND on how long the attempt has been running, never its
 * start: nothing persists a claim-start instant, and a write inside a live claim
 * moves it forward. A surface may render an elapsed reading from it and must not
 * render a start time, a countdown or an estimate - OpenLinker observes no steps
 * between handing a sale to a provider and getting one answer back.
 */
export interface SalesDocumentInFlight {
  documentKind: 'invoice' | 'fiscal-receipt';
  connectionId: string;
  recordId: string;
  since: string;
}

/** Mirrors `FiscalRegistrationProgressResponseDto`. */
export interface FiscalRegistrationProgressView {
  progress: FiscalRegistrationProgress;
  /** Null while the work is queued, which is normal rather than an error. */
  record: FiscalRegistrationRecord | null;
  inFlight: SalesDocumentInFlight | null;
}
