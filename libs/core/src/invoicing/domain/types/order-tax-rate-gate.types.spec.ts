/**
 * Order Tax-Rate Gate Tests (#2248, ADR-052 § 6)
 *
 * @module libs/core/src/invoicing/domain/types
 */
import { describeMissingTaxRate, findMissingTaxRate } from './order-tax-rate-gate.types';

describe('findMissingTaxRate', () => {
  it('should report nothing when every line carries a rate', () => {
    expect(
      findMissingTaxRate([
        { productId: 'ol_product_a', taxRate: '23' },
        { productId: 'ol_product_b', taxRate: 'zw' },
      ])
    ).toBeNull();
  });

  it('should treat a zero rate as an answer, not a gap', () => {
    // Export, intra-EU and exempt goods are legitimately zero. Blocking here
    // would hold documents for a correctly configured catalogue.
    expect(findMissingTaxRate([{ productId: 'ol_product_a', taxRate: '0' }])).toBeNull();
  });

  it('should report a line whose rate is absent', () => {
    expect(
      findMissingTaxRate([
        { productId: 'ol_product_a', taxRate: '23' },
        { productId: 'ol_product_b' },
      ])
    ).toEqual({ lineCount: 1, totalLines: 2, firstLineRef: 'ol_product_b' });
  });

  it('should report a line whose rate is blank', () => {
    // The empty string is what the mapper emitted before this epic.
    expect(findMissingTaxRate([{ productId: 'ol_product_a', taxRate: '  ' }])?.lineCount).toBe(1);
  });

  it('should report nothing for an order with no lines', () => {
    // There is nothing to state a rate for, and a tax complaint would displace
    // whatever the real problem with an empty order is.
    expect(findMissingTaxRate([])).toBeNull();
  });

  it('should name the first offending product so the remedy points at one thing', () => {
    const finding = findMissingTaxRate([
      { productId: 'ol_product_a' },
      { productId: 'ol_product_b' },
    ]);
    expect(finding?.firstLineRef).toBe('ol_product_a');
    expect(finding?.lineCount).toBe(2);
  });
});

describe('describeMissingTaxRate', () => {
  it('should state the scope and name the first product', () => {
    expect(
      describeMissingTaxRate({ lineCount: 1, totalLines: 3, firstLineRef: 'ol_product_a' })
    ).toBe('1 of 3 lines carry no tax rate; first: ol_product_a');
  });

  it('should omit the product clause when there is no id to name', () => {
    expect(describeMissingTaxRate({ lineCount: 2, totalLines: 2, firstLineRef: null })).toBe(
      '2 of 2 lines carry no tax rate'
    );
  });
});
