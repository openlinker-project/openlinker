/**
 * Document-email attempts -> Activity timeline events (#3551)
 *
 * Maps each attempt onto the timeline's `DatedTimelineEvent` shape, the channel
 * notes and returns already use. A failure shows the server's own sentence
 * verbatim; the closed reason code is never rewritten into copy here.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { DatedTimelineEvent } from '../components/order-activity-timeline';
import type { OrderDocumentEmailEntry } from '../api/orders.types';

function documentNoun(kind: string): string {
  if (kind === 'invoice') return 'Invoice';
  if (kind === 'fiscal-receipt') return 'Receipt';
  return 'Document';
}

export function mapDocumentEmailsToEvents(
  entries: readonly OrderDocumentEmailEntry[],
): DatedTimelineEvent[] {
  return entries.map((entry): DatedTimelineEvent => {
    const noun = documentNoun(entry.documentKind);
    if (entry.outcome === 'sent') {
      return {
        id: `document-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: `${noun} emailed to buyer`,
        by: entry.sentVia === 'provider' ? 'invoicing provider' : 'OpenLinker mailer',
        tone: 'success',
      };
    }
    return {
      id: `document-email-${entry.id}`,
      timestamp: entry.createdAt,
      title: 'Email to buyer failed',
      description: entry.failureMessage ?? undefined,
      tone: 'error',
    };
  });
}
