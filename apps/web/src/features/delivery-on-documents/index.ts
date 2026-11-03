/**
 * Delivery on documents - public surface (#3908)
 *
 * Only the panel the connection mappings page mounts is public; the mirror
 * (`lib/delivery-line.ts`) is guarded by `check-delivery-line-mirror.mjs`.
 */
export { DeliveryOnDocumentsPanel } from './components/delivery-on-documents-panel';
export { DeliveryWizardStep } from './components/delivery-wizard-step';
export { DeliveryWizardSummary } from './components/delivery-wizard-summary';
export { useDeliveryLineSuggestionsQuery } from './hooks/use-delivery-on-documents-queries';
export {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  wizardConfig,
  wizardRules,
  wizardSummaryRows,
  type DeliveryWizardValue,
} from './lib/delivery-wizard';
export type { DeliveryOnDocumentsConfig } from './lib/delivery-line';
export type { DeliveryLineSuggestion } from './api/delivery-on-documents.types';
