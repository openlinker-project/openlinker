/**
 * Fiscalization feature barrel (#1909)
 *
 * `OrderReceiptPanel` was removed by #2160: the `orders` feature's
 * `SalesDocumentPanel` (ADR-041) replaced it as the order-detail-page
 * consumer, reassembling the same lifecycle rendering inside the unified
 * "Sales document" slot. The display badge, artefact list, hooks, and pure
 * derivation helpers below are the pieces that component reuses — they were
 * exported for the panel's own use only and are now genuinely cross-feature.
 *
 * @module apps/web/src/features/fiscalization
 */
export { createFiscalizationApi } from './api/fiscalization.api';
export type { FiscalizationApi } from './api/fiscalization.api';
export type {
  AcceptedFiscalRegistration,
  FiscalRegistrationProgress,
  FiscalRegistrationProgressView,
  SalesDocumentInFlight,
  FiscalArtefact,
  FiscalArtefactMedium,
  FiscalArtefactDisposition,
  FiscalRegistrationFailureMode,
  FiscalRegistrationRecord,
  FiscalRegistrationStatus,
  FiscalReconcileOutcome,
  ReconcileFiscalRegistrationResult,
  RegisterFiscalTransactionInput,
} from './api/fiscalization.types';
export { FiscalReceiptStatusBadge } from './components/fiscal-receipt-status-badge';
export type { FiscalReceiptDisplayStatus } from './components/fiscal-receipt-status-badge';
export { FiscalArtefactList } from './components/fiscal-artefact-list';
export { useOrderFiscalRegistrationsQuery } from './hooks/use-order-fiscal-registrations-query';
export { useFiscalRegistrationProgressQuery } from './hooks/use-fiscal-registration-progress-query';
export { useRegisterFiscalReceiptMutation } from './hooks/use-register-fiscal-receipt-mutation';
export { useReconcileFiscalRegistrationMutation } from './hooks/use-reconcile-fiscal-registration-mutation';
export {
  selectFiscalizationCandidates,
  type FiscalizationConnectionLike,
} from './lib/resolve-fiscalization-connection';
export {
  deriveFiscalReceiptDisplayStatus,
  canRetryFiscalReceipt,
  resolveFiscalFailureCopy,
} from './lib/derive-fiscal-receipt-display';
