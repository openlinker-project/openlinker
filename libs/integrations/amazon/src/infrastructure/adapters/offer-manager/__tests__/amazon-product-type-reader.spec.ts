/**
 * AmazonProductTypeReader tests (#4181)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/offer-manager/__tests__
 */
import { AmazonApiError } from '../../../../domain/exceptions/amazon-api.error';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { AmazonProductTypeReader, safeSchemaUrl } from '../amazon-product-type-reader';

const DE = 'A1PA6795UKMFR9';
const LINK = 'https://selling-partner-definitions-prod-iad.s3.amazonaws.com/schema/KITCHEN.json?X-Amz-Signature=abc';

function setup(): { reader: AmazonProductTypeReader; get: jest.Mock; fetchImpl: jest.Mock } {
  const get = jest.fn();
  const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ required: ['color'] }), { status: 200 }));
  return { reader: new AmazonProductTypeReader({ get } as unknown as AmazonSpApiClient, fetchImpl, DE), get, fetchImpl };
}

describe('AmazonProductTypeReader', () => {
  it('should list the product types of the marketplace', async () => {
    const { reader, get } = setup();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { productTypes: [{ name: 'KITCHEN', displayName: 'Kitchen' }] } });

    await expect(reader.listProductTypes()).resolves.toEqual([{ name: 'KITCHEN', displayName: 'Kitchen' }]);
    expect(get).toHaveBeenCalledWith('/definitions/2020-09-01/productTypes', { marketplaceIds: [DE] });
  });

  it('should download the schema the definition links to, without the connection token', async () => {
    const { reader, get, fetchImpl } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: { productType: 'KITCHEN', schema: { link: { resource: LINK, verb: 'GET' } } },
    });

    await expect(reader.getSchema('KITCHEN')).resolves.toEqual({ required: ['color'] });
    expect(get).toHaveBeenCalledWith('/definitions/2020-09-01/productTypes/KITCHEN', {
      marketplaceIds: [DE],
      requirements: 'LISTING',
      requirementsEnforced: 'ENFORCED',
      locale: 'DEFAULT',
    });
    expect(fetchImpl).toHaveBeenCalledWith(LINK, { method: 'GET', redirect: 'manual' });
  });

  it('should refuse a schema link that is not an HTTPS Amazon URL', () => {
    expect(() => safeSchemaUrl('http://selling-partner-definitions.s3.amazonaws.com/x.json')).toThrow(AmazonApiError);
    expect(() => safeSchemaUrl('https://169.254.169.254/latest/meta-data')).toThrow(AmazonApiError);
    expect(() => safeSchemaUrl('https://evil.example/amazonaws.com')).toThrow(AmazonApiError);
    expect(() => safeSchemaUrl('https://user:pw@x.s3.amazonaws.com/a')).toThrow(AmazonApiError);
    expect(safeSchemaUrl(LINK)).toBe(LINK);
  });

  it('should report a failed download', async () => {
    const { reader, get, fetchImpl } = setup();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { productType: 'KITCHEN', schema: { link: { resource: LINK, verb: 'GET' } } } });
    fetchImpl.mockResolvedValue(new Response('denied', { status: 403 }));

    await expect(reader.getSchema('KITCHEN')).rejects.toThrow(AmazonApiError);
  });
});
