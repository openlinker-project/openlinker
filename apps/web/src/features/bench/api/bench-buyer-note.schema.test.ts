/**
 * Bench wire parsing: the buyer note fields (#3539, backend #3538)
 *
 * Every new field is defaulted rather than required, so an API that predates the
 * buyer note still parses and the packer holding the box is never told it does
 * not exist.
 */
import { describe, expect, it } from 'vitest';

import { parseBenchBuyerNoteAcknowledgementResult, parseBenchParcel } from './bench-parcel.schema';

const BASE_PARCEL = {
  workId: 'w-1',
  version: 1,
  orderReference: 'OL-1',
  parcelIndex: 1,
  parcelTotal: 2,
  lines: [],
};

describe('bench buyer note parsing (#3539)', () => {
  it('should default every buyer-note field when the API predates it', () => {
    const parcel = parseBenchParcel(BASE_PARCEL);

    expect(parcel.buyerNote).toBeNull();
    expect(parcel.buyerNoteAcknowledgedAt).toBeNull();
    expect(parcel.buyerNoteAcknowledgedByUserId).toBeNull();
    expect(parcel.otherParcelBuyerNoteAcknowledgements).toEqual([]);
  });

  it('should carry the note, this parcel acknowledgement and the other parcels', () => {
    const parcel = parseBenchParcel({
      ...BASE_PARCEL,
      buyerNote: 'Bez paragonu',
      buyerNoteAcknowledgedAt: '2026-09-25T14:31:00.000Z',
      buyerNoteAcknowledgedByUserId: 'u1',
      otherParcelBuyerNoteAcknowledgements: [
        { workId: 'w-0', parcelIndex: 1, acknowledgedAt: '2026-09-25T14:00:00.000Z', acknowledgedByUserId: null },
      ],
    });

    expect(parcel.buyerNote).toBe('Bez paragonu');
    expect(parcel.buyerNoteAcknowledgedByUserId).toBe('u1');
    expect(parcel.otherParcelBuyerNoteAcknowledgements).toHaveLength(1);
    expect(parcel.otherParcelBuyerNoteAcknowledgements[0].acknowledgedByUserId).toBeNull();
  });

  it('should read an acknowledge result with its outcome, reason and parcel', () => {
    const result = parseBenchBuyerNoteAcknowledgementResult({
      outcome: 'refused',
      reason: 'no-buyer-note',
      parcel: BASE_PARCEL,
    });

    expect(result.outcome).toBe('refused');
    expect(result.reason).toBe('no-buyer-note');
    expect(result.parcel.workId).toBe('w-1');
  });
});
