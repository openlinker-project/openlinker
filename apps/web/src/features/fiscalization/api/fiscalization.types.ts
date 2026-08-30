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

export interface RegisterFiscalTransactionInput {
  connectionId: string;
  orderId: string;
}
