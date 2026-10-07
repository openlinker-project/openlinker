import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  type PublishProductCommand,
} from '@openlinker/core/listings';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT } from '../../../__tests__/shoper-test-data';
import type { ShoperProductWriteBody } from '../../../../domain/types/shoper-product-write.types';
import { ShoperProductPublisherAdapter } from '../shoper-product-publisher.adapter';

function command(overrides: Partial<PublishProductCommand> = {}): PublishProductCommand {
  return {
    internalVariantId: 'ol_variant_1',
    connectionId: 'conn-1',
    destinationCategoryIds: ['38'],
    price: { amount: 12.34, currency: 'PLN' },
    stock: 5,
    status: 'published',
    sku: 'SKU-1',
    barcode: '4006381333931',
    weight: 0.5,
    content: { title: 'Misa', description: '<p>opis</p>' },
    ...overrides,
  };
}

interface Harness {
  adapter: ShoperProductPublisherAdapter;
  post: jest.Mock;
  put: jest.Mock;
}

/** The body of the first write a mock received. */
function bodyOf(write: jest.Mock): ShoperProductWriteBody {
  return (write.mock.calls[0] as [string, ShoperProductWriteBody])[1];
}

function setup(context: Partial<typeof MAP_CONTEXT> = {}): Harness {
  const post = jest.fn().mockResolvedValue({ status: 200, data: 130 });
  const put = jest.fn().mockResolvedValue({ status: 200, data: 1 });
  const adapter = new ShoperProductPublisherAdapter(
    { post, put } as unknown as ShoperHttpClient,
    { get: () => Promise.resolve({ ...MAP_CONTEXT, ...context }) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', adapterKey: 'shoper.restapi.v1' } as unknown as Connection,
  );
  return { adapter, post, put };
}

describe('ShoperProductPublisherAdapter', () => {
  describe('create', () => {
    it('should POST the product and return the id Shoper answers', async () => {
      const { adapter, post, put } = setup();

      const result = await adapter.publishProduct(command());

      expect(result).toEqual({ externalProductId: '130', status: 'published' });
      expect(put).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith('/products', {
        translations: { pl_PL: { active: 1, name: 'Misa', description: '<p>opis</p>' } },
        category_id: 38,
        categories: [38],
        stock: { price: 12.34, stock: 5, code: 'SKU-1', ean: '4006381333931', weight: 0.5 },
      });
    });

    it('should place the product in every destination category, the first being the main one', async () => {
      const { adapter, post } = setup();

      await adapter.publishProduct(command({ destinationCategoryIds: ['38', '45'] }));

      expect(bodyOf(post)).toMatchObject({ category_id: 38, categories: [38, 45] });
    });

    it('should send a draft as active 0', async () => {
      const { adapter, post } = setup();

      const result = await adapter.publishProduct(command({ status: 'draft' }));

      expect(result.status).toBe('draft');
      expect(bodyOf(post).translations.pl_PL?.active).toBe(0);
    });

    it('should address the texts by the shop default language', async () => {
      const { adapter, post } = setup({ language: 'en_US' });

      await adapter.publishProduct(command());

      expect(Object.keys(bodyOf(post).translations)).toEqual(['en_US']);
    });
  });

  describe('update', () => {
    it('should PUT the already mapped product and never POST a second one', async () => {
      const { adapter, post, put } = setup();

      const result = await adapter.publishProduct(command({ externalProductId: '130' }));

      expect(result.externalProductId).toBe('130');
      expect(post).not.toHaveBeenCalled();
      expect(put).toHaveBeenCalledWith('/products/130', expect.objectContaining({ category_id: 38 }));
    });

    it('should leave categories and the title alone when the update carries none', async () => {
      const { adapter, put } = setup();

      await adapter.publishProduct(
        command({ externalProductId: '130', destinationCategoryIds: [], content: undefined }),
      );

      const body = bodyOf(put);
      expect(body.category_id).toBeUndefined();
      expect(body.categories).toBeUndefined();
      expect(body.translations.pl_PL?.name).toBeUndefined();
    });

    it('should report a stale mapping when Shoper says the product is gone', async () => {
      const { adapter, put } = setup();
      put.mockRejectedValue(new ShoperApiError(404, 'invalid_request', 'Resource not found'));

      await expect(adapter.publishProduct(command({ externalProductId: '999' }))).rejects.toBeInstanceOf(
        ProductPublishTargetNotFoundException,
      );
    });
  });

  describe('refusals', () => {
    async function refusal(promise: Promise<unknown>): Promise<ProductPublishRejectedException> {
      const error: unknown = await promise.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProductPublishRejectedException);
      return error as ProductPublishRejectedException;
    }

    it('should refuse a multi-variant product without calling the shop', async () => {
      const { adapter, post, put } = setup();

      const error = await refusal(
        adapter.publishProduct(
          command({ variantGroup: { groupId: 'g', attributes: [], groupAttributeValues: {} } }),
        ),
      );

      expect(error.errors[0]?.code).toBe('shoper_variants_unsupported');
      expect(post).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    });

    it('should refuse a create with no category, because Shoper requires one', async () => {
      const { adapter, post } = setup();

      const error = await refusal(adapter.publishProduct(command({ destinationCategoryIds: [] })));

      expect(error.errors[0]?.code).toBe('shoper_category_required');
      expect(post).not.toHaveBeenCalled();
    });

    it('should refuse a category that is not a Shoper id', async () => {
      const { adapter } = setup();

      const error = await refusal(adapter.publishProduct(command({ destinationCategoryIds: ['abc'] })));

      expect(error.errors[0]?.code).toBe('shoper_category_invalid');
    });

    it('should refuse a create with no title', async () => {
      const { adapter } = setup();

      const error = await refusal(adapter.publishProduct(command({ content: { description: 'x' } })));

      expect(error.errors[0]?.code).toBe('shoper_name_required');
    });

    it("should surface Shoper's own rejection (invalid EAN) as a rejected publish", async () => {
      const { adapter, post } = setup();
      post.mockRejectedValue(
        new ShoperApiError(400, 'invalid_request', "Wartość pola 'ean' jest niepoprawna: Wymagany jest poprawny kod kreskowy"),
      );

      const error = await refusal(adapter.publishProduct(command({ barcode: '123' })));

      expect(error.statusCode).toBe(400);
      expect(error.errors[0]).toMatchObject({ code: 'invalid_request' });
      expect(error.errors[0]?.message).toContain('kod kreskowy');
    });
  });

  describe('transient failures', () => {
    it.each([
      ['429', new ShoperApiError(429, 'too_many_requests')],
      ['503', new ShoperApiError(503)],
      ['401', new ShoperApiError(401, 'unauthorized')],
      ['network', new ShoperNetworkError('boom')],
    ])('should let a %s propagate untouched so the job retries', async (_name, failure) => {
      const { adapter, post } = setup();
      post.mockRejectedValue(failure);

      await expect(adapter.publishProduct(command())).rejects.toBe(failure);
    });

    it('should fail rather than invent an id when Shoper answers a create without one', async () => {
      const { adapter, post } = setup();
      post.mockResolvedValue({ status: 200, data: { ok: true } });

      await expect(adapter.publishProduct(command())).rejects.toBeInstanceOf(ShoperNetworkError);
    });
  });

  describe('warnings', () => {
    it('should report the fields it does not publish instead of dropping them silently', async () => {
      const { adapter } = setup();

      const result = await adapter.publishProduct(
        command({
          content: { title: 'Misa', imageUrls: ['https://x/a.png'], tags: ['a'] },
          commerce: { dimensions: { length: 1 } },
        }),
      );

      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('images'),
          expect.stringContaining('Tags'),
          expect.stringContaining('dimensions'),
        ]),
      );
    });

    it('should not write stock on a multi-warehouse shop, and say so', async () => {
      const { adapter, post } = setup({ warehousesEnabled: true });

      const result = await adapter.publishProduct(command());

      expect(bodyOf(post).stock?.stock).toBeUndefined();
      expect(result.warnings).toEqual([expect.stringContaining('multi-warehouse')]);
    });

    it("should warn when the price currency differs from the shop's", async () => {
      const { adapter } = setup();

      const result = await adapter.publishProduct(command({ price: { amount: 10, currency: 'EUR' } }));

      expect(result.warnings).toEqual([expect.stringContaining('EUR')]);
    });

    it('should omit the warnings field when there is nothing to report', async () => {
      const { adapter } = setup();

      const result = await adapter.publishProduct(command());

      expect(result).not.toHaveProperty('warnings');
    });
  });

  it('should declare the description grammar Shoper keeps, not the conservative default', () => {
    const { adapter } = setup();

    const format = adapter.getDescriptionFormat();

    expect(format.shape).toBe('html');
    expect(format.allowedTags).toEqual(expect.arrayContaining(['table', 'img', 'a', 'h3']));
    expect(format.allowedTags).not.toContain('script');
  });
});
