/**
 * Document-email attempts -> Activity timeline events (#3551)
 *
 * Maps each attempt onto the timeline's `DatedTimelineEvent` shape, the channel
 * notes and returns already use. A failure shows the server's own sentence
 * verbatim; the closed reason code is never rewritten into copy here.
 *
 * @module apps/web/src/features/orders/lib
 */
import { getMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import type { DatedTimelineEvent } from '../components/order-activity-timeline';
import type { OrderDocumentEmailEntry } from '../api/orders.types';

type TimelineCopy = ResolvedCopy<Messages['orders']>['documentEmailTimeline'];

function sentTitle(kind: string, copy: TimelineCopy): string {
  if (kind === 'invoice') return copy.sentInvoice;
  if (kind === 'fiscal-receipt') return copy.sentReceipt;
  return copy.sentDocument;
}

export function mapDocumentEmailsToEvents(
  entries: readonly OrderDocumentEmailEntry[],
): DatedTimelineEvent[] {
  // Read when called, never at module level, so the words follow the language.
  const copy = getMessages('orders').documentEmailTimeline;
  return entries.map((entry): DatedTimelineEvent => {
    if (entry.outcome === 'sent') {
      return {
        id: `document-email-${entry.id}`,
        timestamp: entry.createdAt,
        title: sentTitle(entry.documentKind, copy),
        by: entry.sentVia === 'provider' ? copy.byProvider : copy.byMailer,
        tone: 'success',
      };
    }
    return {
      id: `document-email-${entry.id}`,
      timestamp: entry.createdAt,
      title: copy.failed,
      description: entry.failureMessage ?? undefined,
      tone: 'error',
    };
  });
}
