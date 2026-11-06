/**
 * Buyer Emails feature barrel (#3555)
 *
 * @module apps/web/src/features/buyer-emails
 */
export {
  BUYER_EMAIL_TEMPLATE_VALUES,
  MARKETPLACE_BUYER_EMAIL_TEMPLATES,
  isBuyerEmailTemplate,
} from './api/buyer-emails.types';
export type {
  BuyerEmailDelivery,
  BuyerEmailTemplate,
  BuyerEmailTemplateSettings,
  BuyerEmailsSettings,
} from './api/buyer-emails.types';
export * from './lib/buyer-emails-config';
export { templateCopy, templateLabel } from './lib/buyer-email-template-label';
export type { BuyerEmailTemplateCopy } from './lib/buyer-email-template-label';
export {
  BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE,
  isBuyerEmailTestRateLimitedError,
} from './lib/buyer-email-test-error';
export { mapBuyerEmailsToEvents } from './lib/buyer-email-timeline-events';
export { useOrderBuyerEmailsQuery } from './hooks/use-order-buyer-emails-query';
export { useSendBuyerEmailTestMutation } from './hooks/use-send-buyer-email-test-mutation';
export { useBuyerEmailRules } from './hooks/use-buyer-email-rules';
export { useSaveBuyerEmailTemplateMutation } from './hooks/use-save-buyer-email-template-mutation';
export {
  BuyerEmailSaveError,
  type SaveBuyerEmailTemplateInput,
} from './hooks/use-save-buyer-email-template-mutation';
export {
  buildBuyerEmailEditorSchema,
  buildBuyerEmailTestFormSchema,
  type BuyerEmailEditorFormValues,
  type BuyerEmailTestFormValues,
} from './lib/buyer-email-editor.schema';
export { useSetBuyerEmailsEnabledMutation } from './hooks/use-set-buyer-emails-enabled-mutation';
export { OrderBuyerEmailsPanel } from './components/order-buyer-emails-panel';
export { BuyerEmailsTile } from './components/buyer-emails-tile';
