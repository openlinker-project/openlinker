import { suggestReturnLineOrderLine } from './return-order-line-resolution.domain-service';

const lines = [
  { id: 'l1', quantity: 1, price: 100, sku: 'A' },
  { id: 'l2', quantity: 1, price: 80, sku: 'A' },
  { id: 'l3', quantity: 1, price: 5, sku: 'B' },
];

describe('suggestReturnLineOrderLine', () => {
  it('should suggest the candidate whose price equals the reported price', () => {
    const result = suggestReturnLineOrderLine({ sku: 'A', offerId: null, unitPrice: 80 }, lines);
    expect(result).toMatchObject({ suggestedOrderLineId: 'l2', basis: 'price-match' });
    expect(result.candidates.map((c) => c.id)).toEqual(['l1', 'l2']);
  });

  it('should fall back to the highest price and label it as a guess', () => {
    const result = suggestReturnLineOrderLine({ sku: 'A', offerId: null, unitPrice: null }, lines);
    expect(result).toMatchObject({ suggestedOrderLineId: 'l1', basis: 'highest-price' });
  });

  it('should suggest nothing when the identity is not duplicated', () => {
    const result = suggestReturnLineOrderLine({ sku: 'B', offerId: null, unitPrice: 5 }, lines);
    expect(result.suggestedOrderLineId).toBeNull();
  });

  it('should use the offer id when the line carries no sku', () => {
    const result = suggestReturnLineOrderLine({ sku: null, offerId: 'A', unitPrice: 100 }, lines);
    expect(result.suggestedOrderLineId).toBe('l1');
  });
});
