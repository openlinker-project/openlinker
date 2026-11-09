/**
 * Order notes → Activity timeline events (#3531, mockup M3 pin 4)
 *
 * Maps the notes' authored acts onto the timeline's `DatedTimelineEvent`
 * shape, the channel the returns half already uses (#2383): the timeline
 * merges them by instant and learns nothing about notes. Every entry maps —
 * an unrecognised kind renders as "Note changed (kind)" rather than being
 * dropped, the `return-timeline-events.ts` rule.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { DatedTimelineEvent } from '../components/order-activity-timeline';
import type { OrderNoteTimelineEntry } from '../api/orders.types';
import { getMessages, interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';

type TimelineCopy = ResolvedCopy<Messages['orders']>['orderNotes']['timeline'];

function resolveTitle(entry: OrderNoteTimelineEntry, COPY: TimelineCopy): string {
  switch (entry.kind) {
    case 'created':
      return COPY.created;
    case 'edited':
      return COPY.edited;
    case 'flag_changed':
      return entry.showToPacker === false ? COPY.hiddenFromPacker : COPY.shownToPacker;
    case 'deleted':
      return COPY.deleted;
    default:
      return interpolate(COPY.unknown, { kind: entry.kind });
  }
}

function resolveDescription(
  entry: OrderNoteTimelineEntry,
  COPY: TimelineCopy,
): string | undefined {
  if (entry.kind === 'deleted') return COPY.deletedDescription;
  return entry.body ? interpolate(COPY.quotedBody, { body: entry.body }) : undefined;
}

export function mapNoteTimelineToEvents(entries: readonly OrderNoteTimelineEntry[]): DatedTimelineEvent[] {
  const COPY = getMessages('orders').orderNotes.timeline;
  return entries.map((entry, index): DatedTimelineEvent => {
    // A flag change IS the packer fact; a footer would only repeat the title.
    const packerFooter =
      entry.kind !== 'flag_changed' && entry.kind !== 'deleted' && entry.showToPacker === true;
    return {
      id: `note:${entry.noteId}:${entry.kind}:${entry.occurredAt}:${index}`,
      timestamp: entry.occurredAt,
      title: resolveTitle(entry, COPY),
      by: entry.actorUsername,
      description: resolveDescription(entry, COPY),
      tone: 'default',
      footer: packerFooter ? <span className="text-muted">{COPY.packerFooter}</span> : undefined,
    };
  });
}
