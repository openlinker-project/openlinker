/**
 * Tax-Rate Journal Dedup Tests (#2250)
 *
 * The dedup rule is the whole reason a twenty-minute catalogue sweep can feed
 * this table without it growing by the size of the catalogue per tick.
 *
 * @module libs/core/src/products/domain/types
 */
import { isNewTaxRateObservation } from './tax-rate-journal.types';
import type { TaxRateJournalEntry, TaxRateObservation } from './tax-rate-journal.types';

const OBSERVED_AT = new Date('2026-08-21T10:00:00Z');

function observation(over: Partial<TaxRateObservation> = {}): TaxRateObservation {
  return {
    productId: 'ol_product_a',
    variantId: null,
    connectionId: 'conn-1',
    origin: 'shop',
    taxRate: '23',
    ...over,
  };
}

function entry(over: Partial<TaxRateJournalEntry> = {}): TaxRateJournalEntry {
  return {
    id: 'row-1',
    observedAt: OBSERVED_AT,
    createdAt: OBSERVED_AT,
    ...observation(),
    ...over,
  };
}

describe('isNewTaxRateObservation', () => {
  it('should be new when the journal holds nothing for the pair', () => {
    expect(isNewTaxRateObservation(null, observation())).toBe(true);
  });

  it('should not be new when the value, origin and frozen flag all match', () => {
    // The ordinary case: an unchanged catalogue re-synced every twenty minutes.
    expect(isNewTaxRateObservation(entry(), observation())).toBe(false);
  });

  it('should be new when the rate changed', () => {
    expect(isNewTaxRateObservation(entry(), observation({ taxRate: '8' }))).toBe(true);
  });

  it('should be new when a rate disappeared', () => {
    expect(isNewTaxRateObservation(entry(), observation({ taxRate: null }))).toBe(true);
  });

  it('should be new when the same value now comes from a different origin', () => {
    // The shop and the channel agreeing is not the same fact as only the shop
    // having been asked.
    expect(isNewTaxRateObservation(entry(), observation({ origin: 'channel' }))).toBe(true);
  });

  it('should be new when the channel froze a field whose value did not change', () => {
    // A seller freezing the field is a real change in what the value MEANS -
    // it is now something a person set. Losing it would leave the disagreement
    // surface unable to say so.
    expect(isNewTaxRateObservation(entry({ frozen: false }), observation({ frozen: true }))).toBe(
      true
    );
  });

  it('should treat an absent frozen flag as not frozen', () => {
    expect(isNewTaxRateObservation(entry({ frozen: false }), observation())).toBe(false);
  });
});
