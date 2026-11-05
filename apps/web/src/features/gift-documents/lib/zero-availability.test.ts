/**
 * Zero-line availability tests (#3941)
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import { describe, expect, it } from 'vitest';
import { zeroAvailability } from './zero-availability';

describe('zeroAvailability', () => {
  it('should leave the choice open when the providers are unknown', () => {
    expect(zeroAvailability(undefined).available).toBe(true);
  });

  it('should offer it when an invoice provider accepts a zero line', () => {
    expect(
      zeroAvailability([
        { connectionId: 'a', name: 'KSeF', platformType: 'ksef', kind: 'invoice', acceptsZeroValueLine: true },
      ]).available,
    ).toBe(true);
  });

  it('should refuse it and name the single refusing provider', () => {
    expect(
      zeroAvailability([
        { connectionId: 'c', name: 'eparagony.pl', platformType: 'eparagony', kind: 'fiscal-receipt', acceptsZeroValueLine: false },
      ]),
    ).toEqual({ available: false, refusingProviderName: 'eparagony.pl' });
  });

  it('should not offer it when a provider declares nothing, and name none when several refuse', () => {
    expect(
      zeroAvailability([
        { connectionId: 'a', name: 'X', platformType: 'x', kind: 'invoice', acceptsZeroValueLine: null },
        { connectionId: 'b', name: 'Y', platformType: 'y', kind: 'invoice', acceptsZeroValueLine: false },
      ]),
    ).toEqual({ available: false, refusingProviderName: null });
  });
});
