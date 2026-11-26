/**
 * Amazon Fulfillment Outbound Client (#4185)
 *
 * Fulfillment Outbound API v2020-07-01, the calls Multi-Channel Fulfillment
 * needs: preview, create, read and cancel a fulfillment order. Needs the
 * "Amazon Fulfillment" role on the seller's app.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import type {
  AmazonMcfAddress,
  AmazonMcfCreateRequest,
  AmazonMcfItemRequest,
  AmazonMcfOrderResponse,
  AmazonMcfPreviewResponse,
  AmazonMcfShippingSpeed,
} from '../../domain/types/amazon-mcf.types';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import type { AmazonSpApiClient } from './amazon-spapi-client';

const ORDERS_PATH = '/fba/outbound/2020-07-01/fulfillmentOrders';

export class AmazonFulfillmentOutboundClient {
  constructor(private readonly client: AmazonSpApiClient) {}

  async preview(
    marketplaceId: string,
    address: AmazonMcfAddress,
    items: readonly AmazonMcfItemRequest[],
    speed: AmazonMcfShippingSpeed,
  ): Promise<AmazonMcfPreviewResponse> {
    const response = await this.client.post<AmazonMcfPreviewResponse>(`${ORDERS_PATH}/preview`, {
      marketplaceId,
      address,
      items,
      shippingSpeedCategories: [speed],
    });
    return response.data;
  }

  async create(request: AmazonMcfCreateRequest): Promise<void> {
    await this.client.post(ORDERS_PATH, request);
  }

  /**
   * The order, or `null` when Amazon has none under this id. Amazon answers an
   * unknown id with 400 InvalidInput "Order Does Not Exist" rather than a 404
   * (seen on the NA, EU and FE hosts), so both mean "none"; any other 400 is a
   * real refusal and is thrown.
   */
  async get(sellerFulfillmentOrderId: string): Promise<AmazonMcfOrderResponse | null> {
    try {
      const response = await this.client.get<AmazonMcfOrderResponse>(
        `${ORDERS_PATH}/${encodeURIComponent(sellerFulfillmentOrderId)}`,
      );
      return response.data;
    } catch (error) {
      if (isOrderNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async cancel(sellerFulfillmentOrderId: string): Promise<void> {
    await this.client.put(`${ORDERS_PATH}/${encodeURIComponent(sellerFulfillmentOrderId)}/cancel`, {});
  }
}

/** Amazon's answer for a fulfillment order id it does not know. */
const ORDER_NOT_FOUND_DETAIL = /does not exist|not found/i;

function isOrderNotFound(error: unknown): boolean {
  if (!(error instanceof AmazonApiError)) {
    return false;
  }
  if (error.statusCode === 404) {
    return true;
  }
  return error.statusCode === 400 && error.errorCode === 'InvalidInput' && ORDER_NOT_FOUND_DETAIL.test(error.detail ?? '');
}
