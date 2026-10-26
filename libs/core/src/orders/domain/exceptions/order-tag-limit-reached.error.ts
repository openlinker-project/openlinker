/**
 * Order Tag Limit Reached Error (#3532, D34)
 *
 * @module libs/core/src/orders/domain/exceptions
 */
import { ORDER_TAG_WORKSPACE_LIMIT } from '../types/order-tag.types';

export class OrderTagLimitReachedError extends Error {
  constructor() {
    super(`Workspace tag limit reached (${ORDER_TAG_WORKSPACE_LIMIT}); delete an unused tag first.`);
    this.name = 'OrderTagLimitReachedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
