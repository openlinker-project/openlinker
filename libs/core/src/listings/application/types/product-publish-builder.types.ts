/**
 * Product Publish Builder Types
 *
 * Input shape for `IProductPublishBuilderService.buildPublishProductCommand`.
 * The service resolves the OL variant + parent master product, provisions the
 * destination category (open-provenance, via `CategoryProvisioner`), projects
 * the variant's attributes into neutral `OfferParameter[]`, and produces a
 * neutral `PublishProductCommand` for any shop adapter implementing
 * `ShopProductManagerPort.publishProduct` (#1042, #1072).
 *
 * @module libs/core/src/listings/application/types
 */

import type { PublishProductContent, PublishProductStatus } from '@openlinker/core/listings';

export interface BuildPublishProductCommandInput {
  /** OL internal variant id being published. */
  internalVariantId: string;
  /** Target shop connection id. */
  connectionId: string;
  /** Stock quantity to expose on the shop. */
  stock: number;
  /** Target publication state (`draft` | `published`). */
  status: PublishProductStatus;
  /**
   * Optional explicit price. When omitted, the builder resolves a price from the
   * master product (requires both amount and currency).
   */
  price?: { amount: number; currency: string };
  /** Optional owned-record content overrides; missing fields fall back to the master product. */
  content?: PublishProductContent;
  /** Optional idempotency key forwarded to the produced command. */
  idempotencyKey?: string;
}
