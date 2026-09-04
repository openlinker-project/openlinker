/**
 * Gross-price Eligibility Tests (#2835)
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { describeNetPricedOrderRefusal } from './gross-price-eligibility.types';

describe('describeNetPricedOrderRefusal', () => {
  it('should return null when taxTreatment is "inclusive" (gross line prices)', () => {
    expect(
      describeNetPricedOrderRefusal(
        { id: 'ol_order_1', totals: { taxTreatment: 'inclusive' } },
        'invoiced'
      )
    ).toBeNull();
  });

  it('should return null when taxTreatment is absent (the documented gross assumption)', () => {
    expect(describeNetPricedOrderRefusal({ id: 'ol_order_1', totals: {} }, 'invoiced')).toBeNull();
  });

  it('should name the order and the action when taxTreatment is "exclusive"', () => {
    const refusal = describeNetPricedOrderRefusal(
      { id: 'ol_order_1', totals: { taxTreatment: 'exclusive' } },
      'invoiced'
    );

    expect(refusal).toBe(
      'Order ol_order_1 cannot be invoiced: its source reports net (tax-exclusive) line prices, ' +
        'and OpenLinker never computes or infers tax to convert them to gross for a fiscal document — ' +
        'only a source that reports gross (tax-inclusive) line prices can be invoiced.'
    );
  });

  it('should thread a different action through both clauses (fiscalization)', () => {
    const refusal = describeNetPricedOrderRefusal(
      { id: 'ol_order_2', totals: { taxTreatment: 'exclusive' } },
      'fiscally registered'
    );

    expect(refusal).toContain('ol_order_2 cannot be fiscally registered:');
    expect(refusal).toContain('can be fiscally registered.');
  });
});
