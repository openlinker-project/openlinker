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

  it('should name the order and the action when the source prices net and reports no gross', () => {
    const refusal = describeNetPricedOrderRefusal(
      { id: 'ol_order_1', totals: { taxTreatment: 'exclusive' }, items: [{}] },
      'invoiced'
    );

    expect(refusal).toBe(
      'Order ol_order_1 cannot be invoiced: its source reports net (tax-exclusive) line prices, ' +
        'and its source reported no gross (tax-inclusive) price for every line. OpenLinker never ' +
        'computes or infers tax to convert a net amount to gross for a fiscal document — only an ' +
        'order carrying a gross (tax-inclusive) figure its own source reported can be invoiced.'
    );
  });

  // #3365. The refusal was written as PERMANENT for a net-priced source. It is
  // not: PrestaShop stores `unit_price_tax_incl` and WooCommerce reports
  // `total + total_tax`, so both can report a gross figure and the guard now
  // reads it. Nothing here converts - core still never multiplies by a rate.
  describe('a net-priced source that reports its own gross figures (#3365)', () => {
    it('should admit an order whose every line carries a source-reported gross price', () => {
      expect(
        describeNetPricedOrderRefusal(
          {
            id: 'ol_order_3',
            totals: { taxTreatment: 'exclusive' },
            items: [{ unitPriceGross: 1843.77 }, { unitPriceGross: 12.3 }],
          },
          'invoiced'
        )
      ).toBeNull();
    });

    it('should REFUSE when only some lines carry one — a part-gross document is the corruption', () => {
      const refusal = describeNetPricedOrderRefusal(
        {
          id: 'ol_order_4',
          totals: { taxTreatment: 'exclusive' },
          items: [{ unitPriceGross: 1843.77 }, {}],
        },
        'invoiced'
      );

      expect(refusal).toContain('no gross (tax-inclusive) price for every line');
    });

    it('should REFUSE when the order charges shipping and no gross shipping was reported', () => {
      const refusal = describeNetPricedOrderRefusal(
        {
          id: 'ol_order_5',
          totals: { taxTreatment: 'exclusive', shipping: 15 },
          items: [{ unitPriceGross: 1843.77 }],
        },
        'invoiced'
      );

      // Named distinctly from the per-line gap: the two have different remedies.
      expect(refusal).toContain('no gross (tax-inclusive) shipping amount');
    });

    it('should admit the same order once gross shipping is reported', () => {
      expect(
        describeNetPricedOrderRefusal(
          {
            id: 'ol_order_5',
            totals: { taxTreatment: 'exclusive', shipping: 15, shippingGross: 18.45 },
            items: [{ unitPriceGross: 1843.77 }],
          },
          'invoiced'
        )
      ).toBeNull();
    });

    it('should not demand gross shipping from an order that charges none', () => {
      expect(
        describeNetPricedOrderRefusal(
          {
            id: 'ol_order_6',
            totals: { taxTreatment: 'exclusive', shipping: 0 },
            items: [{ unitPriceGross: 1843.77 }],
          },
          'invoiced'
        )
      ).toBeNull();
    });

    it('should REFUSE a net-priced order with no lines at all', () => {
      const refusal = describeNetPricedOrderRefusal(
        { id: 'ol_order_7', totals: { taxTreatment: 'exclusive' }, items: [] },
        'invoiced'
      );

      expect(refusal).toContain('no gross (tax-inclusive) price for this order');
    });

    it('should ignore a non-finite gross price rather than trusting it', () => {
      const refusal = describeNetPricedOrderRefusal(
        { id: 'ol_order_8', totals: { taxTreatment: 'exclusive' }, items: [{ unitPriceGross: NaN }] },
        'invoiced'
      );

      expect(refusal).toContain('no gross (tax-inclusive) price for every line');
    });

    it('should still admit a gross-priced source that reports no per-line gross', () => {
      // Allegro/Erli: `price` IS gross, so there is nothing extra to report and
      // the guard must not start demanding it.
      expect(
        describeNetPricedOrderRefusal(
          { id: 'ol_order_9', totals: { taxTreatment: 'inclusive' }, items: [{}] },
          'invoiced'
        )
      ).toBeNull();
    });

    it('should carry the third action through for a destination order mirror', () => {
      const refusal = describeNetPricedOrderRefusal(
        { id: 'ol_order_10', totals: { taxTreatment: 'exclusive' }, items: [{}] },
        'recorded in the destination system'
      );

      expect(refusal).toContain('cannot be recorded in the destination system:');
      expect(refusal).toContain('can be recorded in the destination system.');
    });
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
