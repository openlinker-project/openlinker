/**
 * Buyer-email attempts -> Activity timeline events (#3555)
 *
 * Maps each automatic buyer email onto the timeline's `DatedTimelineEvent`, the
 * document-email precedent (#3551). A suppression shows the server's own
 * sentence verbatim (`suppressionMessage`), so the reason reads the same here
 * and in the automation run log.
 *
 * @module apps/web/src/features/buyer-emails/lib
 */
import type { DatedTimelineEvent } from '../../orders';
import type { BuyerEmailDelivery } from '../api/buyer-emails.types';
import { BUYER_EMAILS_COPY, templateLabel } from './buyer-emails.copy';

const COPY = BUYER_EMAILS_COPY.order;

export function mapBuyerEmailsToEvents(
  entries: readonly BuyerEmailDelivery[],
): DatedTimelineEvent[] {
  return entries.map((entry): DatedTimelineEvent => {
    const label = templateLabel(entry.templateKey);
    if (entry.outcome === 'sent') {
      return {
        id: `buyer-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: `"${label}" email sent to buyer`,
        tone: 'success',
      };
    }
    if (entry.outcome === 'bounced') {
      return {
        id: `buyer-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: `"${label}" email bounced`,
        description: COPY.bouncedDetail,
        tone: 'error',
      };
    }
    if (entry.outcome === 'pending') {
      return {
        id: `buyer-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: `"${label}" email being sent`,
        description: COPY.pendingDetail,
        tone: 'default',
      };
    }
    return {
      id: `buyer-email-${entry.id}`,
      timestamp: entry.createdAt,
      title: `"${label}" email not sent`,
      description: entry.suppressionMessage ?? COPY.suppressedFallback,
      tone: 'default',
    };
  });
}
