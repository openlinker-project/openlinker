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
export { BUYER_EMAILS_COPY, BUYER_EMAIL_TEMPLATE_COPY, templateLabel } from './lib/buyer-emails.copy';
export { mapBuyerEmailsToEvents } from './lib/buyer-email-timeline-events';
export { useOrderBuyerEmailsQuery } from './hooks/use-order-buyer-emails-query';
export { useSendBuyerEmailTestMutation } from './hooks/use-send-buyer-email-test-mutation';
export { useBuyerEmailRules } from './hooks/use-buyer-email-rules';
export { useSaveBuyerEmailTemplateMutation } from './hooks/use-save-buyer-email-template-mutation';
export type { SaveBuyerEmailTemplateInput } from './hooks/use-save-buyer-email-template-mutation';
export { OrderBuyerEmailsPanel } from './components/order-buyer-emails-panel';
export { BuyerEmailsTile } from './components/buyer-emails-tile';
