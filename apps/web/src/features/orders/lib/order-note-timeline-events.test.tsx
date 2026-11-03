/**
 * Order notes → Activity timeline (#3531): schema + mapper unit tests.
 *
 * Pins: the parser accepts omitted optional fields (`.nullish()`), refuses an
 * entry with no instant, and keeps an unknown `kind`; the mapper titles each
 * known act, quotes the text, attributes the actor, footers a packer-visible
 * note, and renders an unknown kind instead of dropping it.
 */
import { describe, expect, it } from 'vitest';
import {
  OrderNoteTimelineUnreadableError,
  parseOrderNoteTimeline,
} from '../api/order-note-timeline.schema';
import { mapNoteTimelineToEvents } from './order-note-timeline-events';

const ENTRY = {
  noteId: 'note-1',
  kind: 'created',
  occurredAt: '2026-09-25T12:40:00.000Z',
  actorUsername: 'marta.nowak',
  body: 'Invoice inside the parcel.',
  showToPacker: true,
};

describe('parseOrderNoteTimeline (#3531)', () => {
  it('should default omitted optional fields to null when the wire leaves them out', () => {
    const [parsed] = parseOrderNoteTimeline([
      { noteId: 'n', kind: 'deleted', occurredAt: ENTRY.occurredAt, actorUsername: 'a' },
    ]);
    expect(parsed.body).toBeNull();
    expect(parsed.showToPacker).toBeNull();
  });

  it('should throw a named error when an entry has no instant', () => {
    expect(() => parseOrderNoteTimeline([{ ...ENTRY, occurredAt: undefined }])).toThrow(
      OrderNoteTimelineUnreadableError,
    );
  });

  it('should keep a kind this build does not know when parsing', () => {
    const [parsed] = parseOrderNoteTimeline([{ ...ENTRY, kind: 'teleported' }]);
    expect(parsed.kind).toBe('teleported');
  });
});

describe('mapNoteTimelineToEvents (#3531)', () => {
  it('should title, quote and attribute a created note with a packer footer when it is shown to packers', () => {
    const [event] = mapNoteTimelineToEvents([ENTRY]);
    expect(event.title).toBe('Note added');
    expect(event.by).toBe('marta.nowak');
    expect(event.description).toBe('“Invoice inside the parcel.”');
    expect(event.timestamp).toBe(ENTRY.occurredAt);
    expect(event.footer).toBeDefined();
  });

  it('should describe a deletion without its text when the note was deleted', () => {
    const [event] = mapNoteTimelineToEvents([{ ...ENTRY, kind: 'deleted', body: null, showToPacker: null }]);
    expect(event.title).toBe('Note deleted');
    expect(event.description).toBe('The text was removed.');
    expect(event.footer).toBeUndefined();
  });

  it('should title a flag change by its resulting value when the packer flag changed', () => {
    const [shown, hidden] = mapNoteTimelineToEvents([
      { ...ENTRY, kind: 'flag_changed', body: null, showToPacker: true },
      { ...ENTRY, kind: 'flag_changed', body: null, showToPacker: false },
    ]);
    expect(shown.title).toBe('Note shown to packer');
    expect(hidden.title).toBe('Note hidden from packer');
  });

  it('should render an unknown kind rather than drop it', () => {
    const events = mapNoteTimelineToEvents([{ ...ENTRY, kind: 'teleported' }]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Note changed (teleported)');
  });
});
