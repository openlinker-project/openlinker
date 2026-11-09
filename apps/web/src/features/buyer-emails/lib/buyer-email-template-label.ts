/**
 * Buyer Email Template Labels (#3555)
 *
 * The operator-facing name and description of each buyer-email template,
 * read from the `buyer-emails` namespace when called so they follow the
 * active language.
 *
 * @module apps/web/src/features/buyer-emails/lib
 */
import { getMessages } from '../../../shared/i18n';
import { isBuyerEmailTemplate, type BuyerEmailTemplate } from '../api/buyer-emails.types';

export interface BuyerEmailTemplateCopy {
  readonly label: string;
  readonly description: string;
}

export function templateCopy(template: BuyerEmailTemplate): BuyerEmailTemplateCopy {
  return getMessages('buyer-emails').templates[template];
}

/** The label for a template key the API returned, including one this build does not know. */
export function templateLabel(templateKey: string): string {
  return isBuyerEmailTemplate(templateKey)
    ? templateCopy(templateKey).label
    : getMessages('buyer-emails').templateFallback;
}
