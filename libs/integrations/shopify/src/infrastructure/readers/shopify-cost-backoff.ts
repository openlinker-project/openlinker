/**
 * Shopify Cost Backoff
 *
 * Batch size for reads whose cost Shopify does not let us compute up front.
 * One query may not exceed 1000 points (Admin API 2026-10), and Shopify no
 * longer publishes how a connection is costed, so a batch read starts at a
 * size that fits in practice and HALVES when Shopify answers
 * `MAX_COST_EXCEEDED` - a deterministic refusal of the document, which only a
 * smaller document gets past. The size that worked is kept for the rest of
 * the adapter instance, so the halving is paid once per resolution.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';

export class ShopifyBatchSizer {
  private size: number;

  constructor(initial: number) {
    this.size = Math.max(1, Math.floor(initial));
  }

  get current(): number {
    return this.size;
  }

  /**
   * Runs `read` with the current size, halving and retrying while Shopify
   * refuses the cost. A refusal at size 1 is thrown: nothing smaller exists.
   */
  async run<T>(read: (size: number) => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await read(this.size);
      } catch (error) {
        if (error instanceof ShopifyGraphqlError && error.isMaxCostExceeded() && this.size > 1) {
          this.size = Math.max(1, Math.floor(this.size / 2));
          continue;
        }
        throw error;
      }
    }
  }
}
