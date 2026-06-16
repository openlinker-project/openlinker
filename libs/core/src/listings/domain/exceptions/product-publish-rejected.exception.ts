/**
 * Product Publish Rejected Exception
 *
 * Neutral domain exception thrown by any shop adapter implementing
 * `ShopProductManagerPort.publishProduct` when the destination rejects the
 * publish and no product record was created or updated (e.g. a WooCommerce 4xx
 * response). Carries the platform's validation errors mapped into the neutral
 * `CreateOfferValidationError` shape so core services can persist them without
 * depending on any specific integration package.
 *
 * Mirrors `OfferCreateRejectedException` (the marketplace-side analogue). The
 * error message carries only the adapter key, status code, and error count —
 * never the request/response body — so secrets can't leak through it.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

import type { CreateOfferValidationError } from '../types/offer-create.types';

export class ProductPublishRejectedException extends Error {
  constructor(
    /** Adapter key of the shop that rejected the publish (e.g. 'woocommerce.restapi.v1'). */
    public readonly adapterKey: string,
    /** HTTP status code when the rejection came from an API call. `0` for preflight validation. */
    public readonly statusCode: number,
    /** Neutral validation errors describing why the shop rejected the publish. */
    public readonly errors: CreateOfferValidationError[],
  ) {
    super(
      `Shop ${adapterKey} rejected product publish (status=${statusCode}, ${errors.length} error${
        errors.length === 1 ? '' : 's'
      })`,
    );
    this.name = 'ProductPublishRejectedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
