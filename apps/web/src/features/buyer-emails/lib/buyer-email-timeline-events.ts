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
import { getMessages, interpolate } from '../../../shared/i18n';
import { templateLabel } from './buyer-email-template-label';

export function mapBuyerEmailsToEvents(
  entries: readonly BuyerEmailDelivery[],
): DatedTimelineEvent[] {
  const COPY = getMessages('buyer-emails').order;
  return entries.map((entry): DatedTimelineEvent => {
    const label = templateLabel(entry.templateKey);
    if (entry.outcome === 'sent') {
      return {
        id: `buyer-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: interpolate(COPY.timeline.sent, { label }),
        tone: 'success',
      };
    }
    if (entry.outcome === 'bounced') {
      return {
        id: `buyer-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: interpolate(COPY.timeline.bounced, { label }),
        description: COPY.bouncedDetail,
        tone: 'error',
      };
    }
    if (entry.outcome === 'pending') {
      return {
        id: `buyer-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: interpolate(COPY.timeline.pending, { label }),
        description: COPY.pendingDetail,
        tone: 'default',
      };
    }
    return {
      id: `buyer-email-${entry.id}`,
      timestamp: entry.createdAt,
      title: interpolate(COPY.timeline.suppressed, { label }),
      description: entry.suppressionMessage ?? COPY.suppressedFallback,
      tone: 'default',
    };
  });
}
