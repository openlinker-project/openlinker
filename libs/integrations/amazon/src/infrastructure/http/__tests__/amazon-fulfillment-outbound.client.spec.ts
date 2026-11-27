/**
 * AmazonFulfillmentOutboundClient tests (#4185)
 *
 * The "does this fulfillment order exist" read: Amazon answers an unknown id
 * with 400 InvalidInput "Order Does Not Exist" (seen on every sandbox host),
 * which must read as "none" or Multi-Channel Fulfillment never creates an order.
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonFulfillmentOutboundClient } from '../amazon-fulfillment-outbound.client';
import type { AmazonSpApiClient } from '../amazon-spapi-client';

function clientRejecting(error: unknown): AmazonSpApiClient {
  return { get: jest.fn(() => Promise.reject(error)) } as unknown as AmazonSpApiClient;
}

describe('AmazonFulfillmentOutboundClient.get', () => {
  it('should return the order when Amazon has it', async () => {
    const order = { payload: { fulfillmentOrder: { sellerFulfillmentOrderId: 'OL-1' } } };
    const spApi = { get: jest.fn(() => Promise.resolve({ data: order })) } as unknown as AmazonSpApiClient;

    await expect(new AmazonFulfillmentOutboundClient(spApi).get('OL-1')).resolves.toBe(order);
  });

  it('should return null when Amazon answers 404', async () => {
    const outbound = new AmazonFulfillmentOutboundClient(clientRejecting(new AmazonApiError(404, 'NotFound', undefined, 'r')));

    await expect(outbound.get('OL-1')).resolves.toBeNull();
  });

  it('should return null when Amazon answers 400 Order Does Not Exist', async () => {
    const outbound = new AmazonFulfillmentOutboundClient(
      clientRejecting(new AmazonApiError(400, 'InvalidInput', 'Order Does Not Exist', 'r')),
    );

    await expect(outbound.get('OL-1')).resolves.toBeNull();
  });

  it('should rethrow any other 400', async () => {
    const error = new AmazonApiError(400, 'InvalidInput', 'Invalid Input given', 'r');
    const outbound = new AmazonFulfillmentOutboundClient(clientRejecting(error));

    await expect(outbound.get('OL-1')).rejects.toBe(error);
  });

  it('should rethrow a server error', async () => {
    const error = new AmazonApiError(500, 'InternalFailure', 'Order Does Not Exist', 'r');
    const outbound = new AmazonFulfillmentOutboundClient(clientRejecting(error));

    await expect(outbound.get('OL-1')).rejects.toBe(error);
  });
});
