/**
 * Buyer Data feature barrel (#4289)
 *
 * @module apps/web/src/features/buyer-data
 */
export { BUYER_DATA_ERASE_MODES, isBuyerDataEraseMode } from './api/buyer-data.types';
export type {
  BuyerDataAgeHistogram,
  BuyerDataEraseMode,
  BuyerDataOverride,
  BuyerDataPreview,
  BuyerDataPreviewInput,
  BuyerDataRules,
  BuyerDataWizardChoice,
  BuyerDataWizardValue,
} from './api/buyer-data.types';
export * from './lib/buyer-data-config';
export { usePeriodLabel } from './hooks/use-period-label';
export { useShortPeriod } from './hooks/use-short-period';
export { useBuyerDataSummary } from './hooks/use-buyer-data-summary';
export { RetentionScope } from './components/retention-scope';
export { BuyerDataSection } from './components/buyer-data-section';
export { BuyerDataTile } from './components/buyer-data-tile';
export {
  BuyerDataWizardReviewRows,
  BuyerDataWizardStep,
} from './components/buyer-data-wizard-step';
