/**
 * Buyer note -> Activity timeline mapper unit tests (#3539).
 */
import { describe, expect, it } from 'vitest';

import {
  mapBuyerNoteAcknowledgementsToEvents,
  mapBuyerNoteChangeToEvents,
} from './buyer-note-timeline-events';

const ACK = { workId: 'w1', acknowledgedAt: '2026-09-25T14:31:00.000Z', acknowledgedByUserId: 'u7' };

describe('mapBuyerNoteAcknowledgementsToEvents (#3539)', () => {
  it('should title each acknowledgement "Buyer note read at the bench" at its own instant', () => {
    const [event] = mapBuyerNoteAcknowledgementsToEvents([ACK], null);

    expect(event.title).toBe('Buyer note read at the bench');
    expect(event.timestamp).toBe(ACK.acknowledgedAt);
    expect(event.tone).toBe('success');
    expect(event.description).toBe('Read by another user.');
  });

  it('should say "you" when the signed-in user acknowledged it', () => {
    const [event] = mapBuyerNoteAcknowledgementsToEvents([ACK], 'u7');
    expect(event.description).toBe('Read by you.');
  });

  it('should keep one entry per parcel when a split order was acknowledged twice', () => {
    const events = mapBuyerNoteAcknowledgementsToEvents(
      [ACK, { ...ACK, workId: 'w2', acknowledgedByUserId: null }],
      null,
    );
    expect(events.map((e) => e.id)).toEqual(['buyer-note-ack:w1', 'buyer-note-ack:w2']);
    expect(events[1].description).toBe('Read by a packer.');
  });

  it('should return nothing when there are no acknowledgements', () => {
    expect(mapBuyerNoteAcknowledgementsToEvents(undefined, null)).toEqual([]);
    expect(mapBuyerNoteAcknowledgementsToEvents([], null)).toEqual([]);
  });
});

describe('mapBuyerNoteChangeToEvents (N-22)', () => {
  it('should say the note changed after it was read at the bench', () => {
    const [event] = mapBuyerNoteChangeToEvents('2026-09-26T08:00:00.000Z', [ACK]);

    expect(event.title).toBe('Buyer note changed after it was read at the bench');
    expect(event.timestamp).toBe('2026-09-26T08:00:00.000Z');
    expect(event.tone).toBe('warning');
  });

  it('should say nothing when the change came before any bench read', () => {
    expect(mapBuyerNoteChangeToEvents('2026-09-25T10:00:00.000Z', [ACK])).toEqual([]);
  });

  it('should say nothing when the note never changed or nobody read it', () => {
    expect(mapBuyerNoteChangeToEvents(null, [ACK])).toEqual([]);
    expect(mapBuyerNoteChangeToEvents(undefined, [ACK])).toEqual([]);
    expect(mapBuyerNoteChangeToEvents('2026-09-26T08:00:00.000Z', [])).toEqual([]);
    expect(mapBuyerNoteChangeToEvents('2026-09-26T08:00:00.000Z', null)).toEqual([]);
  });
});
