/**
 * Buyer Emails Types (#3555)
 *
 * The browser's view of #3554's buyer emails. `apps/web` cannot import
 * `@openlinker/core` (#591), so the template vocabulary and the suppression
 * reasons are restated here; an unknown value from the API degrades to a
 * generic label rather than crashing the page.
 *
 * @module apps/web/src/features/buyer-emails/api
 */

/** The four templates, in the order the settings page lists them. */
export const BUYER_EMAIL_TEMPLATE_VALUES = [
  'order-confirmed',
  'shipped',
  'document-issued',
  'return-received',
] as const;
export type BuyerEmailTemplate = (typeof BUYER_EMAIL_TEMPLATE_VALUES)[number];

/** The templates a marketplace connection may send (order confirmation is the shop's). */
export const MARKETPLACE_BUYER_EMAIL_TEMPLATES: readonly BuyerEmailTemplate[] = [
  'shipped',
  'document-issued',
  'return-received',
];

export function isBuyerEmailTemplate(value: unknown): value is BuyerEmailTemplate {
  return (
    typeof value === 'string' && (BUYER_EMAIL_TEMPLATE_VALUES as readonly string[]).includes(value)
  );
}

export interface BuyerEmailTemplateSettings {
  enabled: boolean;
  fromAddress?: string;
  replyTo?: string;
}

export interface BuyerEmailsSettings {
  enabled: boolean;
  templates: Partial<Record<BuyerEmailTemplate, BuyerEmailTemplateSettings>>;
}

/**
 * `pending` is the send slot claimed before the mailer runs (#3554): a send in
 * flight, or one whose process died mid-send. Never shown as sent.
 */
export type BuyerEmailOutcome = 'pending' | 'sent' | 'suppressed' | 'bounced';

/** One row of `GET /orders/:id/buyer-emails`. Carries no recipient address. */
export interface BuyerEmailDelivery {
  id: string;
  connectionId: string;
  templateKey: string;
  subjectRef: string;
  outcome: BuyerEmailOutcome;
  suppressionReason: string | null;
  suppressionMessage: string | null;
  createdAt: string;
}

export interface SendBuyerEmailTestInput {
  connectionId: string;
  templateKey: BuyerEmailTemplate;
  to: string;
  subject: string;
  body: string;
}
