/**
 * Buyer Data feature barrel (#4289)
 *
 * @module apps/web/src/features/buyer-data
 */
export { BUYER_DATA_ERASE_MODES, isBuyerDataEraseMode } from './api/buyer-data.types';
export type {
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
export { useBuyerDataImpactQuery } from './hooks/use-buyer-data-impact-query';
export { useBuyerDataTrialMutation } from './hooks/use-buyer-data-trial-mutation';
export { BuyerDataImpact } from './components/buyer-data-impact';
export { BuyerDataRulesEditor, useBuyerDataSummary } from './components/buyer-data-rules-editor';
export { BuyerDataSection } from './components/buyer-data-section';
export { BuyerDataTile } from './components/buyer-data-tile';
export { BuyerDataTrial } from './components/buyer-data-trial';
export {
  BuyerDataWizardReviewRows,
  BuyerDataWizardStep,
} from './components/buyer-data-wizard-step';
