/**
 * Shoper Order Preparation Types
 *
 * The fully resolved order `ShoperOrderProcessorAdapter` holds between its
 * read-only preparation phase and its first write.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
import type { ShoperOrderCreateRequest, ShoperOrderProductCreateRequest } from './shoper-api.types';

export interface PreparedShoperOrder {
  readonly header: Omit<ShoperOrderCreateRequest, 'user_id'>;
  readonly lines: Array<Omit<ShoperOrderProductCreateRequest, 'order_id'>>;
  readonly shippingCost: number;
  /** The `notes_priv` value that recognises this order on a retry. */
  readonly marker: string;
}
