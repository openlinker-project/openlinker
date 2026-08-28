import { compareOrderCursors } from './order-cursor.types';

describe('compareOrderCursors', () => {
  describe('decimal counter cursors', () => {
    it('should report a regression when a numeric cursor moves backwards', () => {
      expect(compareOrderCursors('200', '100')).toBe('regressed');
    });

    it('should not report a regression when a numeric cursor moves forward', () => {
      expect(compareOrderCursors('100', '200')).toBe('not-regressed');
    });

    it('should not report a regression when a shorter numeric cursor is larger lexicographically', () => {
      expect(compareOrderCursors('99', '100')).toBe('not-regressed');
    });

    it('should compare exactly beyond float precision', () => {
      // Both parse to the same double; only an exact integer compare gets this right.
      expect(compareOrderCursors('9007199254740993', '9007199254740992')).toBe('regressed');
      expect(compareOrderCursors('9007199254740992', '9007199254740993')).toBe('not-regressed');
    });
  });

  describe('ISO instant cursors', () => {
    it('should report a regression when a WooCommerce-style GMT cursor moves backwards', () => {
      expect(compareOrderCursors('2026-01-15T10:30:00Z', '2026-01-15T09:30:00Z')).toBe('regressed');
    });

    it('should not report a regression when it moves forward', () => {
      expect(compareOrderCursors('2026-01-15T09:30:00Z', '2026-01-15T10:30:00Z')).toBe(
        'not-regressed'
      );
    });

    it('should compare across offsets rather than lexicographically', () => {
      // 09:00+02:00 is 07:00Z, so this is a forward move despite sorting backwards as text.
      expect(compareOrderCursors('2026-01-15T08:00:00Z', '2026-01-15T09:00:00+00:30')).toBe(
        'not-regressed'
      );
      expect(compareOrderCursors('2026-01-15T08:00:00Z', '2026-01-15T09:00:00+02:00')).toBe(
        'regressed'
      );
    });

    it('should not order a local wall clock carrying no zone against a zoned instant', () => {
      expect(compareOrderCursors('2026-01-15T10:30:00', '2026-01-15T09:30:00Z')).toBe(
        'unrecognised'
      );
    });
  });

  describe('naive wall-clock cursors', () => {
    it('should report a regression when a PrestaShop-style watermark moves backwards', () => {
      expect(compareOrderCursors('2026-01-15 10:30:00', '2026-01-15 09:30:00')).toBe('regressed');
    });

    it('should not report a regression when it moves forward', () => {
      expect(compareOrderCursors('2026-01-15 09:30:00', '2026-01-15 10:30:00')).toBe(
        'not-regressed'
      );
    });

    it('should not order a wall clock against an ISO instant', () => {
      expect(compareOrderCursors('2026-01-15 09:30:00', '2026-01-15T10:30:00Z')).toBe(
        'unrecognised'
      );
    });
  });

  describe('unrecognised cursors', () => {
    it('should not report a regression for base64 cursors', () => {
      expect(compareOrderCursors('ZXZlbnQtMjAw', 'ZXZlbnQtMTAw')).toBe('unrecognised');
      expect(compareOrderCursors('ZXZlbnQtMTAw', 'ZXZlbnQtMjAw')).toBe('unrecognised');
    });

    it('should not report a regression for opaque event ids', () => {
      expect(
        compareOrderCursors(
          'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
          '0a2b3c4d-5e6f-7081-9203-a4b5c6d7e8f9'
        )
      ).toBe('unrecognised');
    });

    it('should not report a regression for hex object ids', () => {
      expect(compareOrderCursors('68a1b2c3d4e5f60718293a4b', '5f1a2b3c4d5e6f0718293a4b')).toBe(
        'unrecognised'
      );
    });

    it('should order a wall clock with a numeric tiebreaker (#2605)', () => {
      expect(compareOrderCursors('2026-01-15 09:30:00|4', '2026-01-15 09:30:00|5')).toBe(
        'not-regressed'
      );
      expect(compareOrderCursors('2026-01-15 09:30:00|5', '2026-01-15 09:30:00|4')).toBe(
        'regressed'
      );
      expect(compareOrderCursors('2026-01-15 09:30:00|9', '2026-01-15 09:30:01|1')).toBe(
        'not-regressed'
      );
      expect(compareOrderCursors('2026-01-15 09:30:01|1', '2026-01-15 09:30:00|9')).toBe(
        'regressed'
      );
    });

    it('should compare a long tiebreaker without float precision loss', () => {
      expect(
        compareOrderCursors('2026-01-15 09:30:00|9007199254740993', '2026-01-15 09:30:00|9007199254740992')
      ).toBe('regressed');
    });

    it('should refuse a keyset paired with a bare wall clock rather than coercing it', () => {
      expect(compareOrderCursors('2026-01-15 09:30:00', '2026-01-15 09:30:00|1')).toBe(
        'unrecognised'
      );
    });

    it('should not report a regression for a blank cursor on either side', () => {
      expect(compareOrderCursors('', '100')).toBe('unrecognised');
      expect(compareOrderCursors('200', '   ')).toBe('unrecognised');
    });
  });

  it('should treat an unchanged cursor as no regression whatever its shape', () => {
    expect(compareOrderCursors('ZXZlbnQtMTAw', 'ZXZlbnQtMTAw')).toBe('not-regressed');
    expect(compareOrderCursors('2026-01-15 09:30:00', '2026-01-15 09:30:00')).toBe('not-regressed');
  });
});
