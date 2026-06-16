/**
 * Product Publish Enqueue Service Interface
 *
 * Contract for the pre-enqueue half of the shop-publish flow (#1044): validate
 * the connection's `ProductPublisher` capability, pre-create the
 * `ListingCreationRecord`, and enqueue a `shop.product.publish` job. The single
 * per-child primitive both the single-publish controller and the bulk submit
 * service fan out through.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  EnqueueProductPublishInput,
  EnqueueProductPublishResult,
} from '../types/product-publish-enqueue.types';

export interface IProductPublishEnqueueService {
  enqueuePublish(input: EnqueueProductPublishInput): Promise<EnqueueProductPublishResult>;
}
