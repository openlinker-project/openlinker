/**
 * Buyer note acknowledgements -> Activity timeline events (#3539, mockup M2 pin 5)
 *
 * One "Buyer note read at the bench" entry per parcel acknowledgement, through
 * the same `extraEvents` channel the notes and returns already use, so the
 * timeline learns nothing about the bench. An acknowledgement with no usable
 * instant is dropped rather than invented a position - a type-level rule of
 * `DatedTimelineEvent`.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { DatedTimelineEvent } from '../components/order-activity-timeline';
import type { BuyerNoteAcknowledgement } from '../api/orders.types';
import { getMessages, interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { describeNoteActor } from './buyer-note-presentation';

type TimelineCopy = ResolvedCopy<Messages['orders']>['buyerNote']['timeline'];

function describeReader(who: string | null, copy: TimelineCopy): string {
  return who === null ? copy.descriptionUnknown : interpolate(copy.description, { who });
}

export function mapBuyerNoteAcknowledgementsToEvents(
  acknowledgements: readonly BuyerNoteAcknowledgement[] | null | undefined,
  currentUserId: string | null,
): DatedTimelineEvent[] {
  const COPY = getMessages('orders').buyerNote.timeline;
  return (acknowledgements ?? [])
    .filter((ack) => ack.acknowledgedAt.length > 0)
    .map(
      (ack): DatedTimelineEvent => ({
        id: `buyer-note-ack:${ack.workId}`,
        timestamp: ack.acknowledgedAt,
        title: COPY.title,
        by: COPY.by,
        description: describeReader(
          describeNoteActor(ack.acknowledgedByUserId, currentUserId),
          COPY,
        ),
        tone: 'success',
      }),
    );
}

/**
 * N-22: a changed note text resets the office read marker but leaves bench
 * acknowledgements alone, so nothing else tells the operator the text moved
 * under a packer who already read it. One entry, at the instant of the change,
 * and only when some bench acknowledgement is OLDER than it - a change before
 * anybody read the note is not news.
 */
export function mapBuyerNoteChangeToEvents(
  changedAt: string | null | undefined,
  acknowledgements: readonly BuyerNoteAcknowledgement[] | null | undefined,
): DatedTimelineEvent[] {
  if (!changedAt) return [];
  const changed = Date.parse(changedAt);
  if (Number.isNaN(changed)) return [];
  const readEarlier = (acknowledgements ?? []).some((ack) => {
    const read = Date.parse(ack.acknowledgedAt);
    return !Number.isNaN(read) && read < changed;
  });
  if (!readEarlier) return [];
  const COPY = getMessages('orders').buyerNote.timeline;
  return [
    {
      id: 'buyer-note-changed-after-read',
      timestamp: changedAt,
      title: COPY.changedAfterReadTitle,
      by: COPY.changedAfterReadBy,
      description: COPY.changedAfterReadDescription,
      tone: 'warning',
    },
  ];
}
