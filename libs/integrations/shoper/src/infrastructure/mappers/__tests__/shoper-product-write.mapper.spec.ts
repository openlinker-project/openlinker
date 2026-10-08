import type { PublishProductCommand } from '@openlinker/core/listings';

import { buildShoperProductBody, planShoperImageUploads } from '../shoper-product-write.mapper';

const CTX = { language: 'pl_PL', currency: 'PLN', warehousesEnabled: false };

function command(overrides: Partial<PublishProductCommand> = {}): PublishProductCommand {
  return {
    internalVariantId: 'ol_variant_1',
    connectionId: 'conn-1',
    destinationCategoryIds: ['38'],
    price: { amount: 10, currency: 'PLN' },
    stock: 1,
    status: 'published',
    ...overrides,
  };
}

describe('buildShoperProductBody', () => {
  it('should map the short description and the seo fields onto the translation', () => {
    const { body } = buildShoperProductBody(
      command({
        content: {
          title: 'Misa',
          shortDescription: 'krotki',
          seo: { title: 'T', description: 'D', slug: 'misa' },
        },
      }),
      CTX,
    );

    expect(body.translations.pl_PL).toMatchObject({
      name: 'Misa',
      short_description: 'krotki',
      seo_title: 'T',
      seo_description: 'D',
      seo_url: 'misa',
    });
  });

  it('should not warn about the currency, which the adapter refuses instead', () => {
    const { warnings } = buildShoperProductBody(command({ price: { amount: 1, currency: 'EUR' } }), CTX);

    expect(warnings).toEqual([]);
  });
});

describe('planShoperImageUploads', () => {
  it('should keep absolute http(s) urls in order and report the rest', () => {
    const plan = planShoperImageUploads(
      command({ content: { imageUrls: ['https://x/a.png', '/b.png', 'https://x/a.png'] } }),
    );

    expect(plan.urls).toEqual(['https://x/a.png']);
    expect(plan.skipped).toHaveLength(1);
  });
});
