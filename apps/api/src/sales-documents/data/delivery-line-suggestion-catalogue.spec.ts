/**
 * Delivery-Line Suggestion Catalogue Specs (#3907)
 *
 * @module apps/api/src/sales-documents/data
 */
import {
  getDeliveryLineSuggestion,
  listDeliveryLineSuggestions,
} from './delivery-line-suggestion-catalogue';

describe('delivery-line-suggestion-catalogue', () => {
  it('should resolve the Polish suggestion case-insensitively when looked up', () => {
    expect(getDeliveryLineSuggestion('pl')?.country).toBe('PL');
    expect(getDeliveryLineSuggestion(' PL ')?.defaultName).toBe('Koszt dostawy');
  });

  it('should return null when the country has no researched suggestion', () => {
    expect(getDeliveryLineSuggestion('DE')).toBeNull();
  });

  it('should list only researched countries when listed', () => {
    expect(listDeliveryLineSuggestions().map((s) => s.country)).toEqual(['PL']);
  });

  it('should carry three sources and the standard disclaimer for Poland when read', () => {
    const pl = getDeliveryLineSuggestion('PL');
    expect(pl?.sources).toHaveLength(3);
    expect(pl?.rateMode).toBe('goods');
    expect(pl?.omitFreeDelivery).toBe(true);
    expect(pl?.disclaimer).toBe(
      'Suggested settings, not legal advice. Check them with your accountant.',
    );
  });
});
