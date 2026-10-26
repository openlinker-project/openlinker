/**
 * Buyer note -> Activity timeline mapper unit tests (#3539).
 */
import { describe, expect, it } from 'vitest';

import { mapBuyerNoteAcknowledgementsToEvents } from './buyer-note-timeline-events';

const ACK = { workId: 'w1', acknowledgedAt: '2026-09-25T14:31:00.000Z', acknowledgedByUserId: 'u7' };

describe('mapBuyerNoteAcknowledgementsToEvents (#3539)', () => {
  it('should title each acknowledgement "Buyer note read at the bench" at its own instant', () => {
    const [event] = mapBuyerNoteAcknowledgementsToEvents([ACK], null);

    expect(event.title).toBe('Buyer note read at the bench');
    expect(event.timestamp).toBe(ACK.acknowledgedAt);
    expect(event.tone).toBe('success');
    expect(event.description).toBe('Read by u7.');
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
