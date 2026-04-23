/**
 * Content State Reader Service Interface
 *
 * Read-side contract for the content editor. Composes persisted
 * `ProductContentField` rows with live integration state (active connections,
 * OfferFieldUpdater capability, linked-offer counts) to produce the per-product
 * editor summary consumed by `GET /products/:id/content`.
 *
 * @module libs/core/src/content/application/services
 */
import type { ContentState } from '../types/content-state.types';

export interface IContentStateReaderService {
  readState(productId: string): Promise<ContentState>;
}
