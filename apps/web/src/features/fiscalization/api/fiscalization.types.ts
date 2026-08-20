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

export type FiscalReconcileOutcome = 'resolved' | 'not-found' | 'unsupported';

export interface ReconcileFiscalRegistrationResult {
  outcome: FiscalReconcileOutcome;
  record: FiscalRegistrationRecord;
}

export interface RegisterFiscalTransactionInput {
  connectionId: string;
  orderId: string;
}
