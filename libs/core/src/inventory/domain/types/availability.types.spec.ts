/**
 * Scoped-subtraction rule (#2345, design §4.2)
 *
 * The authority arm has no production caller in Wave 2 — no dispatched
 * `AvailabilityAuthority` adapter exists — so this is where it is asserted.
 * Testing it through `AvailabilityService` would require faking a capability
 * that has not been designed yet; the rule is the unit, so the rule is tested.
 *
 * @module libs/core/src/inventory/domain/types
 */
import {
  applyScopedLedgerSubtraction,
  toPromisableQuantity,
  unknownPromisableQuantity,
} from './availability.types';

const NO_BUFFER = 0;

describe('applyScopedLedgerSubtraction', () => {
  describe('computed scope (OpenLinker computes ATP itself)', () => {
    it('should subtract published holds from the mirrored total', () => {
      const result = applyScopedLedgerSubtraction(
        { answeredBy: 'computed', totalAvailable: 10 },
        3,
        NO_BUFFER
      );

      expect(result.quantity).toBe(7);
    });

    it('should report olHeldNotReflected as null, never zero, because the holds ARE reflected', () => {
      const held = applyScopedLedgerSubtraction(
        { answeredBy: 'computed', totalAvailable: 10 },
        3,
        NO_BUFFER
      );
      const none = applyScopedLedgerSubtraction(
        { answeredBy: 'computed', totalAvailable: 10 },
        0,
        NO_BUFFER
      );

      // `0` would read as "no outstanding holds" — a different and, in the
      // first case, false claim.
      expect(held.olHeldNotReflected).toBeNull();
      expect(none.olHeldNotReflected).toBeNull();
    });

    it('should clamp at zero when holds exceed the total', () => {
      const result = applyScopedLedgerSubtraction(
        { answeredBy: 'computed', totalAvailable: 2 },
        9,
        NO_BUFFER
      );

      expect(result.quantity).toBe(0);
    });

    it('should apply the buffer last', () => {
      const result = applyScopedLedgerSubtraction(
        { answeredBy: 'computed', totalAvailable: 10 },
        3,
        2
      );

      expect(result.quantity).toBe(5);
    });
  });

  describe('authority scope (the answer is taken as-is)', () => {
    it('should be byte-identical with and without OpenLinker ledger rows', () => {
      const withoutHolds = applyScopedLedgerSubtraction(
        { answeredBy: 'authority', availableToPromise: 10 },
        0,
        NO_BUFFER
      );
      const withHolds = applyScopedLedgerSubtraction(
        { answeredBy: 'authority', availableToPromise: 10 },
        4,
        NO_BUFFER
      );

      expect(withoutHolds.quantity).toBe(10);
      expect(withHolds.quantity).toBe(10);
    });

    it('should report the unsubtracted holds as olHeldNotReflected', () => {
      const result = applyScopedLedgerSubtraction(
        { answeredBy: 'authority', availableToPromise: 10 },
        4,
        NO_BUFFER
      );

      expect(result.olHeldNotReflected).toBe(4);
    });

    it('should report zero unreflected holds as 0, which is a meaningful answer here', () => {
      const result = applyScopedLedgerSubtraction(
        { answeredBy: 'authority', availableToPromise: 10 },
        0,
        NO_BUFFER
      );

      expect(result.olHeldNotReflected).toBe(0);
    });

    it('should still apply the buffer, which is a Control on top of any promise', () => {
      const result = applyScopedLedgerSubtraction(
        { answeredBy: 'authority', availableToPromise: 10 },
        4,
        3
      );

      expect(result).toEqual({ quantity: 7, olHeldNotReflected: 4 });
    });
  });
});

describe('toPromisableQuantity (#2345 widening)', () => {
  it('should carry the rule result and the declared provenance', () => {
    const observedAt = new Date('2026-08-20T10:00:00.000Z');
    const now = new Date('2026-08-20T10:00:05.000Z');

    const result = toPromisableQuantity({
      productVariantId: 'v1',
      provenance: 'authority',
      atp: { quantity: 9, olHeldNotReflected: 2 },
      observedAt,
      now,
    });

    expect(result).toEqual({
      productVariantId: 'v1',
      quantity: 9,
      provenance: 'authority',
      observedAt,
      stalenessMs: 5000,
      olHeldNotReflected: 2,
    });
  });
});

describe('unknownPromisableQuantity (#2345 widening)', () => {
  it('should report null olHeldNotReflected — an unknown answer knows nothing about holds either', () => {
    expect(unknownPromisableQuantity('v1')).toEqual({
      productVariantId: 'v1',
      quantity: null,
      provenance: 'unknown',
      observedAt: null,
      stalenessMs: null,
      olHeldNotReflected: null,
    });
  });
});
