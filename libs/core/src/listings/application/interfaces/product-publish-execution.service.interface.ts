/**
 * Product Publish Execution Service Interface
 *
 * Contract for the core orchestration step that turns an OL internal variant
 * plus publish options into a live shop product record (outbound, OL →
 * WooCommerce / Shopify). Used by the `shop.product.publish` worker handler and
 * the future REST endpoint (#1044) so both paths share identical semantics.
 *
 * Per `architecture-overview.md` §6, orchestration policies live in core
 * application services rather than worker handlers.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  ExecutePublishProductInput,
  ExecutePublishProductResult,
} from '../types/product-publish-execution.types';

export interface IProductPublishExecutionService {
  /**
   * Execute the full publish flow: resolve create-vs-upsert via
   * `IdentifierMapping` (`ShopProduct`, connection-scoped), build the neutral
   * `PublishProductCommand`, invoke the shop adapter, persist the
   * `ListingCreationRecord` + the `ShopProduct` mapping (first publish only).
   *
   * Terminal domain failures (builder validation, master-catalog misconfig,
   * shop reject) are caught and persisted to the record as `status='failed'`
   * with structured errors — the method resolves normally in those cases so
   * the calling worker job isn't retried. Transient / unknown errors propagate.
   */
  executePublish(input: ExecutePublishProductInput): Promise<ExecutePublishProductResult>;
}
