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
import { BUYER_NOTE_COPY as COPY } from './buyer-note.copy';
import { describeNoteActor } from './buyer-note-presentation';

export function mapBuyerNoteAcknowledgementsToEvents(
  acknowledgements: readonly BuyerNoteAcknowledgement[] | null | undefined,
  currentUserId: string | null,
): DatedTimelineEvent[] {
  return (acknowledgements ?? [])
    .filter((ack) => ack.acknowledgedAt.length > 0)
    .map(
      (ack): DatedTimelineEvent => ({
        id: `buyer-note-ack:${ack.workId}`,
        timestamp: ack.acknowledgedAt,
        title: COPY.timelineTitle,
        by: COPY.timelineBy,
        description: COPY.timelineDescription(
          describeNoteActor(ack.acknowledgedByUserId, currentUserId),
        ),
        tone: 'success',
      }),
    );
}
