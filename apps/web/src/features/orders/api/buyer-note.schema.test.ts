/**
 * `readBuyerNote` unit tests (#3539): the three wire states stay three.
 */
import { describe, expect, it } from 'vitest';

import { readBuyerNote } from './buyer-note.schema';

describe('readBuyerNote (#3539)', () => {
  it('should read a string as the note, with its read marker', () => {
    expect(
      readBuyerNote({
        hasBuyerNote: true,
        buyerNote: 'Bez paragonu',
        buyerNoteReadAt: '2026-09-25T10:00:00.000Z',
        buyerNoteReadByUserId: 'u1',
      }),
    ).toEqual({
      kind: 'text',
      text: 'Bez paragonu',
      readAt: '2026-09-25T10:00:00.000Z',
      readByUserId: 'u1',
      acknowledgements: [],
    });
  });

  it('should read null as asserted-none and an absent key as unknown', () => {
    expect(readBuyerNote({ hasBuyerNote: false, buyerNote: null })).toEqual({ kind: 'none' });
    expect(readBuyerNote({ hasBuyerNote: false })).toEqual({ kind: 'unknown' });
  });

  it('should read a whitespace-only string as no note', () => {
    expect(readBuyerNote({ hasBuyerNote: true, buyerNote: '  \n ' })).toEqual({ kind: 'none' });
  });

  it('should read a flagged order with no text as a note whose text is not stored', () => {
    expect(readBuyerNote({ hasBuyerNote: true })).toEqual({ kind: 'text-not-stored' });
  });

  it('should default missing read fields to null and carry acknowledgements', () => {
    const view = readBuyerNote({
      buyerNote: 'x',
      buyerNoteAcknowledgements: [{ workId: 'w', acknowledgedAt: 't', acknowledgedByUserId: null }],
    });
    expect(view).toMatchObject({
      kind: 'text',
      readAt: null,
      readByUserId: null,
      acknowledgements: [{ workId: 'w', acknowledgedAt: 't', acknowledgedByUserId: null }],
    });
  });
});
