import type { PublishProductCommand } from '@openlinker/core/listings';

import {
  buildPriceFields,
  buildVariantCoreFields,
  groupHandle,
  planImages,
  resolvePublishPriceBasis,
  taxableOf,
  unsupportedFieldWarnings,
} from '../shopify-product-publish.mapper';

function cmd(overrides: Partial<PublishProductCommand> = {}): PublishProductCommand {
  return {
    internalVariantId: 'v1',
    connectionId: 'c1',
    destinationCategoryIds: [],
    price: { amount: 123, currency: 'PLN' },
    stock: 5,
    status: 'published',
    content: { title: 'Koszulka Łódź' },
    ...overrides,
  } as PublishProductCommand;
}

describe('resolvePublishPriceBasis', () => {
  it('should keep gross prices on a shop that enters prices with tax', () => {
    expect(resolvePublishPriceBasis(true, undefined)).toEqual({ ok: true, divisor: 1, exempt: false });
  });

  it('should divide by the catalogue rate on a shop that enters prices without tax', () => {
    expect(resolvePublishPriceBasis(false, '23')).toEqual({ ok: true, divisor: 1.23, exempt: false });
  });

  it('should publish an exemption code unchanged and mark it exempt', () => {
    expect(resolvePublishPriceBasis(false, 'zw')).toEqual({ ok: true, divisor: 1, exempt: true });
    expect(resolvePublishPriceBasis(false, '0')).toEqual({ ok: true, divisor: 1, exempt: true });
  });

  it('should refuse a tax-exclusive shop when the catalogue holds no rate', () => {
    expect(resolvePublishPriceBasis(false, undefined)).toMatchObject({ ok: false });
    expect(resolvePublishPriceBasis(false, ' ')).toMatchObject({ ok: false });
  });
});

describe('buildPriceFields', () => {
  it('should send the gross price as is with no divisor', () => {
    expect(buildPriceFields(cmd()).fields).toEqual({ price: '123.00', compareAtPrice: null });
  });

  it('should send the net price rounded to the cent on a tax-exclusive shop', () => {
    expect(buildPriceFields(cmd(), 1.23).fields).toEqual({ price: '100.00', compareAtPrice: null });
  });

  it('should send a sale as price with the regular price as compare-at, both converted', () => {
    const sale = cmd({ commerce: { salePrice: { amount: 61.5, currency: 'PLN' } } } as Partial<PublishProductCommand>);

    expect(buildPriceFields(sale, 1.23).fields).toEqual({ price: '50.00', compareAtPrice: '100.00' });
  });

  it('should leave out a scheduled sale with a warning', () => {
    const scheduled = cmd({
      commerce: { salePrice: { amount: 99, currency: 'PLN' }, saleStartsAt: '2026-12-01' },
    } as Partial<PublishProductCommand>);

    const result = buildPriceFields(scheduled);

    expect(result.fields).toEqual({ price: '123.00', compareAtPrice: null });
    expect(result.warnings).toHaveLength(1);
  });
});

describe('taxableOf', () => {
  it('should let an explicit tax status win over an exempt rate', () => {
    expect(taxableOf(cmd({ commerce: { taxStatus: 'taxable' } } as Partial<PublishProductCommand>), true)).toBe(true);
  });

  it('should mark an exempt variant not taxable and leave others unset', () => {
    expect(taxableOf(cmd(), true)).toBe(false);
    expect(taxableOf(cmd(), false)).toBeUndefined();
  });

  it('should carry the exemption into the variant fields', () => {
    expect(buildVariantCoreFields(cmd(), { price: '1.00', compareAtPrice: null }, true)).toMatchObject({
      taxable: false,
    });
  });
});

describe('planImages', () => {
  it('should send public images and warn about hosts Shopify cannot reach', () => {
    const plan = planImages(
      cmd({
        content: {
          title: 'x',
          imageUrls: [
            'https://cdn.example.com/a.jpg',
            'https://cdn.example.com/a.jpg',
            'http://prestashop/img/1.jpg',
            'http://192.168.1.5/img.jpg',
            'not a url',
          ],
        },
      } as Partial<PublishProductCommand>),
    );

    expect(plan.urls).toEqual(['https://cdn.example.com/a.jpg']);
    expect(plan.warnings).toHaveLength(3);
  });
});

describe('groupHandle', () => {
  it('should give every sibling of a group the same ASCII handle', () => {
    const handle = groupHandle(cmd(), 'ol_product_1');

    expect(handle).toBe(groupHandle(cmd({ internalVariantId: 'v2' }), 'ol_product_1'));
    expect(handle).toMatch(/^koszulka-lodz-ol[0-9a-f]{8}$/);
    expect(handle).not.toBe(groupHandle(cmd(), 'ol_product_2'));
  });
});

describe('unsupportedFieldWarnings', () => {
  it('should name every field Shopify is not given', () => {
    const warnings = unsupportedFieldWarnings(
      cmd({
        content: { title: 'x', shortDescription: 'short' },
        commerce: { dimensions: { length: 1 }, taxClass: 'reduced' },
      } as Partial<PublishProductCommand>),
    );

    expect(warnings).toHaveLength(3);
  });
});
