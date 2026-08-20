/**
 * Fiscalization feature barrel (#1909)
 *
 * @module apps/web/src/features/fiscalization
 */
export { OrderReceiptPanel } from './components/order-receipt-panel';
export { createFiscalizationApi } from './api/fiscalization.api';
export type { FiscalizationApi } from './api/fiscalization.api';
export type {
  FiscalArtefact,
  FiscalRegistrationFailureMode,
  FiscalRegistrationRecord,
  FiscalRegistrationStatus,
  RegisterFiscalTransactionInput,
} from './api/fiscalization.types';
