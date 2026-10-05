/**
 * Change-size wire parsing (#3655, backend #3654)
 *
 * The void state is the load-bearing member: only an explicit `confirmed`
 * may read as confirmed, because a void claimed on a missing value is the
 * direction a packer acts wrongly on.
 */
import { describe, expect, it } from 'vitest';

import { parseBenchLabelReplaceResult, readReplaceRefusalReason } from './bench-parcel.schema';

describe('parseBenchLabelReplaceResult', () => {
  it('should read a replaced body with its kept size and a confirmed void', () => {
    expect(
      parseBenchLabelReplaceResult({
        outcome: 'replaced',
        cancelledShipmentId: 'a',
        newShipmentId: 'b',
        cancelledAfterDispatch: false,
        voidState: 'confirmed',
        keptTemplate: 'small',
      })
    ).toEqual({ outcome: 'replaced', reason: null, voidState: 'confirmed', keptTemplate: 'small' });
  });

  it.each(['confirmed', 'in-doubt'] as const)(
    'should carry voidState %s on cancelled-not-replaced',
    (voidState) => {
      expect(
        parseBenchLabelReplaceResult({
          outcome: 'cancelled-not-replaced',
          voidState,
          keptTemplate: null,
        })
      ).toMatchObject({ outcome: 'cancelled-not-replaced', voidState });
    }
  );

  it.each([undefined, null, 'something-newer'])(
    'should hold the void as in-doubt when voidState is %p',
    (voidState) => {
      expect(
        parseBenchLabelReplaceResult({ outcome: 'cancelled-not-replaced', voidState })
      ).toMatchObject({ voidState: 'in-doubt', keptTemplate: null });
    }
  );
});

describe('readReplaceRefusalReason', () => {
  it('should read the reason member of a 409 body', () => {
    expect(
      readReplaceRefusalReason({ reason: 'adapter-unresolved', message: 'adapter-unresolved' })
    ).toBe('adapter-unresolved');
  });

  it('should pass an unrecognised reason through so the dialog can fail closed on it', () => {
    expect(readReplaceRefusalReason({ reason: 'from-a-newer-api' })).toBe('from-a-newer-api');
  });

  it.each([null, 'Conflict', { message: 'cannot-cancel' }, { reason: 42 }])(
    'should answer null when the body carries no string reason: %p',
    (details) => {
      expect(readReplaceRefusalReason(details)).toBeNull();
    }
  );
});
